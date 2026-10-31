import { sql } from 'drizzle-orm';
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { AUDIT_OUTCOMES, ROLES } from '@lead/schema';

export const roleEnum = pgEnum('role', ROLES);
export const auditOutcomeEnum = pgEnum('audit_outcome', AUDIT_OUTCOMES);

/**
 * Append-only audit trail (wireframe A15). Triggers reject UPDATE, DELETE and TRUNCATE.
 * Phase 1 adds a separate runtime database role limited to SELECT/INSERT on this table,
 * so the app cannot disable the triggers; until then the app connects as the table owner.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorRole: roleEnum('actor_role'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    outcome: auditOutcomeEnum('outcome').notNull(),
    reason: text('reason'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (table) => [
    index('audit_events_occurred_at_idx').on(table.occurredAt),
    index('audit_events_actor_idx').on(table.actorId, table.occurredAt),
    index('audit_events_target_idx').on(table.targetType, table.targetId),
  ],
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
