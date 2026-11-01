import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { createUser, TEST_PASSWORD } from './test-users';

describe('administrator user management (integration)', () => {
  let testApp: TestApp;
  let sql: Sql;
  let adminEmail: string;
  let adminToken: string;
  const server = () => testApp.server();

  async function accessTokenFor(email: string): Promise<string> {
    const response = await request(server())
      .post('/api/auth/sign-in')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  async function idOf(email: string): Promise<string> {
    const [row] = await sql`select id from users where email = ${email}`;
    return row?.id as string;
  }

  const asAdmin = (method: 'get' | 'post', path: string) => {
    const url = `/api/admin/users${path}`;
    const call = method === 'get' ? request(server()).get(url) : request(server()).post(url);
    return call.set('Authorization', `Bearer ${adminToken}`);
  };

  /** A self-registered account that confirmed its email and waits for approval. */
  async function confirmedRegistration(): Promise<string> {
    const email = await createUser(sql, { status: 'pending' });
    return email;
  }

  async function lastAudit(action: string, targetId: string) {
    const [row] = await sql`
      select reason, before, after, actor_id from audit_events
      where action = ${action} and target_id = ${targetId}
      order by occurred_at desc limit 1`;
    return row;
  }

  beforeAll(async () => {
    testApp = await createTestApp();
    sql = testApp.app.get<Sql>(SQL_CLIENT);
    adminEmail = await createUser(sql, { role: 'admin' });
    adminToken = await accessTokenFor(adminEmail);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('is for administrators only', async () => {
    const teacherToken = await accessTokenFor(await createUser(sql, { role: 'teacher' }));

    await request(server()).get('/api/admin/users').expect(401);
    await request(server())
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(403);
  });

  it('lists, filters and searches accounts, and counts the approval queue', async () => {
    const pending = await confirmedRegistration();
    const unconfirmed = await createUser(sql, { status: 'pending' });
    await sql`update users set email_verified_at = null where email = ${unconfirmed}`;

    const all = await asAdmin('get', '').expect(200);
    const body = all.body as {
      items: { email: string }[];
      total: number;
      awaitingApproval: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.awaitingApproval).toBeGreaterThanOrEqual(1);

    const filtered = await asAdmin(
      'get',
      `?status=pending&q=${encodeURIComponent(pending)}`,
    ).expect(200);
    const items = (filtered.body as { items: { email: string; emailVerified: boolean }[] }).items;
    expect(items).toEqual([expect.objectContaining({ email: pending, emailVerified: true })]);

    await asAdmin('get', '?status=bogus').expect(400);
  });

  it('treats search wildcards as plain text', async () => {
    const response = await asAdmin('get', `?q=${encodeURIComponent('%')}`).expect(200);
    expect((response.body as { items: unknown[] }).items).toEqual([]);
  });

  it('approves a confirmed registration and emails the person', async () => {
    const email = await confirmedRegistration();
    const id = await idOf(email);

    const response = await asAdmin('post', `/${id}/approve`).expect(200);

    expect(response.body).toMatchObject({ email, status: 'active' });
    expect(testApp.mailer.lastTo(email)?.subject).toBe('Your LEAD account is ready');
    expect(await lastAudit('account.approved', id)).toMatchObject({
      before: { status: 'pending' },
      after: { status: 'active' },
      actor_id: await idOf(adminEmail),
    });
    await asAdmin('post', `/${id}/approve`).expect(409);
  });

  it('will not approve someone who has not confirmed their email', async () => {
    const email = await createUser(sql, { status: 'pending' });
    await sql`update users set email_verified_at = null where email = ${email}`;

    await asAdmin('post', `/${await idOf(email)}/approve`).expect(409);
  });

  it('needs a reason to deactivate, and signs the person out at once', async () => {
    const email = await createUser(sql);
    const id = await idOf(email);
    const userToken = await accessTokenFor(email);

    await asAdmin('post', `/${id}/deactivate`).send({}).expect(400);
    await asAdmin('post', `/${id}/deactivate`).send({ reason: 'Left the college' }).expect(200);

    await request(server())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(401);
    expect(await lastAudit('account.deactivated', id)).toMatchObject({
      reason: 'Left the college',
    });

    await asAdmin('post', `/${id}/reactivate`).send({ reason: 'Re-enrolled' }).expect(200);
    await accessTokenFor(email);
  });

  it('changes a role with a reason and signs the person out to pick it up', async () => {
    const email = await createUser(sql, { role: 'student' });
    const id = await idOf(email);
    const userToken = await accessTokenFor(email);

    const response = await asAdmin('post', `/${id}/role`)
      .send({ role: 'teacher', reason: 'Hired as faculty' })
      .expect(200);

    expect(response.body).toMatchObject({ role: 'teacher' });
    await request(server())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(401);
    expect(await lastAudit('account.role_changed', id)).toMatchObject({
      reason: 'Hired as faculty',
      before: { role: 'student' },
      after: { role: 'teacher' },
    });
    await asAdmin('post', `/${id}/role`).send({ role: 'teacher', reason: 'Again' }).expect(409);
  });

  it('rejects a pending registration with a reason', async () => {
    const email = await confirmedRegistration();
    const id = await idOf(email);

    await asAdmin('post', `/${id}/reject`).send({ reason: 'Not a CCC student' }).expect(200);

    const [row] = await sql`select status from users where id = ${id}`;
    expect(row?.status).toBe('rejected');
    // Reactivating is for accounts that were active; it must not quietly approve a rejection.
    await asAdmin('post', `/${id}/reactivate`).send({ reason: 'Changed my mind' }).expect(409);
  });

  it('will not approve an account that never set a password', async () => {
    const email = await confirmedRegistration();
    await sql`update users set password_hash = null where email = ${email}`;

    await asAdmin('post', `/${await idOf(email)}/approve`).expect(409);
  });

  it('resets two-step verification without recording the secret', async () => {
    const email = await createUser(sql);
    const id = await idOf(email);
    await sql`
      update users set mfa_secret = 'v1.sealed', mfa_enabled_at = now(), mfa_last_step = 1
      where id = ${id}`;

    // The administrator's own password is required as well as the reason.
    await asAdmin('post', `/${id}/mfa/reset`)
      .send({ reason: 'Lost phone, ID checked' })
      .expect(400);
    await asAdmin('post', `/${id}/mfa/reset`)
      .send({ reason: 'Lost phone, ID checked', password: 'wrong password' })
      .expect(401);
    await asAdmin('post', `/${id}/mfa/reset`)
      .send({ reason: 'Lost phone, ID checked', password: TEST_PASSWORD })
      .expect(200);
    expect(testApp.mailer.lastTo(email)?.subject).toBe('Two-step verification was reset');

    const [row] = await sql`select mfa_secret, mfa_enabled_at from users where id = ${id}`;
    expect(row).toMatchObject({ mfa_secret: null, mfa_enabled_at: null });
    const audit = await lastAudit('account.mfa_reset', id);
    expect(audit?.before).toMatchObject({ mfaSecret: true });
    expect(JSON.stringify(audit)).not.toContain('v1.sealed');
  });

  it('will not let an administrator change their own account', async () => {
    const id = await idOf(adminEmail);

    await asAdmin('post', `/${id}/deactivate`).send({ reason: 'Oops' }).expect(403);
    await asAdmin('post', `/${id}/role`).send({ role: 'student', reason: 'Oops' }).expect(403);
  });

  it('emails the person when their account is deactivated or their role changes', async () => {
    const email = await createUser(sql);
    const id = await idOf(email);

    await asAdmin('post', `/${id}/role`).send({ role: 'teacher', reason: 'Hired' }).expect(200);
    expect(testApp.mailer.lastTo(email)?.subject).toBe('Your LEAD role changed');
    await asAdmin('post', `/${id}/deactivate`).send({ reason: 'Left' }).expect(200);
    expect(testApp.mailer.lastTo(email)?.subject).toBe('Your LEAD account was deactivated');
  });

  it('never leaves LEAD without an active administrator, even when two act at once', async () => {
    // Two administrators, each about to remove the other.
    const first = await createUser(sql, { role: 'admin' });
    const second = await createUser(sql, { role: 'admin' });
    const [firstToken, secondToken] = [await accessTokenFor(first), await accessTokenFor(second)];
    // Every other administrator stops being one, so these two are the last.
    await sql`
      update users set status = 'deactivated'
      where role = 'admin' and email not in (${first}, ${second})`;

    const demote = (token: string, target: string) =>
      idOf(target).then((id) =>
        request(server())
          .post(`/api/admin/users/${id}/role`)
          .set('Authorization', `Bearer ${token}`)
          .send({ role: 'teacher', reason: 'Mutual demotion' }),
      );

    // Hold the administrator-change lock so both requests are waiting at the same point,
    // then let them go: without the lock and re-checks, both would succeed.
    let pending: Promise<request.Response[]> | undefined;
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(742001)`;
      pending = Promise.all([demote(firstToken, second), demote(secondToken, first)]);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    // Released on commit; both requests now take the lock one after the other.
    const results = await (pending ?? Promise.resolve([]));

    const statuses = results.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 403]);
    const [admins] = await sql`
      select count(*)::int as n from users
      where role = 'admin' and status = 'active' and email in (${first}, ${second})`;
    expect(admins?.n).toBe(1);

    // The other administrators are restored for the remaining tests.
    await sql`update users set status = 'active' where role = 'admin' and status = 'deactivated'`;
  });

  it('shows details with recent activity', async () => {
    const email = await createUser(sql);
    const id = await idOf(email);
    await accessTokenFor(email);

    const response = await asAdmin('get', `/${id}`).expect(200);

    expect(response.body).toMatchObject({ email, activeSessions: 1 });
    const activity = (response.body as { activity: { action: string }[] }).activity;
    expect(activity.map((event) => event.action)).toContain('auth.signed_in');
    await asAdmin('get', '/not-a-uuid').expect(400);
    await asAdmin('get', '/7f9c2d1e-3b4a-4c5d-8e6f-0a1b2c3d4e5f').expect(404);
  });
});
