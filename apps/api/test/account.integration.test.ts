import { Secret, TOTP } from 'otpauth';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AccountService,
  EMAIL_VERIFIED,
  REGISTRATION_ACCEPTED,
  RESET_REQUESTED,
} from '../src/auth/account.service';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { auditCount, createUser, TEST_PASSWORD, WEB_ORIGIN } from './test-users';

const STEP_MS = 30_000;
const NEW_PASSWORD = 'a brand new passphrase';

/** A code for the given offset in 30-second steps from now (the server accepts -1..+1). */
function totpCode(secret: string, stepOffset = 0): string {
  return new TOTP({ secret: Secret.fromBase32(secret) }).generate({
    timestamp: Date.now() + stepOffset * STEP_MS,
  });
}

describe('MFA, registration and password recovery (integration)', () => {
  let testApp: TestApp;
  let sql: Sql;
  let accounts: AccountService;
  const server = () => testApp.server();

  async function signIn(email: string, password = TEST_PASSWORD) {
    return request(server()).post('/api/auth/sign-in').send({ email, password });
  }

  async function accessTokenFor(email: string): Promise<string> {
    const response = await signIn(email);
    expect(response.status).toBe(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  const authed = (token: string, path: string) =>
    request(server()).post(path).set('Authorization', `Bearer ${token}`);

  /** Signs in, sets up and enables MFA; returns the secret, token and recovery codes. */
  async function enableMfa(email: string) {
    const token = await accessTokenFor(email);
    const setup = await authed(token, '/api/auth/mfa/setup').expect(200);
    const { secret } = setup.body as { secret: string };
    const enabled = await authed(token, '/api/auth/mfa/enable')
      .send({ password: TEST_PASSWORD, code: totpCode(secret) })
      .expect(200);
    const { recoveryCodes } = enabled.body as { recoveryCodes: string[] };
    return { secret, token, recoveryCodes };
  }

  /** The token from the newest link of the given kind sent to this address. */
  async function linkToken(email: string, path: 'reset-password' | 'confirm-email') {
    await accounts.drain();
    const text = testApp.mailer.lastTo(email)?.text ?? '';
    const match = new RegExp(`${WEB_ORIGIN}/${path}#token=([A-Za-z0-9_-]+)`).exec(text);
    if (!match?.[1]) throw new Error(`No ${path} link sent to ${email}`);
    return match[1];
  }

  /** Lets the next email of either kind go out despite the per-account cooldown. */
  async function skipCooldown(email: string) {
    await sql`
      update account_tokens set created_at = created_at - interval '5 minutes'
      where user_id = (select id from users where email = ${email})`;
  }

  beforeAll(async () => {
    testApp = await createTestApp();
    sql = testApp.app.get<Sql>(SQL_CLIENT);
    accounts = testApp.app.get(AccountService);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('two-step verification', () => {
    it('stores the secret encrypted and returns ten recovery codes once', async () => {
      const email = await createUser(sql);
      const { secret, recoveryCodes } = await enableMfa(email);

      expect(recoveryCodes).toHaveLength(10);
      const [row] = await sql`
        select mfa_secret, mfa_pending_secret, mfa_enabled_at from users where email = ${email}`;
      expect(row?.mfa_secret).not.toContain(secret);
      expect(row?.mfa_pending_secret).toBeNull();
      expect(row?.mfa_enabled_at).not.toBeNull();
      const [codes] = await sql`
        select count(*)::int as n from recovery_codes r join users u on u.id = r.user_id
        where u.email = ${email}`;
      expect(codes?.n).toBe(10);
      expect(await auditCount(sql, 'auth.mfa_enabled', email)).toBe(1);
      expect(testApp.mailer.lastTo(email)?.subject).toBe('Two-step verification was turned on');
    });

    it('needs the password and a working code to turn on', async () => {
      const email = await createUser(sql);
      const token = await accessTokenFor(email);
      const { secret } = (await authed(token, '/api/auth/mfa/setup').expect(200)).body as {
        secret: string;
      };

      await authed(token, '/api/auth/mfa/enable')
        .send({ password: 'wrong password', code: totpCode(secret) })
        .expect(401);
      await authed(token, '/api/auth/mfa/enable')
        .send({ password: TEST_PASSWORD, code: '000000' })
        .expect(401);
      const [row] = await sql`select mfa_enabled_at from users where email = ${email}`;
      expect(row?.mfa_enabled_at).toBeNull();
    });

    it('signs out other devices but keeps the current one', async () => {
      const email = await createUser(sql);
      const otherDevice = await accessTokenFor(email);
      const { token } = await enableMfa(email);

      await request(server())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${otherDevice}`)
        .expect(401);
      await request(server())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('asks for a code at sign-in and issues a session only after it', async () => {
      const email = await createUser(sql);
      const { secret } = await enableMfa(email);

      const first = await signIn(email);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ mfaRequired: true });
      expect(first.headers['set-cookie']).toBeUndefined();
      const { challengeToken } = first.body as { challengeToken: string };

      // The challenge is not an access token.
      await request(server())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${challengeToken}`)
        .expect(401);

      // Enabling used the current code, so the next one is needed now.
      const verified = await request(server())
        .post('/api/auth/mfa/verify')
        .send({ challengeToken, code: totpCode(secret, 1) })
        .expect(200);
      expect(verified.body).toMatchObject({ user: { email } });
      expect(String(verified.headers['set-cookie'])).toContain('lead_refresh=');
    });

    it('refuses a replayed code without counting it towards lockout', async () => {
      const email = await createUser(sql);
      const { secret } = await enableMfa(email);
      const { challengeToken } = (await signIn(email)).body as { challengeToken: string };

      // One step back is inside the accepted window but not newer than the code just used.
      const response = await request(server())
        .post('/api/auth/mfa/verify')
        .send({ challengeToken, code: totpCode(secret, -1) })
        .expect(401);

      expect(response.body).toMatchObject({ code: 'code_already_used' });
      expect(await auditCount(sql, 'auth.mfa_failed', email)).toBe(1);
      const [row] = await sql`select failed_sign_ins from users where email = ${email}`;
      expect(row?.failed_sign_ins).toBe(0);
    });

    it('accepts each recovery code once', async () => {
      const email = await createUser(sql);
      const { recoveryCodes } = await enableMfa(email);
      const recoveryCode = (recoveryCodes[0] ?? '').toLowerCase();

      const { challengeToken } = (await signIn(email)).body as { challengeToken: string };
      await request(server())
        .post('/api/auth/mfa/verify')
        .send({ challengeToken, recoveryCode })
        .expect(200);
      await request(server())
        .post('/api/auth/mfa/verify')
        .send({ challengeToken, recoveryCode })
        .expect(401);
      expect(await auditCount(sql, 'auth.recovery_code_used', email)).toBe(1);
    });

    it('voids an outstanding challenge when the password changes', async () => {
      const email = await createUser(sql);
      const { secret } = await enableMfa(email);
      const { challengeToken } = (await signIn(email)).body as { challengeToken: string };

      await request(server()).post('/api/auth/password/forgot').send({ email }).expect(202);
      await request(server())
        .post('/api/auth/password/reset')
        .send({ token: await linkToken(email, 'reset-password'), password: NEW_PASSWORD })
        .expect(204);

      await request(server())
        .post('/api/auth/mfa/verify')
        .send({ challengeToken, code: totpCode(secret, 1) })
        .expect(401);
    });

    it('turns off only with the password and a fresh code', async () => {
      const email = await createUser(sql);
      const { secret, token } = await enableMfa(email);

      await authed(token, '/api/auth/mfa/disable')
        .send({ password: 'wrong password', code: totpCode(secret, 1) })
        .expect(401);
      await authed(token, '/api/auth/mfa/disable')
        .send({ password: TEST_PASSWORD, code: totpCode(secret, 1) })
        .expect(204);

      const response = await signIn(email);
      expect(response.body).toMatchObject({ user: { email } });
      expect(await auditCount(sql, 'auth.mfa_disabled', email)).toBe(1);
    });
  });

  describe('registration', () => {
    const register = (body: Record<string, unknown>) =>
      request(server()).post('/api/auth/register').send(body);

    it('confirms the email, sets the password from the link, then waits for approval', async () => {
      const email = `new-${Date.now()}@lead.test`;
      const response = await register({ email, displayName: 'Learner 99', role: 'student' }).expect(
        202,
      );
      expect(response.body).toEqual({ message: REGISTRATION_ACCEPTED });

      const token = await linkToken(email, 'confirm-email');
      const [before] = await sql`
        select status, role, password_hash, email_verified_at from users where email = ${email}`;
      expect(before).toMatchObject({ status: 'pending', role: 'student', password_hash: null });
      expect(before?.email_verified_at).toBeNull();

      const verified = await request(server())
        .post('/api/auth/email/verify')
        .send({ token, password: NEW_PASSWORD })
        .expect(200);
      expect(verified.body).toEqual({ message: EMAIL_VERIFIED });
      expect((await signIn(email, NEW_PASSWORD)).status).toBe(403);
      expect(await auditCount(sql, 'auth.email_verified', email)).toBe(1);

      await request(server())
        .post('/api/auth/email/verify')
        .send({ token, password: 'another passphrase' })
        .expect(400);
    });

    it('lets only the inbox owner finish an unconfirmed registration', async () => {
      const email = `contested-${Date.now()}@lead.test`;
      await register({ email, displayName: 'First Try', role: 'teacher' }).expect(202);
      const firstToken = await linkToken(email, 'confirm-email');

      await skipCooldown(email);
      await register({ email, displayName: 'Second Try', role: 'student' }).expect(202);
      const secondToken = await linkToken(email, 'confirm-email');

      expect(secondToken).not.toBe(firstToken);
      const [row] = await sql`select display_name, role from users where email = ${email}`;
      expect(row).toMatchObject({ display_name: 'Second Try', role: 'student' });
      await request(server())
        .post('/api/auth/email/verify')
        .send({ token: firstToken, password: NEW_PASSWORD })
        .expect(400);
    });

    it('answers the same for an existing account, sends nothing and changes nothing', async () => {
      const email = await createUser(sql, { role: 'teacher' });
      const sentBefore = testApp.mailer.sent.length;

      const response = await register({ email, displayName: 'Impostor', role: 'student' }).expect(
        202,
      );
      await accounts.drain();

      expect(response.body).toEqual({ message: REGISTRATION_ACCEPTED });
      expect(testApp.mailer.sent.length).toBe(sentBefore);
      const [row] = await sql`select display_name, role from users where email = ${email}`;
      expect(row).toMatchObject({ display_name: 'Test User', role: 'teacher' });
      expect(await auditCount(sql, 'auth.registration_repeated', email)).toBe(1);
    });

    it('refuses administrator self-registration', async () => {
      await register({
        email: `x-${Date.now()}@lead.test`,
        displayName: 'X Person',
        role: 'admin',
      }).expect(400);
    });
  });

  describe('password recovery', () => {
    const forgot = (email: string) =>
      request(server()).post('/api/auth/password/forgot').send({ email });
    const reset = (token: string, password = NEW_PASSWORD) =>
      request(server()).post('/api/auth/password/reset').send({ token, password });

    it('emails a link that sets a new password and signs out every session', async () => {
      const email = await createUser(sql);
      const { accessToken } = (await signIn(email)).body as { accessToken: string };

      const requested = await forgot(email).expect(202);
      expect(requested.body).toEqual({ message: RESET_REQUESTED });
      await reset(await linkToken(email, 'reset-password')).expect(204);

      await request(server())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
      expect((await signIn(email)).status).toBe(401);
      expect((await signIn(email, NEW_PASSWORD)).status).toBe(200);
      expect(await auditCount(sql, 'auth.password_reset', email)).toBe(1);
    });

    it('uses each link once, and only the newest link works', async () => {
      const email = await createUser(sql);

      await forgot(email).expect(202);
      const older = await linkToken(email, 'reset-password');
      await skipCooldown(email);
      await forgot(email).expect(202);
      const newer = await linkToken(email, 'reset-password');

      await reset(older).expect(400);
      await reset(newer).expect(204);
      await reset(newer, 'another new passphrase').expect(400);
    });

    it('sends at most one email a minute per account', async () => {
      const email = await createUser(sql);

      await forgot(email).expect(202);
      await forgot(email).expect(202);
      await accounts.drain();

      expect(testApp.mailer.sent.filter((message) => message.to === email)).toHaveLength(1);
    });

    it('sends nothing for unknown or pending accounts but answers the same', async () => {
      const pending = await createUser(sql, { status: 'pending' });
      const sentBefore = testApp.mailer.sent.length;

      for (const email of [pending, 'nobody@lead.test']) {
        const response = await forgot(email).expect(202);
        expect(response.body).toEqual({ message: RESET_REQUESTED });
      }
      await accounts.drain();
      expect(testApp.mailer.sent.length).toBe(sentBefore);
    });

    it('refuses an expired link', async () => {
      const email = await createUser(sql);
      await forgot(email).expect(202);
      const token = await linkToken(email, 'reset-password');
      await sql`
        update account_tokens set expires_at = now() - interval '1 minute'
        where user_id = (select id from users where email = ${email})`;

      await reset(token).expect(400);
    });
  });
});
