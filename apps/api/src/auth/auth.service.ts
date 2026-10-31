import { HttpException, HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { AuditAction, CurrentUser, SessionResponse, SignInRequest } from '@lead/schema';
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import { sessions, users, type UserRow } from '../database/schema';
import { verifyPassword, warmUpPasswordHashing } from './password';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  hashRefreshToken,
  newRefreshToken,
  REFRESH_TOKEN_TTL_MS,
  SESSION_MAX_AGE_MS,
  signAccessToken,
  type AccessClaims,
} from './tokens';

export const MAX_FAILED_SIGN_INS = 5;
export const LOCKOUT_MINUTES = 15;
/** A token rotated this recently is a benign duplicate (two tabs, a retry), not a theft. */
export const REFRESH_GRACE_MS = 10_000;

export interface ClientInfo {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/** A signed-in session: the JSON body for the client plus the refresh token for the cookie. */
export interface IssuedSession {
  readonly response: SessionResponse;
  readonly refreshToken: string;
}

export type AuthFailure =
  | 'invalid_credentials'
  | 'account_pending'
  | 'account_deactivated'
  | 'session_invalid'
  | 'session_superseded';

const FAILURE_STATUS: Readonly<Record<AuthFailure, HttpStatus>> = {
  invalid_credentials: HttpStatus.UNAUTHORIZED,
  account_pending: HttpStatus.FORBIDDEN,
  account_deactivated: HttpStatus.FORBIDDEN,
  session_invalid: HttpStatus.UNAUTHORIZED,
  session_superseded: HttpStatus.CONFLICT,
};

const FAILURE_MESSAGE: Readonly<Record<AuthFailure, string>> = {
  // Same message for unknown email, wrong password and lockout, so accounts cannot be probed.
  invalid_credentials: 'Email or password is incorrect, or the account is temporarily locked.',
  account_pending: 'Your account is waiting for administrator approval.',
  account_deactivated: 'This account has been deactivated. Contact the registrar.',
  session_invalid: 'Your session has ended. Sign in again.',
  session_superseded: 'This session was just refreshed elsewhere. Retry with the new cookie.',
};

export class AuthError extends HttpException {
  constructor(readonly code: AuthFailure) {
    super({ code, message: FAILURE_MESSAGE[code] }, FAILURE_STATUS[code]);
  }
}

export function toCurrentUser(user: UserRow): CurrentUser {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await warmUpPasswordHashing();
  }

  async signIn(request: SignInRequest, client: ClientInfo): Promise<IssuedSession> {
    const [user] = await this.db.select().from(users).where(eq(users.email, request.email));
    // Always verify, even for a missing or locked account, so timing reveals nothing.
    const passwordOk = await verifyPassword(user?.passwordHash ?? null, request.password);

    if (!user) {
      // A hash, not the address: it links repeated attempts without storing what was typed,
      // which is sometimes a password entered in the wrong field.
      await this.log('auth.sign_in_failed', 'failure', null, client, {
        targetType: 'email_hash',
        targetId: emailFingerprint(request.email),
      });
      throw new AuthError('invalid_credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.log('auth.sign_in_failed', 'denied', user, client, { after: { locked: true } });
      throw new AuthError('invalid_credentials');
    }

    if (!passwordOk) {
      await this.recordFailedSignIn(user, client);
      throw new AuthError('invalid_credentials');
    }

    if (user.status !== 'active') {
      await this.log('auth.sign_in_failed', 'denied', user, client, {
        after: { status: user.status },
      });
      throw new AuthError(user.status === 'pending' ? 'account_pending' : 'account_deactivated');
    }

    const issued = await this.db.transaction(async (tx) => {
      // Re-check the lock atomically: a parallel wrong guess may have locked the account
      // while this request was verifying its password.
      const [unlocked] = await tx
        .update(users)
        .set({ failedSignIns: 0, lockedUntil: null })
        .where(
          and(
            eq(users.id, user.id),
            or(isNull(users.lockedUntil), lte(users.lockedUntil, sql`now()`)),
          ),
        )
        .returning({ id: users.id });
      if (!unlocked) return null;

      const session = await this.issueSession(tx, user, randomUUID(), new Date(), client);
      await this.log('auth.signed_in', 'success', user, client, {}, tx);
      return session;
    });

    if (!issued) throw new AuthError('invalid_credentials');
    return issued;
  }

  /**
   * Swaps a refresh token for a new one in the same family. A token that was already swapped
   * is being replayed, most likely stolen, so the whole family is revoked; a token swapped only
   * moments ago is a duplicate request and is answered with 409 instead.
   */
  async refresh(refreshToken: string, client: ClientInfo): Promise<IssuedSession> {
    // Revocations must commit even when the refresh is refused, so the transaction returns
    // a failure code instead of throwing, and the error is raised after it commits.
    const result = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.tokenHash, hashRefreshToken(refreshToken)))
        .for('update', { of: sessions });

      if (!row) return 'session_invalid' as const;
      const { session, user } = row;
      const now = new Date();

