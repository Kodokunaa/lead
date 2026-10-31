import type { AccountStatus, Role } from '@lead/schema';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { hashPassword } from '../src/auth/password';

export const TEST_PASSWORD = 'correct horse battery staple';
export const WEB_ORIGIN = 'http://localhost:5173';

let passwordHash: Promise<string> | undefined;

/** Inserts a user with TEST_PASSWORD and returns its unique email. */
export async function createUser(
  sql: Sql,
  overrides: { role?: Role; status?: AccountStatus } = {},
): Promise<string> {
  passwordHash ??= hashPassword(TEST_PASSWORD);
  const email = `user-${randomUUID()}@lead.test`;
  await sql`
    insert into users (email, display_name, role, status, password_hash, email_verified_at)
    values (${email}, 'Test User', ${overrides.role ?? 'student'},
            ${overrides.status ?? 'active'}, ${await passwordHash}, now())`;
  return email;
}

/** Audit events of one action whose actor is the user with this email. */
export async function auditCount(sql: Sql, action: string, actorEmail: string): Promise<number> {
  const [row] = await sql`
    select count(*)::int as n from audit_events a join users u on u.id = a.actor_id
    where a.action = ${action} and u.email = ${actorEmail}`;
  return (row?.n as number | undefined) ?? 0;
}
