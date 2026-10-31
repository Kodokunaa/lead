import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { RegisterRequest, ResetPasswordRequest, VerifyEmailRequest } from '@lead/schema';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import { accountTokens, users, type AccountTokenPurpose, type UserRow } from '../database/schema';
import { MAILER, type Mailer } from '../mail/mail.module';
import { AuthService, emailFingerprint, type ClientInfo } from './auth.service';
import { hashPassword } from './password';
import { hashRefreshToken, newRefreshToken } from './tokens';

const MINUTE_MS = 60 * 1000;
const TOKEN_TTL_MS: Readonly<Record<AccountTokenPurpose, number>> = {
  password_reset: 30 * MINUTE_MS,
  email_verification: 24 * 60 * MINUTE_MS,
};
/** At most one email per account and purpose in this window, so nobody can flood an inbox. */
export const EMAIL_COOLDOWN_MS = MINUTE_MS;

/** The same answer whatever happened, so these endpoints cannot reveal which emails exist. */
export const REGISTRATION_ACCEPTED =
  'Thanks. Check your email for a link to confirm your address and choose a password.';
export const RESET_REQUESTED = 'If an active account uses this email, a reset link is on its way.';
export const EMAIL_VERIFIED = 'Email confirmed. An administrator will approve your account soon.';

/**
 * Self-service account flows: registration (H02), email confirmation and password recovery
 * (H03). Requests that take an email answer at once and do their work afterwards, so the
 * response time cannot reveal whether the email has an account.
 */
