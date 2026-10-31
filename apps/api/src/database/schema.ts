import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ACCOUNT_STATUSES, AUDIT_OUTCOMES, ROLES, type AuditAction } from '@lead/schema';

export const roleEnum = pgEnum('role', ROLES);
export const auditOutcomeEnum = pgEnum('audit_outcome', AUDIT_OUTCOMES);
export const accountStatusEnum = pgEnum('account_status', ACCOUNT_STATUSES);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Stored trimmed and lowercased (see emailSchema). */
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: roleEnum('role').notNull(),
    status: accountStatusEnum('status').notNull().default('pending'),
    passwordHash: text('password_hash'),
    /** Set once the owner of the address follows an emailed link. */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    failedSignIns: integer('failed_sign_ins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** TOTP secret, encrypted with MFA_ENCRYPTION_KEY (see secret-box.ts). Null until enabled. */
    mfaSecret: text('mfa_secret'),
    /** Secret from an unfinished setup; becomes mfaSecret once the user proves a code. */
    mfaPendingSecret: text('mfa_pending_secret'),
    mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),
    /** Last accepted TOTP time step, so a code cannot be used twice. */
    mfaLastStep: bigint('mfa_last_step', { mode: 'number' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)],
);

/**
 * One row per refresh token. Rotating a token revokes its row and inserts a successor in the
 * same family; presenting a revoked token again means it was stolen, so the family is revoked.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    familyId: uuid('family_id').notNull(),
    /** When the user signed in; caps the family's total lifetime (SESSION_MAX_AGE_MS). */
    familyStartedAt: timestamp('family_started_at', { withTimezone: true }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the refresh token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Set only when the token was swapped for a successor, never by sign-out or replay. */
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_idx').on(table.tokenHash),
    index('sessions_family_idx').on(table.familyId),
    index('sessions_user_idx').on(table.userId),
  ],
);

/** One-time MFA recovery codes; only SHA-256 hashes are stored. */
export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    createdAt: createdAt(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('recovery_codes_user_code_idx').on(table.userId, table.codeHash)],
);

export const ACCOUNT_TOKEN_PURPOSES = ['password_reset', 'email_verification'] as const;
export type AccountTokenPurpose = (typeof ACCOUNT_TOKEN_PURPOSES)[number];
export const accountTokenPurposeEnum = pgEnum('account_token_purpose', ACCOUNT_TOKEN_PURPOSES);

/** Single-use emailed links (password reset, email verification); only SHA-256 hashes stored. */
export const accountTokens = pgTable(
  'account_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: accountTokenPurposeEnum('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('account_tokens_hash_idx').on(table.tokenHash),
    index('account_tokens_user_purpose_idx').on(table.userId, table.purpose),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;

/**
 * Append-only audit trail (wireframe A15). Triggers reject UPDATE, DELETE and TRUNCATE, and the
 * API's runtime role (lead_app) only has SELECT and INSERT here and owns nothing, so it cannot
 * disable the triggers either.
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
    action: text('action').$type<AuditAction>().notNull(),
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
