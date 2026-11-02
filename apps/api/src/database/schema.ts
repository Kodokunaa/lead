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
  ASSESSMENT_KINDS,
  AUDIT_OUTCOMES,
  CALENDAR_EVENT_KINDS,
  CONTENT_STATUSES,
  DIFFICULTIES,
  QUESTION_KINDS,
  RESOURCE_STATUSES,
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

/** A term's grading periods, e.g. Prelim, Midterm, Finals (wireframe A08). */
export const gradingPeriods = pgTable(
  'grading_periods',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    termId: uuid('term_id')
      .notNull()
      .references(() => academicTerms.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('grading_periods_term_name_idx').on(table.termId, sql`lower(${table.name})`),
    check('grading_periods_dates_check', sql`${table.startsOn} <= ${table.endsOn}`),
  ],
);

export const calendarEventKindEnum = pgEnum('calendar_event_kind', CALENDAR_EVENT_KINDS);

/** Dates on a term's calendar: assessment periods, grade release, holidays, class events. */
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    termId: uuid('term_id')
      .notNull()
      .references(() => academicTerms.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    kind: calendarEventKindEnum('kind').notNull(),
    startsOn: date('starts_on').notNull(),
    /** Null for a single day. */
    endsOn: date('ends_on'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('calendar_events_term_idx').on(table.termId, table.startsOn),
    check(
      'calendar_events_dates_check',
      sql`${table.endsOn} is null or ${table.startsOn} <= ${table.endsOn}`,
    ),
  ],
);

/** Courses an event is limited to; an event with no rows here applies to every course. */
export const calendarEventCourses = pgTable(
  'calendar_event_courses',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.courseId] }),
    index('calendar_event_courses_course_idx').on(table.courseId),
  ],
);

export type CalendarEventRow = typeof calendarEvents.$inferSelect;

/** A course resource (wireframes T07, A10, A11); its content lives in its versions. */
export const resources = pgTable(
  'resources',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    moduleId: uuid('module_id').references(() => courseModules.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('resources_course_idx').on(table.courseId)],
);

export const resourceObjectives = pgTable(
  'resource_objectives',
  {
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => learningObjectives.id, { onDelete: 'restrict' }),
  },
  (table) => [primaryKey({ columns: [table.resourceId, table.objectiveId] })],
);

export const resourceStatusEnum = pgEnum('resource_status', RESOURCE_STATUSES);

/**
 * One submitted version: an uploaded file (stored under a random name) or a web link. Partial
 * unique indexes keep at most one pending and one approved version per resource.
 */
export const resourceVersions = pgTable(
  'resource_versions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    number: integer('number').notNull(),
    /** Original file name, cleaned; shown to people, never used as a path. */
    fileName: text('file_name'),
    /** Random name on disk. */
    storedName: text('stored_name'),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    sha256: text('sha256'),
    url: text('url'),
    status: resourceStatusEnum('status').notNull().default('pending'),
    submittedBy: uuid('submitted_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'restrict' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    note: text('note'),
  },
  (table) => [
    uniqueIndex('resource_versions_number_idx').on(table.resourceId, table.number),
    uniqueIndex('resource_versions_one_pending_idx')
      .on(table.resourceId)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex('resource_versions_one_approved_idx')
      .on(table.resourceId)
      .where(sql`${table.status} = 'approved'`),
    // A version is either a stored file or a link, never both or neither.
    check(
      'resource_versions_kind_check',
      sql`(${table.storedName} is not null and ${table.url} is null) or (${table.storedName} is null and ${table.url} is not null)`,
    ),
  ],
);

export type ResourceRow = typeof resources.$inferSelect;
export type ResourceVersionRow = typeof resourceVersions.$inferSelect;
export type LessonRow = typeof lessons.$inferSelect;

