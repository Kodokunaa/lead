import { roleSchema, type Role } from '@lead/schema';
import { jwtVerify, SignJWT } from 'jose';
import { createHash, randomBytes } from 'node:crypto';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Idle limit: a session not refreshed for this long ends. */
export const REFRESH_TOKEN_TTL_MS = 7 * DAY_MS;
/** Absolute limit: every session ends this long after sign-in, however active. */
export const SESSION_MAX_AGE_MS = 30 * DAY_MS;

const ISSUER = 'lead-api';
const AUDIENCE = 'lead';

export interface AccessClaims {
  readonly userId: string;
  readonly role: Role;
  /** Session family, so a signed-out session's access tokens stop working immediately. */
  readonly sessionFamily: string;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export function signAccessToken(claims: AccessClaims, secret: string): Promise<string> {
  return new SignJWT({ role: claims.role, sid: claims.sessionFamily })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(key(secret));
}

/** Returns the claims, or null for any invalid, expired or malformed token. */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    const role = roleSchema.safeParse(payload.role);
    if (!payload.sub || typeof payload.sid !== 'string' || !role.success) return null;
    return { userId: payload.sub, role: role.data, sessionFamily: payload.sid };
  } catch {
    return null;
  }
}

/** Proves the password step passed; only the MFA verify endpoint accepts it. */
const CHALLENGE_AUDIENCE = 'lead-mfa-challenge';
export const CHALLENGE_TTL_SECONDS = 5 * 60;

/**
 * Short fingerprint of the stored password hash. A challenge carries it, so changing or
 * resetting the password voids every outstanding challenge.
 */
export function passwordVersion(passwordHash: string | null): string {
  return createHash('sha256')
    .update(passwordHash ?? '')
    .digest('base64url')
    .slice(0, 16);
}

export interface ChallengeClaims {
  readonly userId: string;
  readonly passwordVersion: string;
}

export function signChallengeToken(claims: ChallengeClaims, secret: string): Promise<string> {
  return new SignJWT({ pv: claims.passwordVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(CHALLENGE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(key(secret));
}

/** Returns the claims, or null for any invalid or expired challenge. */
export async function verifyChallengeToken(
  token: string,
  secret: string,
): Promise<ChallengeClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: CHALLENGE_AUDIENCE,
      algorithms: ['HS256'],
    });
    if (!payload.sub || typeof payload.pv !== 'string') return null;
    return { userId: payload.sub, passwordVersion: payload.pv };
  } catch {
    return null;
  }
}

export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Refresh tokens are random 256-bit values, so a fast hash is enough to store them safely. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