@Injectable()
export class AccountService implements OnApplicationShutdown {
  private readonly logger = new Logger(AccountService.name);
  private readonly background = new Set<Promise<void>>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly auth: AuthService,
  ) {}

  register(request: RegisterRequest, client: ClientInfo): void {
    this.runInBackground('registration', () => this.processRegistration(request, client));
  }

  requestPasswordReset(email: string, client: ClientInfo): void {
    this.runInBackground('password reset request', () => this.processResetRequest(email, client));
  }

  /** Confirms the address and sets the first password; the account stays pending approval. */
  async verifyEmail(request: VerifyEmailRequest, client: ClientInfo): Promise<void> {
    const passwordHash = await hashPassword(request.password);
    const user = await this.db.transaction(async (tx) => {
      const userId = await this.claimToken(tx, 'email_verification', request.token);
      if (!userId) return null;
      const [verified] = await tx
        .update(users)
        .set({ passwordHash, emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.status, 'pending')))
        .returning();
      if (verified)
        await this.auth.recordEvent('auth.email_verified', 'success', verified, client, {}, tx);
      return verified ?? null;
    });
    if (!user) throw new BadRequestException('This confirmation link is invalid or has expired.');
  }

  /** Sets a new password from a reset link, then signs the account out everywhere. */
  async resetPassword(request: ResetPasswordRequest, client: ClientInfo): Promise<void> {
    const passwordHash = await hashPassword(request.password);
    const done = await this.db.transaction(async (tx) => {
      const userId = await this.claimToken(tx, 'password_reset', request.token);
      if (!userId) return false;
      const [user] = await tx
        .update(users)
        .set({ passwordHash, failedSignIns: 0, lockedUntil: null, updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.status, 'active')))
        .returning();
      if (!user) return false;

      await this.auth.revokeAllSessions(tx, user.id);
      await this.auth.recordEvent('auth.password_reset', 'success', user, client, {}, tx);
      return true;
    });
    if (!done) {
      await this.auth.recordEvent('auth.password_reset_failed', 'failure', null, client, {});
      throw new BadRequestException('This reset link is invalid or has expired.');
    }
  }

  /** Waits for queued background work; used at shutdown and by tests. */
  async drain(): Promise<void> {
    while (this.background.size > 0) await Promise.all([...this.background]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drain();
  }

  private async processRegistration(request: RegisterRequest, client: ClientInfo): Promise<void> {
    const [existing] = await this.db.select().from(users).where(eq(users.email, request.email));

    if (!existing) {
      const [created] = await this.db
        .insert(users)
        .values({
          email: request.email,
          displayName: request.displayName,
          role: request.role,
          status: 'pending',
        })
        .onConflictDoNothing({ target: users.email })
        .returning();
      if (!created) return; // A parallel request registered it first.
      await this.auth.recordEvent('auth.registered', 'success', created, client, {});
      await this.sendLink(created, 'email_verification');
      return;
    }

    // Still unconfirmed: whoever owns the inbox decides, so update the request and resend.
    if (existing.status === 'pending' && !existing.emailVerifiedAt) {
      const [updated] = await this.db
        .update(users)
        .set({ displayName: request.displayName, role: request.role, updatedAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning();
      await this.auth.recordEvent('auth.registration_repeated', 'success', existing, client, {});
      if (updated) await this.sendLink(updated, 'email_verification');
      return;
    }

    await this.auth.recordEvent('auth.registration_repeated', 'denied', existing, client, {
      after: { status: existing.status },
    });
  }

  private async processResetRequest(email: string, client: ClientInfo): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    if (!user || user.status !== 'active') {
      await this.auth.recordEvent('auth.password_reset_requested', 'failure', null, client, {
        targetType: 'email_hash',
        targetId: emailFingerprint(email),
      });
      return;
    }
    await this.auth.recordEvent('auth.password_reset_requested', 'success', user, client, {});
    await this.sendLink(user, 'password_reset');
  }

  /** Issues a fresh link (older ones stop working) and emails it, unless one went out just now. */
  private async sendLink(user: UserRow, purpose: AccountTokenPurpose): Promise<void> {
    const token = newRefreshToken();
    const issued = await this.db.transaction(async (tx) => {
      // Lock the user row so parallel requests take turns; otherwise both could pass the
      // cooldown check before either writes its token.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update');
      const [recent] = await tx
        .select({ id: accountTokens.id })
        .from(accountTokens)
        .where(
          and(
            eq(accountTokens.userId, user.id),
            eq(accountTokens.purpose, purpose),
            gt(accountTokens.createdAt, new Date(Date.now() - EMAIL_COOLDOWN_MS)),
          ),
        )
        .limit(1);
      if (recent) return false;

      await tx
        .update(accountTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(accountTokens.userId, user.id),
            eq(accountTokens.purpose, purpose),
            isNull(accountTokens.usedAt),
          ),
        );
      await tx.insert(accountTokens).values({
        userId: user.id,
        purpose,
        tokenHash: hashRefreshToken(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]),
      });
      return true;
    });
    if (issued) await this.mailer.send(linkEmail(user, purpose, this.link(purpose, token)));
  }

  /** Marks an unused, unexpired token as used and returns its user, or null. */
  private async claimToken(
    tx: DbExecutor,
    purpose: AccountTokenPurpose,
    token: string,
  ): Promise<string | null> {
    const [claimed] = await tx
      .update(accountTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(accountTokens.tokenHash, hashRefreshToken(token)),
          eq(accountTokens.purpose, purpose),
          isNull(accountTokens.usedAt),
          gt(accountTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: accountTokens.userId });
    return claimed?.userId ?? null;
  }

  /** The token goes in the fragment, so it never reaches server logs or Referer headers. */
  private link(purpose: AccountTokenPurpose, token: string): string {
    const path = purpose === 'password_reset' ? 'reset-password' : 'confirm-email';
    return `${this.env.WEB_ORIGIN}/${path}#token=${token}`;
  }

  private runInBackground(label: string, task: () => Promise<void>): void {
    const run: Promise<void> = task()
      .catch((error: unknown) => {
        this.logger.error(
          `Background ${label} failed`,
          error instanceof Error ? error.stack : String(error),
        );
      })
      .finally(() => this.background.delete(run));
    this.background.add(run);
  }
}

function linkEmail(user: UserRow, purpose: AccountTokenPurpose, link: string) {
  const body =
    purpose === 'password_reset'
      ? [
          'Someone asked to reset the password for your LEAD account.',
          'Open this link within 30 minutes to choose a new password:',
          '',
          link,
          '',
          'If you did not ask for this, ignore this email; your password stays the same.',
        ]
      : [
          'Someone asked for a LEAD account with this email address.',
          'Open this link within 24 hours to confirm it and choose your password:',
          '',
          link,
          '',
          'An administrator approves new accounts after that.',
          'If you did not ask for this, ignore this email and no account will be created.',
        ];
  return {
    to: user.email,
    subject:
      purpose === 'password_reset' ? 'Reset your LEAD password' : 'Confirm your LEAD account',
    text: [`Hello ${user.displayName},`, '', ...body, '', 'LEAD, City College of Calapan'].join(
      '\n',
    ),
  };
}