      if (session.revokedAt) {
        const rotatedAt = session.rotatedAt?.getTime();
        if (rotatedAt !== undefined && now.getTime() - rotatedAt < REFRESH_GRACE_MS) {
          return 'session_superseded' as const;
        }
        // Log only the first replay; later ones hit an already-dead family.
        if ((await this.revokeFamily(tx, session.familyId)) > 0) {
          await this.log(
            'auth.refresh_reused',
            'denied',
            user,
            client,
            { targetType: 'session', targetId: session.familyId },
            tx,
          );
        }
        return 'session_invalid' as const;
      }

      if (session.expiresAt <= now || user.status !== 'active') {
        await this.revokeFamily(tx, session.familyId);
        return 'session_invalid' as const;
      }

      await tx
        .update(sessions)
        .set({ revokedAt: now, rotatedAt: now })
        .where(eq(sessions.id, session.id));
      return this.issueSession(tx, user, session.familyId, session.familyStartedAt, client);
    });

    if (typeof result === 'string') throw new AuthError(result);
    return result;
  }

  /** Ends the session family the refresh token belongs to. Unknown tokens are ignored. */
  async signOut(refreshToken: string, client: ClientInfo): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.tokenHash, hashRefreshToken(refreshToken)));
      if (!row || row.session.revokedAt) return;

      await this.revokeFamily(tx, row.session.familyId);
      await this.log('auth.signed_out', 'success', row.user, client, {}, tx);
    });
  }

  /** The signed-in user, if the access token's session is still live and the account active. */
  async findActiveUser(claims: AccessClaims): Promise<UserRow | null> {
    const [row] = await this.db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.familyId, claims.sessionFamily),
          eq(sessions.userId, claims.userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
          eq(users.status, 'active'),
        ),
      )
      .limit(1);
    return row?.user ?? null;
  }

  private async issueSession(
    tx: DbExecutor,
    user: UserRow,
    familyId: string,
    familyStartedAt: Date,
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const refreshToken = newRefreshToken();
    // Each refresh extends the session, but never past its absolute maximum age.
    const expiresAt = new Date(
      Math.min(Date.now() + REFRESH_TOKEN_TTL_MS, familyStartedAt.getTime() + SESSION_MAX_AGE_MS),
    );
    await tx.insert(sessions).values({
      familyId,
      familyStartedAt,
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
    });
    const accessToken = await signAccessToken(
      { userId: user.id, role: user.role, sessionFamily: familyId },
      this.env.JWT_SECRET,
    );
    return {
      refreshToken,
      response: { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, user: toCurrentUser(user) },
    };
  }

  private async recordFailedSignIn(user: UserRow, client: ClientInfo): Promise<void> {
    // One atomic statement, so parallel guesses can neither undercount nor slip past a lock.
    // now() is fixed per transaction, so locked_until equals lockUntil only if this statement
    // set it.
    const lockUntil = sql`now() + make_interval(mins => ${LOCKOUT_MINUTES})`;
    const isLocked = sql`(${users.lockedUntil} is not null and ${users.lockedUntil} > now())`;
    const reachesLimit = sql`(${users.failedSignIns} + 1 >= ${MAX_FAILED_SIGN_INS})`;
    const [updated] = await this.db
      .update(users)
      .set({
        failedSignIns: sql`case when ${isLocked} then ${users.failedSignIns}
          when ${reachesLimit} then 0 else ${users.failedSignIns} + 1 end`,
        lockedUntil: sql`case when ${isLocked} then ${users.lockedUntil}
          when ${reachesLimit} then ${lockUntil} else ${users.lockedUntil} end`,
      })
      .where(eq(users.id, user.id))
      .returning({
        justLocked: sql<boolean>`coalesce(${users.lockedUntil} = ${lockUntil}, false)`,
      });

    if (updated?.justLocked) {
      await this.log('auth.locked_out', 'denied', user, client, {});
      return;
    }
    await this.log('auth.sign_in_failed', 'failure', user, client, {});
  }

  /** Revokes every live token in the family and returns how many were still live. */
  private async revokeFamily(tx: DbExecutor, familyId: string): Promise<number> {
    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return revoked.length;
  }

  private async log(
    action: AuditAction,
    outcome: 'success' | 'denied' | 'failure',
    user: UserRow | null,
    client: ClientInfo,
    extra: {
      targetType?: string;
      targetId?: string;
      after?: Record<string, unknown>;
    },
    tx?: DbExecutor,
  ): Promise<void> {
    await this.audit.record(
      {
        actorId: user?.id ?? null,
        actorRole: user?.role ?? null,
        action,
        targetType: extra.targetType ?? (user ? 'user' : null),
        targetId: extra.targetId ?? user?.id ?? null,
        outcome,
        reason: null,
        before: null,
        after: extra.after ?? null,
        ipAddress: client.ipAddress,
        userAgent: client.userAgent,
      },
      tx,
    );
  }
}

/** Lets audit rows link attempts on the same unknown email without storing the address. */
function emailFingerprint(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 32);
}
