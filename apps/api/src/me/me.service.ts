import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CurrentUser, PasswordChange, SessionSummary } from '@lead/schema';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { AuthError, AuthService, toCurrentUser, type ClientInfo } from '../auth/auth.service';
import { hashPassword, verifyPassword } from '../auth/password';
import { DATABASE, type Database } from '../database/database.module';
import { sessions, users, type UserRow } from '../database/schema';
import { MAILER, type Mailer } from '../mail/mail.module';

/** The signed-in user's own account: profile (H07), password and devices (H08). */
@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly auth: AuthService,
  ) {}

  /** One entry per signed-in device: the newest live token of each session family. */
  async sessions(user: UserRow, currentFamily: string): Promise<SessionSummary[]> {
    const rows = await this.db
      .selectDistinctOn([sessions.familyId], {
        familyId: sessions.familyId,
        startedAt: sessions.familyStartedAt,
        lastActiveAt: sessions.createdAt,
        userAgent: sessions.userAgent,
        ipAddress: sessions.ipAddress,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, user.id),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
        ),
      )
      .orderBy(sessions.familyId, desc(sessions.createdAt));

    return rows
      .map((row) => ({
        id: row.familyId,
        startedAt: row.startedAt.toISOString(),
        lastActiveAt: row.lastActiveAt.toISOString(),
        userAgent: row.userAgent,
        ipAddress: row.ipAddress,
        current: row.familyId === currentFamily,
      }))
      .sort(
        (a, b) =>
          Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt),
      );
  }

  /** Signs one device out. Revoking the current session signs this browser out too. */
  async revokeSession(user: UserRow, familyId: string, client: ClientInfo): Promise<void> {
    await this.db.transaction(async (tx) => {
      const revoked = await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.userId, user.id),
            eq(sessions.familyId, familyId),
            isNull(sessions.revokedAt),
          ),
        )
        .returning({ id: sessions.id });
      if (revoked.length === 0) throw new NotFoundException('That session has already ended.');
      await this.auth.recordEvent(
        'auth.session_revoked',
        'success',
        user,
        client,
        { targetType: 'session', targetId: familyId },
        tx,
      );
    });
  }

  async revokeOtherSessions(
    user: UserRow,
    currentFamily: string,
    client: ClientInfo,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.auth.revokeOtherSessions(tx, user.id, currentFamily);
      await this.auth.recordEvent(
        'auth.session_revoked',
        'success',
        user,
        client,
        { after: { scope: 'other devices' } },
        tx,
      );
    });
  }

  async updateProfile(
    user: UserRow,
    displayName: string,
    client: ClientInfo,
  ): Promise<CurrentUser> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({ displayName, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
      if (!updated) throw new NotFoundException('No such user.');
      await this.auth.recordEvent(
        'account.profile_updated',
        'success',
        user,
        client,
        { after: { displayName } },
        tx,
      );
      return toCurrentUser(updated);
    });
  }

  /**
   * Needs the current password (a wrong one counts towards lockout), then signs out every
   * other device and emails the owner.
   */
  async changePassword(
    user: UserRow,
    change: PasswordChange,
    currentFamily: string,
    client: ClientInfo,
  ): Promise<void> {
    if (!(await verifyPassword(user.passwordHash, change.currentPassword))) {
      await this.auth.recordFailedAttempt(user, client);
      throw new AuthError('invalid_credentials');
    }
    const passwordHash = await hashPassword(change.newPassword);
    await this.db.transaction(async (tx) => {
      // Only if nobody changed the password since it was checked (another tab, a reset).
      const [changed] = await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash ?? '')))
        .returning({ id: users.id });
      if (!changed) {
        throw new ConflictException('Your password was changed somewhere else. Sign in again.');
      }
      await this.auth.revokeOtherSessions(tx, user.id, currentFamily);
      await this.auth.recordEvent('auth.password_changed', 'success', user, client, {}, tx);
    });
    this.mailer
      .send({
        to: user.email,
        subject: 'Your LEAD password was changed',
        text: [
          `Hello ${user.displayName},`,
          '',
          'The password for your LEAD account was changed and your other devices were signed out.',
          'If this was not you, reset your password now and contact the registrar.',
          '',
          'LEAD, City College of Calapan',
        ].join('\n'),
      })
      .catch((error: unknown) => {
        this.logger.error(
          'Could not send password notice',
          error instanceof Error ? error.stack : String(error),
        );
      });
  }
}
