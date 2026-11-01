import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  primaryKey,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ACCOUNT_STATUSES,
  AUDIT_OUTCOMES,
  CONTENT_STATUSES,
  ENROLLMENT_STATUSES,
  ROLES,
  SEMESTERS,
  type AuditAction,
} from '@lead/schema';

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

export const semesterEnum = pgEnum('semester', SEMESTERS);

/** Degree programs offered by CCC (seeded by migration 0007). */
export const programs = pgTable(
  'programs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    code: text('code').notNull(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('programs_code_idx').on(sql`lower(${table.code})`)],
);

/** A semester of a school year. At most one term is current (partial unique index). */
export const academicTerms = pgTable(
  'academic_terms',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    schoolYear: text('school_year').notNull(),
    semester: semesterEnum('semester').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    current: boolean('current').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('academic_terms_year_semester_idx').on(table.schoolYear, table.semester),
    uniqueIndex('academic_terms_current_idx')
      .on(table.current)
      .where(sql`${table.current}`),
  ],
);

/** The course catalog. Archived courses keep their history but get no new sections. */
export const courses = pgTable(
  'courses',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Uppercase, single spaces (see courseCodeSchema). */
    code: text('code').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    units: integer('units').notNull(),
    /** Null for general education courses shared by every program. */
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('courses_code_idx').on(table.code),
    index('courses_program_idx').on(table.programId),
  ],
);

export const enrollmentStatusEnum = pgEnum('enrollment_status', ENROLLMENT_STATUSES);

/** A class: one course taught in one term, e.g. IS 301 · BSIS 3-A · First Semester 2026-2027. */
export const classSections = pgTable(
  'sections',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => academicTerms.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    capacity: integer('capacity').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sections_course_term_name_idx').on(
      table.courseId,
      table.termId,
      sql`lower(${table.name})`,
    ),
    index('sections_term_idx').on(table.termId),
    check('sections_capacity_check', sql`${table.capacity} between 1 and 200`),
  ],
);

/** Which teachers run which sections. */
export const teachingAssignments = pgTable(
  'teaching_assignments',
  {
    sectionId: uuid('section_id')
      .notNull()
      .references(() => classSections.id, { onDelete: 'cascade' }),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.sectionId, table.teacherId] }),
    index('teaching_assignments_teacher_idx').on(table.teacherId),
  ],
);

/**
 * A student's place in a section. Dropping keeps the row (status `dropped`) so the history and
 * any grades stay attached; re-enrolling sets it back to `enrolled`.
 */
export const enrollments = pgTable(
  'enrollments',
  {
    sectionId: uuid('section_id')
      .notNull()
      .references(() => classSections.id, { onDelete: 'restrict' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: enrollmentStatusEnum('status').notNull().default('enrolled'),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
    droppedAt: timestamp('dropped_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.sectionId, table.studentId] }),
    index('enrollments_student_idx').on(table.studentId),
  ],
);

export type SectionRow = typeof classSections.$inferSelect;

export const contentStatusEnum = pgEnum('content_status', CONTENT_STATUSES);

/** What students should be able to do after a course, numbered O1, O2, … per course. */
export const learningObjectives = pgTable(
  'learning_objectives',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    /** Running number within the course; the code shown is `O${number}`. */
    number: integer('number').notNull(),
    description: text('description').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('learning_objectives_course_number_idx').on(table.courseId, table.number),
  ],
);

/** A unit of a course's outline (wireframes T04, T05). Shared by every section of the course. */
export const courseModules = pgTable(
  'course_modules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    requiresPrevious: boolean('requires_previous').notNull().default(false),
    /** Score (50–100%) that counts as mastered; null means no mastery condition. */
    masteryThreshold: integer('mastery_threshold'),
    status: contentStatusEnum('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('course_modules_course_idx').on(table.courseId, table.position),
    check(
      'course_modules_mastery_check',
      sql`${table.masteryThreshold} is null or ${table.masteryThreshold} between 50 and 100`,
    ),
  ],
);

/** Which objectives a module teaches. */
export const moduleObjectives = pgTable(
  'module_objectives',
  {
    moduleId: uuid('module_id')
      .notNull()
      .references(() => courseModules.id, { onDelete: 'cascade' }),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => learningObjectives.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ columns: [table.moduleId, table.objectiveId] }),
    index('module_objectives_objective_idx').on(table.objectiveId),
  ],
);

/** A lesson in a module (wireframe T06), mapped to one of the module's objectives. */
export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => courseModules.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    objectiveId: uuid('objective_id').references(() => learningObjectives.id, {
      onDelete: 'restrict',
    }),
    body: text('body').notNull().default(''),
    status: contentStatusEnum('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('lessons_module_idx').on(table.moduleId, table.position),
    // Backstop for the service's publishing rule: a published lesson has an objective and text.
    check(
      'lessons_publishable_check',
      sql`${table.status} <> 'published' or (${table.objectiveId} is not null and btrim(${table.body}) <> '')`,
    ),
  ],
);

export type ModuleRow = typeof courseModules.$inferSelect;
export type LessonRow = typeof lessons.$inferSelect;

export type ProgramRow = typeof programs.$inferSelect;
export type TermRow = typeof academicTerms.$inferSelect;
export type CourseRow = typeof courses.$inferSelect;

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
