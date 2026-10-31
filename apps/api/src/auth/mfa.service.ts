import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { MfaEnableResponse, MfaSetupResponse, MfaVerifyRequest } from '@lead/schema';
import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import { recoveryCodes, users, type UserRow } from '../database/schema';
import { MAILER, type Mailer } from '../mail/mail.module';
import { AuthError, AuthService, type ClientInfo, type IssuedSession } from './auth.service';
import { verifyPassword } from './password';
import { decryptSecret, encryptSecret } from './secret-box';
import { passwordVersion, verifyChallengeToken } from './tokens';
import { hashRecoveryCode, matchTotp, newRecoveryCodes, newTotpSecret, totpUri } from './totp';

/** Why a second factor was refused. A replayed code is not a guess, so it does not count. */
type FactorResult = 'ok' | 'wrong' | 'replayed';

/** The account must not be locked at the moment the factor is consumed. */
const notLocked = or(isNull(users.lockedUntil), lte(users.lockedUntil, sql`now()`));

/** TOTP second factor (wireframes H04 setup, H05 verify) with one-time recovery codes. */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private readonly key: Buffer;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly auth: AuthService,
  ) {
    this.key = Buffer.from(env.MFA_ENCRYPTION_KEY, 'base64url');
  }

  /** Starts setup with a fresh secret. Nothing changes for sign-in until enable() succeeds. */
  async setup(user: UserRow): Promise<MfaSetupResponse> {
    if (user.mfaEnabledAt) throw new ConflictException('Two-step verification is already on.');
    const secret = newTotpSecret();
    await this.db
      .update(users)
      .set({ mfaPendingSecret: encryptSecret(secret, this.key, user.id) })
      .where(eq(users.id, user.id));
    return { secret, otpauthUri: totpUri(secret, user.email) };
  }

  /**
   * Turns MFA on once the user proves their password and their app; signs out other devices
   * and returns recovery codes (shown once).
   */
  async enable(
    user: UserRow,
    input: { password: string; code: string },
    currentFamily: string,
    client: ClientInfo,
  ): Promise<MfaEnableResponse> {
    if (user.mfaEnabledAt) throw new ConflictException('Two-step verification is already on.');
    if (!user.mfaPendingSecret) throw new ConflictException('Start two-step setup first.');
    await this.requirePassword(user, input.password, client);

    const step = matchTotp(decryptSecret(user.mfaPendingSecret, this.key, user.id), input.code);
    if (step === null) throw new AuthError('invalid_code');

    const codes = newRecoveryCodes();
    await this.db.transaction(async (tx) => {
      const [enabled] = await tx
        .update(users)
        .set({
          mfaSecret: user.mfaPendingSecret,
          mfaPendingSecret: null,
          mfaEnabledAt: new Date(),
          mfaLastStep: step,
        })
        .where(and(eq(users.id, user.id), isNull(users.mfaEnabledAt)))
        .returning({ id: users.id });
      if (!enabled) throw new ConflictException('Two-step verification is already on.');

      await this.replaceRecoveryCodes(tx, user.id, codes);
      await this.auth.revokeOtherSessions(tx, user.id, currentFamily);
      await this.auth.recordEvent('auth.mfa_enabled', 'success', user, client, {}, tx);
    });
    this.notify(user, 'turned on');
    return { recoveryCodes: codes };
  }

  /** Turns MFA off; needs both the password and a current code, and signs out other devices. */
  async disable(
    user: UserRow,
    input: { password: string; code: string },
    currentFamily: string,
    client: ClientInfo,
  ): Promise<void> {
    if (!user.mfaEnabledAt || !user.mfaSecret) {
      throw new ConflictException('Two-step verification is already off.');
    }
    await this.requirePassword(user, input.password, client);
    const result = await this.consumeTotp(this.db, user, input.code);
    if (result !== 'ok') await this.refuseFactor(user, result, client);

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null })
        .where(eq(users.id, user.id));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
      await this.auth.revokeOtherSessions(tx, user.id, currentFamily);
      await this.auth.recordEvent('auth.mfa_disabled', 'success', user, client, {}, tx);
    });
    this.notify(user, 'turned off');
  }

  /** Second sign-in step: a TOTP code or an unused recovery code. */
  async verify(request: MfaVerifyRequest, client: ClientInfo): Promise<IssuedSession> {
    const claims = await verifyChallengeToken(request.challengeToken, this.env.JWT_SECRET);
    const [user] = claims
      ? await this.db.select().from(users).where(eq(users.id, claims.userId))
      : [];
    // A changed password voids challenges issued under the old one.
    if (
      !user?.mfaSecret ||
      user.status !== 'active' ||
      claims?.passwordVersion !== passwordVersion(user.passwordHash)
    ) {
      throw new AuthError('session_invalid');
    }
    await this.auth.assertNotLocked(user, client);

    // The factor is consumed only if the session is issued in the same transaction.
    const outcome = await this.db.transaction(async (tx) => {
      const result =
        'code' in request
          ? await this.consumeTotp(tx, user, request.code)
          : await this.consumeRecoveryCode(tx, user, request.recoveryCode);
      if (result !== 'ok') return result;
      if ('recoveryCode' in request) {
        await this.auth.recordEvent('auth.recovery_code_used', 'success', user, client, {}, tx);
      }
      return this.auth.completeSignIn(user, client, tx);
    });

    if (typeof outcome === 'string') return this.refuseFactor(user, outcome, client);
    return outcome;
  }

  /** A wrong password here counts towards lockout, like at sign-in. */
  private async requirePassword(user: UserRow, password: string, client: ClientInfo) {
    if (await verifyPassword(user.passwordHash, password)) return;
    await this.auth.recordFailedAttempt(user, client);
    throw new AuthError('invalid_credentials');
  }

  private async refuseFactor(
    user: UserRow,
    result: Exclude<FactorResult, 'ok'>,
    client: ClientInfo,
  ): Promise<never> {
    await this.auth.recordEvent('auth.mfa_failed', 'failure', user, client, {
      after: { reason: result },
    });
    if (result === 'replayed') throw new AuthError('code_already_used');
    await this.auth.recordFailedAttempt(user, client);
    throw new AuthError('invalid_code');
  }

  /** Accepts a code only if its time step is newer than the last one used (no replays). */
  private async consumeTotp(tx: DbExecutor, user: UserRow, code: string): Promise<FactorResult> {
    if (!user.mfaSecret) return 'wrong';
    const step = matchTotp(decryptSecret(user.mfaSecret, this.key, user.id), code);
    if (step === null) return 'wrong';
    const [accepted] = await tx
      .update(users)
      .set({ mfaLastStep: step })
      .where(
        and(
          eq(users.id, user.id),
          notLocked,
          or(isNull(users.mfaLastStep), lt(users.mfaLastStep, step)),
        ),
      )
      .returning({ id: users.id });
    return accepted ? 'ok' : 'replayed';
  }

  private async consumeRecoveryCode(
    tx: DbExecutor,
    user: UserRow,
    normalizedCode: string,
  ): Promise<FactorResult> {
    const [used] = await tx
      .update(recoveryCodes)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(recoveryCodes.userId, user.id),
          eq(recoveryCodes.codeHash, hashRecoveryCode(normalizedCode)),
          isNull(recoveryCodes.usedAt),
          sql`exists (select 1 from ${users} where ${users.id} = ${user.id} and ${notLocked})`,
        ),
      )
      .returning({ id: recoveryCodes.id });
    return used ? 'ok' : 'wrong';
  }

  private async replaceRecoveryCodes(tx: DbExecutor, userId: string, codes: string[]) {
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx
      .insert(recoveryCodes)
      .values(codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code.replace('-', '')) })));
  }

  /** Tells the owner, so a change they did not make does not go unnoticed. */
  private notify(user: UserRow, change: 'turned on' | 'turned off'): void {
    this.mailer
      .send({
        to: user.email,
        subject: `Two-step verification was ${change}`,
        text: [
          `Hello ${user.displayName},`,
          '',
          `Two-step verification was ${change} for your LEAD account, and your other devices`,
          'were signed out. If this was not you, reset your password and contact the registrar.',
          '',
          'LEAD, City College of Calapan',
        ].join('\n'),
      })
      .catch((error: unknown) => {
        this.logger.error(
          'Could not send MFA notice',
          error instanceof Error ? error.stack : String(error),
        );
      });
  }
}
