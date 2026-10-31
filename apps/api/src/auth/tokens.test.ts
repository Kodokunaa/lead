import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { hashRefreshToken, newRefreshToken, signAccessToken, verifyAccessToken } from './tokens';

const secret = 'unit-test-secret-that-is-long-enough!!';
const claims = {
  userId: '7f9c2d1e-3b4a-4c5d-8e6f-0a1b2c3d4e5f',
  role: 'teacher',
  sessionFamily: '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e',
} as const;

describe('access tokens', () => {
  it('round-trips the claims', async () => {
    const token = await signAccessToken(claims, secret);

    expect(await verifyAccessToken(token, secret)).toEqual(claims);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signAccessToken(claims, `${secret}-other`);

    expect(await verifyAccessToken(token, secret)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await new SignJWT({ role: 'teacher', sid: claims.sessionFamily })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.userId)
      .setIssuer('lead-api')
      .setAudience('lead')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(secret));

    expect(await verifyAccessToken(token, secret)).toBeNull();
  });

  it('rejects a token with an unknown role', async () => {
    const token = await new SignJWT({ role: 'superuser', sid: claims.sessionFamily })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.userId)
      .setIssuer('lead-api')
      .setAudience('lead')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret));

    expect(await verifyAccessToken(token, secret)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifyAccessToken('not.a.jwt', secret)).toBeNull();
  });
});

describe('refresh tokens', () => {
  it('are unique and hash deterministically', () => {
    const a = newRefreshToken();
    const b = newRefreshToken();

    expect(a).not.toBe(b);
    expect(hashRefreshToken(a)).toBe(hashRefreshToken(a));
    expect(hashRefreshToken(a)).not.toBe(a);
  });
});