export const assessmentKindEnum = pgEnum('assessment_kind', ASSESSMENT_KINDS);
export const questionKindEnum = pgEnum('question_kind', QUESTION_KINDS);
export const difficultyEnum = pgEnum('difficulty', DIFFICULTIES);

/**
 * A quiz, examination, assignment or project of one class (wireframes T08–T12). Dates are the
 * class's, so the assessment belongs to the section, not the course.
 */
export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => classSections.id, { onDelete: 'restrict' }),
    kind: assessmentKindEnum('kind').notNull(),
    title: text('title').notNull(),
    instructions: text('instructions').notNull().default(''),
    opensAt: timestamp('opens_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    /** Null means untimed. */
    timeLimitMinutes: integer('time_limit_minutes'),
    maxAttempts: integer('max_attempts').notNull().default(1),
    status: contentStatusEnum('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('assessments_section_idx').on(table.sectionId),
    check(
      'assessments_time_limit_check',
      sql`${table.timeLimitMinutes} is null or ${table.timeLimitMinutes} between 1 and 600`,
    ),
    check('assessments_attempts_check', sql`${table.maxAttempts} between 1 and 10`),
    check(
      'assessments_window_check',
      sql`${table.opensAt} is null or ${table.dueAt} is null or ${table.dueAt} > ${table.opensAt}`,
    ),
    // Backstop for the service's publishing rule: a published assessment has both dates.
    check(
      'assessments_publishable_check',
      sql`${table.status} <> 'published' or (${table.opensAt} is not null and ${table.dueAt} is not null)`,
    ),
  ],
);

/** Which of the course's objectives an assessment measures. */
export const assessmentObjectives = pgTable(
  'assessment_objectives',
  {
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => learningObjectives.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ columns: [table.assessmentId, table.objectiveId] }),
    index('assessment_objectives_objective_idx').on(table.objectiveId),
  ],
);

/** A question of a quiz or examination (T10), mapped to one of the assessment's objectives. */
export const assessmentQuestions = pgTable(
  'assessment_questions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: questionKindEnum('kind').notNull(),
    prompt: text('prompt').notNull(),
    points: integer('points').notNull(),
    difficulty: difficultyEnum('difficulty').notNull().default('moderate'),
    objectiveId: uuid('objective_id').references(() => learningObjectives.id, {
      onDelete: 'restrict',
    }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('assessment_questions_assessment_idx').on(table.assessmentId, table.position),
    check('assessment_questions_points_check', sql`${table.points} between 1 and 100`),
  ],
);

/** The answer choices of a multiple-choice question; exactly one is correct. */
export const questionChoices = pgTable(
  'question_choices',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    questionId: uuid('question_id')
      .notNull()
      .references(() => assessmentQuestions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    correct: boolean('correct').notNull().default(false),
  },
  (table) => [
    index('question_choices_question_idx').on(table.questionId, table.position),
    uniqueIndex('question_choices_one_correct_idx')
      .on(table.questionId)
      .where(sql`${table.correct}`),
  ],
);

/** A rubric criterion of an assignment or project (T11). */
export const rubricCriteria = pgTable(
  'rubric_criteria',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
  },
  (table) => [index('rubric_criteria_assessment_idx').on(table.assessmentId, table.position)],
);

/** One level of a criterion, e.g. "Strong / 4" with what it looks like. */
export const rubricLevels = pgTable(
  'rubric_levels',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    criterionId: uuid('criterion_id')
      .notNull()
      .references(() => rubricCriteria.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    points: integer('points').notNull(),
    descriptor: text('descriptor').notNull().default(''),
  },
  (table) => [
    index('rubric_levels_criterion_idx').on(table.criterionId, table.position),
    uniqueIndex('rubric_levels_points_idx').on(table.criterionId, table.points),
    check('rubric_levels_points_check', sql`${table.points} between 0 and 100`),
  ],
);

export type AssessmentRow = typeof assessments.$inferSelect;
export type QuestionRow = typeof assessmentQuestions.$inferSelect;

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
