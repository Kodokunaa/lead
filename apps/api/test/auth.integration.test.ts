import type { AccountStatus, Role } from '@lead/schema';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SIGN_IN_LIMIT_PER_MINUTE } from '../src/auth/http';
import { REFRESH_COOKIE } from '../src/auth/session-cookies';
import { AuthError, AuthService, MAX_FAILED_SIGN_INS } from '../src/auth/auth.service';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import {
  auditCount as countAuditEvents,
  createUser as createTestUser,
  TEST_PASSWORD,
  WEB_ORIGIN,
} from './test-users';

const PASSWORD = TEST_PASSWORD;
const client = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

describe('authentication (integration)', () => {
  let testApp: TestApp;
  let sql: Sql;
  let auth: AuthService;
  const server = () => testApp.server();

  const createUser = (overrides: { role?: Role; status?: AccountStatus } = {}) =>
    createTestUser(sql, overrides);

  function refreshCookieFrom(response: request.Response): string {
    const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
    const cookie = cookies.find((value) => value.startsWith(`${REFRESH_COOKIE}=`));
    if (!cookie) throw new Error('No refresh cookie set');
    return cookie.split(';')[0] ?? '';
  }

  async function signIn(email: string) {
    return request(server())
      .post('/api/auth/sign-in')
      .send({ email, password: PASSWORD })
      .expect(200);
  }

  const auditCount = (action: string, actorEmail: string) =>
    countAuditEvents(sql, action, actorEmail);

  beforeAll(async () => {
    testApp = await createTestApp();
    sql = testApp.app.get<Sql>(SQL_CLIENT);
    auth = testApp.app.get(AuthService);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('signs in, sets an httpOnly refresh cookie and audits the sign-in', async () => {
    const email = await createUser({ role: 'teacher' });

    const response = await request(server())
      .post('/api/auth/sign-in')
      .send({ email: email.toUpperCase(), password: PASSWORD })
      .expect(200);

    const body = response.body as { accessToken: string; user: { email: string; role: Role } };
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.user).toMatchObject({ email, role: 'teacher' });
    expect(JSON.stringify(body)).not.toContain('passwordHash');

    const setCookie = ([] as string[]).concat(response.headers['set-cookie'] ?? []).join(';');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\/api\/auth/);
    expect(await auditCount('auth.signed_in', email)).toBe(1);
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    const email = await createUser();

    const unknown = await request(server())
      .post('/api/auth/sign-in')
      .send({ email: 'nobody@lead.test', password: PASSWORD })
      .expect(401);
    const wrong = await request(server())
      .post('/api/auth/sign-in')
      .send({ email, password: 'wrong password' })
      .expect(401);

    expect(unknown.body).toEqual(wrong.body);
  });

  it('rejects a malformed body with 400', async () => {
    await request(server()).post('/api/auth/sign-in').send({ email: 'x' }).expect(400);
  });

  it('handles a very long unknown email like any other wrong sign-in', async () => {
    const email = `${'a'.repeat(200)}@lead.test`;

    await request(server())
      .post('/api/auth/sign-in')
      .send({ email, password: PASSWORD })
      .expect(401);

    const [row] = await sql`
      select count(*)::int as n from audit_events where target_id = ${email}`;
    expect(row?.n).toBe(0);
  });

  it('tells pending and deactivated accounts why, but only after the right password', async () => {
    const pending = await createUser({ status: 'pending' });
    const deactivated = await createUser({ status: 'deactivated' });

    const pendingResponse = await request(server())
      .post('/api/auth/sign-in')
      .send({ email: pending, password: PASSWORD })
      .expect(403);
    expect(pendingResponse.body).toMatchObject({ code: 'account_pending' });

    await request(server())
      .post('/api/auth/sign-in')
      .send({ email: deactivated, password: 'wrong password' })
      .expect(401);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const email = await createUser();

    for (let attempt = 0; attempt < MAX_FAILED_SIGN_INS; attempt += 1) {
      await expect(auth.signIn({ email, password: 'wrong' }, client)).rejects.toBeInstanceOf(
        AuthError,
      );
    }

    await expect(auth.signIn({ email, password: PASSWORD }, client)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    expect(await auditCount('auth.locked_out', email)).toBe(1);
  });

  it('requires a valid access token for protected routes', async () => {
    const email = await createUser({ role: 'admin' });
    const { accessToken } = (await signIn(email)).body as { accessToken: string };

    await request(server()).get('/api/auth/me').expect(401);
    await request(server()).get('/api/auth/me').set('Authorization', 'Bearer nope').expect(401);
    const me = await request(server())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ email, role: 'admin' });
  });

  it('rotates the refresh token, and a replayed token ends the whole session', async () => {
    const email = await createUser();
    const first = refreshCookieFrom(await signIn(email));

    const rotated = await request(server())
      .post('/api/auth/refresh')
      .set('Cookie', first)
      .set('Origin', WEB_ORIGIN)
      .expect(200);
    const second = refreshCookieFrom(rotated);
    const { accessToken } = rotated.body as { accessToken: string };
    expect(second).not.toBe(first);

    // Move the rotation outside the duplicate-request grace window.
    await sql`
      update sessions
      set revoked_at = revoked_at - interval '1 minute', rotated_at = rotated_at - interval '1 minute'
      where revoked_at is not null
        and user_id = (select id from users where email = ${email})`;

    // Replaying the first token revokes the family, so the newer token dies too.
    await request(server())
      .post('/api/auth/refresh')
      .set('Cookie', first)
      .set('Origin', WEB_ORIGIN)
      .expect(401);
    await request(server())
      .post('/api/auth/refresh')
      .set('Cookie', second)
      .set('Origin', WEB_ORIGIN)
      .expect(401);
    await request(server())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    expect(await auditCount('auth.refresh_reused', email)).toBe(1);
  });

  it('answers a duplicate refresh with 409 and keeps the session alive', async () => {
    const email = await createUser();
    const first = refreshCookieFrom(await signIn(email));
    const refresh = (cookie: string) =>
      request(server()).post('/api/auth/refresh').set('Cookie', cookie).set('Origin', WEB_ORIGIN);

    const rotated = await refresh(first).expect(200);
    const duplicate = await refresh(first).expect(409);

    // The duplicate must not clear the cookie the first response just set.
    expect(duplicate.headers['set-cookie']).toBeUndefined();
    await refresh(refreshCookieFrom(rotated)).expect(200);
    expect(await auditCount('auth.refresh_reused', email)).toBe(0);
  });

  it('never extends a session past its absolute maximum age', async () => {
    const email = await createUser();
    const cookie = refreshCookieFrom(await signIn(email));
    await sql`
      update sessions set family_started_at = now() - interval '30 days' + interval '1 hour'
      where user_id = (select id from users where email = ${email})`;

    await request(server())
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .expect(200);

    const [live] = await sql`
      select expires_at from sessions
      where revoked_at is null and user_id = (select id from users where email = ${email})`;
    // Drizzle's postgres-js setup returns timestamps from raw queries as strings.
    const expiresAt = new Date(live?.expires_at as string).getTime();
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000 + 5_000);
  });

  it('refuses refresh and sign-out from another origin', async () => {
    const email = await createUser();
    const cookie = refreshCookieFrom(await signIn(email));

    await request(server())
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .expect(403);
    await request(server())
      .post('/api/auth/sign-out')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  it('signs out: the refresh token and existing access tokens stop working', async () => {
    const email = await createUser();
    const response = await signIn(email);
    const cookie = refreshCookieFrom(response);
    const { accessToken } = response.body as { accessToken: string };

    await request(server())
      .post('/api/auth/sign-out')
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .expect(204);

    await request(server())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    await request(server())
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .expect(401);
    expect(await auditCount('auth.signed_out', email)).toBe(1);
  });

  it('cuts off a signed-in user as soon as the account is deactivated', async () => {
    const email = await createUser();
    const { accessToken } = (await signIn(email)).body as { accessToken: string };

    await sql`update users set status = 'deactivated' where email = ${email}`;

    await request(server())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  // Last, because it uses up this IP's sign-in budget for the rest of the minute.
  it('rate-limits sign-in attempts', async () => {
    let limited = false;
    for (let attempt = 0; attempt <= SIGN_IN_LIMIT_PER_MINUTE && !limited; attempt += 1) {
      const response = await request(server())
        .post('/api/auth/sign-in')
        .send({ email: 'nobody@lead.test', password: 'x' });
      limited = response.status === 429;
    }

    expect(limited).toBe(true);
  }, 60_000);
});
