import { z } from 'zod';
import { reasonSchema } from './admin';
import { emailSchema } from './auth';
import { courseCodeSchema, SEMESTERS } from './catalog';

/** Section names as CCC writes them, e.g. "BSIS 3-A". */
export const sectionNameSchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1)
      .max(40)
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9 .-]*$/,
        'Use letters, digits, spaces, dots or dashes, e.g. "BSIS 3-A".',
      ),
  );

export const MAX_SECTION_CAPACITY = 200;
export const capacitySchema = z.coerce.number().int().min(1).max(MAX_SECTION_CAPACITY);

/** Enrollment: one email per line or separated by commas; at most this many per request. */
export const MAX_BULK_ENROLL = 100;

const termRef = z.object({
  id: z.uuid(),
  schoolYear: z.string(),
  semester: z.enum(SEMESTERS),
  current: z.boolean(),
});

export const personSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.string(),
});
export type Person = z.infer<typeof personSchema>;

export const sectionSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  capacity: z.number().int(),
  enrolled: z.number().int(),
  course: z.object({ id: z.uuid(), code: z.string(), title: z.string(), units: z.number().int() }),
  term: termRef,
  teachers: z.array(personSchema),
});
export type SectionSummary = z.infer<typeof sectionSummarySchema>;

export const ENROLLMENT_STATUSES = ['enrolled', 'dropped'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const rosterEntrySchema = personSchema.extend({
  status: z.enum(ENROLLMENT_STATUSES),
  enrolledAt: z.string(),
  droppedAt: z.string().nullable(),
});
export type RosterEntry = z.infer<typeof rosterEntrySchema>;

export const sectionDetailsSchema = sectionSummarySchema.extend({
  roster: z.array(rosterEntrySchema),
});
export type SectionDetails = z.infer<typeof sectionDetailsSchema>;

export const SECTION_PAGE_SIZE = 25;

export const sectionListQuerySchema = z.object({
  /** A term id; without it, the current term. */
  term: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type SectionListQuery = z.infer<typeof sectionListQuerySchema>;

export const sectionListResponseSchema = z.object({
  items: z.array(sectionSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** The term listed (the current one when none was asked for), or null if there is none. */
  termId: z.uuid().nullable(),
});
export type SectionListResponse = z.infer<typeof sectionListResponseSchema>;

export const sectionInputSchema = z.object({
  courseCode: courseCodeSchema,
  termId: z.uuid(),
  name: sectionNameSchema,
  capacity: capacitySchema,
});
export type SectionInput = z.infer<typeof sectionInputSchema>;

export const sectionUpdateSchema = z
  .object({ name: sectionNameSchema.optional(), capacity: capacitySchema.optional() })
  .refine((update) => Object.keys(update).length > 0, { message: 'Nothing to change.' });
export type SectionUpdate = z.infer<typeof sectionUpdateSchema>;

export const assignTeacherSchema = z.object({ email: emailSchema });

/** Accepts emails separated by commas, semicolons, spaces or new lines. */
export const enrollRequestSchema = z.object({
  emails: z
    .string()
    .transform((value) => [
      ...new Set(
        value
          .split(/[\s,;]+/)
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(z.email()).min(1, 'Enter at least one email.').max(MAX_BULK_ENROLL)),
});
export type EnrollRequest = z.infer<typeof enrollRequestSchema>;

export const ENROLL_SKIP_REASONS = [
  'not_found',
  'not_a_student',
  'not_active',
  'already_enrolled',
  'section_full',
] as const;
export type EnrollSkipReason = (typeof ENROLL_SKIP_REASONS)[number];

export const enrollResultSchema = z.object({
  added: z.array(z.string()),
  skipped: z.array(z.object({ email: z.string(), reason: z.enum(ENROLL_SKIP_REASONS) })),
});
export type EnrollResult = z.infer<typeof enrollResultSchema>;

export const dropRequestSchema = z.object({ reason: reasonSchema });

/** What a student sees for one enrolled class (S02). */
export const studentClassSchema = sectionSummarySchema
  .omit({ enrolled: true, capacity: true })
  .extend({
    enrolledAt: z.string(),
  });
export type StudentClass = z.infer<typeof studentClassSchema>;
