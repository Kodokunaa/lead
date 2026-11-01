import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { hashPassword } from '../src/auth/password';
import { auditCount, createUser, TEST_PASSWORD } from './test-users';

interface Session {
  readonly id: string;
  readonly current: boolean;
}

describe("a user's own account (integration)", () => {
  let testApp: TestApp;
  let sql: Sql;
  const server = () => testApp.server();

  async function signIn(email: string, userAgent = 'vitest', password = TEST_PASSWORD) {
    return request(server())
      .post('/api/auth/sign-in')
      .set('User-Agent', userAgent)
      .send({ email, password });
  }

  async function tokenFor(email: string, userAgent?: string): Promise<string> {
    const response = await signIn(email, userAgent);
    expect(response.status).toBe(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  const as = (token: string) => ({
    get: (path: string) =>
      request(server()).get(`/api/me${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string) =>
      request(server()).post(`/api/me${path}`).set('Authorization', `Bearer ${token}`),
    patch: (path: string) =>
      request(server()).patch(`/api/me${path}`).set('Authorization', `Bearer ${token}`),
  });

  beforeAll(async () => {
    testApp = await createTestApp();
    sql = testApp.app.get<Sql>(SQL_CLIENT);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('lists each signed-in device once, current first, even after token rotation', async () => {
    const email = await createUser(sql);
    await tokenFor(email, 'Laptop');
    const phone = await signIn(email, 'Phone');
    const cookie = String(phone.headers['set-cookie']).split(';')[0] ?? '';
    // Rotating the phone's refresh token must not show up as a third device.
    const rotated = await request(server())
      .post('/api/auth/refresh')
      .set('User-Agent', 'Phone')
      .set('Cookie', cookie)
      .expect(200);
    const rotatedToken = (rotated.body as { accessToken: string }).accessToken;

    const response = await as(rotatedToken).get('/sessions').expect(200);
    const list = response.body as (Session & { userAgent: string })[];

    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ current: true, userAgent: 'Phone' });
    expect(list[1]).toMatchObject({ current: false, userAgent: 'Laptop' });
  });

  it('signs out one device, or every other device', async () => {
    const email = await createUser(sql);
    const laptop = await tokenFor(email, 'Laptop');
    const tablet = await tokenFor(email, 'Tablet');
    const phone = await tokenFor(email, 'Phone');

    const list = (await as(phone).get('/sessions').expect(200)).body as (Session & {
      userAgent: string;
    })[];
    const laptopSession = list.find((session) => session.userAgent === 'Laptop');
    await as(phone).post(`/sessions/${laptopSession?.id}/revoke`).expect(204);
    await as(laptop).get('/sessions').expect(401);
    await as(tablet).get('/sessions').expect(200);

    await as(phone).post('/sessions/revoke-others').expect(204);
    await as(tablet).get('/sessions').expect(401);
    await as(phone).get('/sessions').expect(200);
    expect(await auditCount(sql, 'auth.session_revoked', email)).toBe(2);
  });

  it("cannot sign out someone else's session", async () => {
    const victim = await createUser(sql);
    const victimToken = await tokenFor(victim);
    const victimSession = ((await as(victimToken).get('/sessions')).body as Session[])[0];
    const attacker = await tokenFor(await createUser(sql));

    await as(attacker).post(`/sessions/${victimSession?.id}/revoke`).expect(404);
    await as(victimToken).get('/sessions').expect(200);
  });

  it('updates the display name', async () => {
    const email = await createUser(sql);
    const token = await tokenFor(email);

    const response = await as(token)
      .patch('/profile')
      .send({ displayName: '  Learner Renamed ' })
      .expect(200);

    expect(response.body).toMatchObject({ email, displayName: 'Learner Renamed' });
    await as(token).patch('/profile').send({ displayName: 'x' }).expect(400);
  });

  it('refuses a password change if the password changed meanwhile', async () => {
    const email = await createUser(sql);
    const token = await tokenFor(email);
    const otherHash = await hashPassword('changed in another tab');

    // Hold the user's row, let the request check the old password and queue its update,
    // then change the password underneath it, as another tab or a reset would.
    let pending: Promise<request.Response> | undefined;
    await sql.begin(async (tx) => {
      await tx`select id from users where email = ${email} for update`;
      pending = as(token)
        .post('/password')
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'a brand new passphrase' })
        .then((response) => response);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await tx`update users set password_hash = ${otherHash} where email = ${email}`;
    });

    expect((await pending)?.status).toBe(409);
    expect((await signIn(email, 'x', 'changed in another tab')).status).toBe(200);
  });

  it('treats a damaged stored password as a failed check, not a server error', async () => {
    const email = await createUser(sql);
    const token = await tokenFor(email);
    await sql`update users set password_hash = 'not-a-real-hash' where email = ${email}`;

    await as(token)
      .post('/password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a brand new passphrase' })
      .expect(401);
  });

  it('changes the password with the current one, signing out other devices', async () => {
    const email = await createUser(sql);
    const other = await tokenFor(email, 'Laptop');
    const token = await tokenFor(email, 'Phone');

    await as(token)
      .post('/password')
      .send({ currentPassword: 'wrong password', newPassword: 'a brand new passphrase' })
      .expect(401);
    await as(token)
      .post('/password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' })
      .expect(400);
    await as(token)
      .post('/password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a brand new passphrase' })
      .expect(204);

    await as(other).get('/sessions').expect(401);
    await as(token).get('/sessions').expect(200);
    expect((await signIn(email, 'x', 'a brand new passphrase')).status).toBe(200);
    expect(testApp.mailer.lastTo(email)?.subject).toBe('Your LEAD password was changed');
  });
});
