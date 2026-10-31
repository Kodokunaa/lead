import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuditEventInput } from '@lead/schema';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditModule } from '../src/audit/audit.module';
import { AuditService } from '../src/audit/audit.service';
import { ConfigModule } from '../src/config/config.module';
import { DatabaseModule, SQL_CLIENT } from '../src/database/database.module';
import { prepareTestDatabase } from './test-database';

function event(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    actorId: randomUUID(),
    actorRole: 'teacher',
    action: 'intervention.assigned',
    targetType: 'intervention',
    targetId: `plan-${randomUUID()}`,
    outcome: 'success',
    reason: null,
    before: null,
    after: { status: 'planned' },
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    ...overrides,
  };
}

describe('AuditService (integration)', () => {
  let audit: AuditService;
  let sql: Sql;
  let close: () => Promise<void>;

  beforeAll(async () => {
    process.env.DATABASE_URL = await prepareTestDatabase();
    process.env.WEB_ORIGIN ??= 'http://localhost:5173';

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, AuditModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    audit = app.get(AuditService);
    sql = app.get<Sql>(SQL_CLIENT);
    close = () => app.close();
  });

  afterAll(async () => {
    await close();
  });

  it('stores an event and returns the saved row', async () => {
    const input = event();
    const row = await audit.record(input);

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.action).toBe('intervention.assigned');
    expect(row.targetId).toBe(input.targetId);
    expect(row.after).toEqual({ status: 'planned' });
    expect(row.occurredAt).toBeInstanceOf(Date);
  });

  it('refuses a consequential action without a reason and stores nothing', async () => {
    const input = event({ action: 'grade.changed_after_release' });

    await expect(audit.record(input)).rejects.toBeInstanceOf(BadRequestException);

    const [result] =
      await sql`select count(*)::int as n from audit_events where target_id = ${input.targetId}`;
    expect(result?.n).toBe(0);
  });

  it('records a consequential action when a reason is given', async () => {
    const row = await audit.record(
      event({
        action: 'grade.changed_after_release',
        reason: 'Rubric correction',
        before: { score: 8 },
        after: { score: 10 },
      }),
    );

    expect(row.reason).toBe('Rubric correction');
  });

  it('blocks UPDATE, DELETE and TRUNCATE at the database level', async () => {
    const row = await audit.record(event());

    await expect(
      sql`update audit_events set action = 'tampered.event' where id = ${row.id}`,
    ).rejects.toThrow(/append-only/);
    await expect(sql`delete from audit_events where id = ${row.id}`).rejects.toThrow(/append-only/);
    await expect(sql`truncate audit_events`).rejects.toThrow(/append-only/);

    const [stored] = await sql`select action from audit_events where id = ${row.id}`;
    expect(stored?.action).toBe('intervention.assigned');
  });

  it('lists recent events newest first and clamps the page size', async () => {
    const recent = await audit.listRecent(1000);

    expect(recent.length).toBeLessThanOrEqual(100);
    const times = recent.map((row) => row.occurredAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
