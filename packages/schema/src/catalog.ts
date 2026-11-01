import { z } from 'zod';
import { reasonSchema } from './admin';

/** Program codes as CCC writes them, e.g. "BSIS" or "BSED Math". */
export const programCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(/^[A-Za-z][A-Za-z0-9 ]*$/, 'Use letters, digits and spaces, e.g. "BSED Math".');

export const programSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
});
export type Program = z.infer<typeof programSchema>;

export const programInputSchema = z.object({
  code: programCodeSchema,
  name: z.string().trim().min(3).max(150),
});
export type ProgramInput = z.infer<typeof programInputSchema>;

export const programUpdateSchema = z
  .object({
    name: z.string().trim().min(3).max(150).optional(),
    active: z.boolean().optional(),
  })
  .refine((update) => Object.keys(update).length > 0, { message: 'Nothing to change.' });
export type ProgramUpdate = z.infer<typeof programUpdateSchema>;

export const SEMESTERS = ['first', 'second', 'summer'] as const;
export type Semester = (typeof SEMESTERS)[number];
export const SEMESTER_LABELS: Readonly<Record<Semester, string>> = {
  first: 'First Semester',
  second: 'Second Semester',
  summer: 'Summer',
};

/** Calendar date as YYYY-MM-DD (no time zone). */
/** Calendar date as YYYY-MM-DD; years before 1900 (e.g. 0000) are typos Postgres would refuse. */
export const isoDateSchema = z.iso
  .date()
  .refine((day) => day >= '1900-01-01', 'Enter a date from 1900 onward.');

export const termSchema = z.object({
  id: z.uuid(),
  schoolYear: z.string(),
  semester: z.enum(SEMESTERS),
  startsOn: z.string(),
  endsOn: z.string(),
  current: z.boolean(),
});
export type Term = z.infer<typeof termSchema>;

/** "2026-2027": a school year spans two consecutive calendar years. */
export const schoolYearSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{4}$/, 'Write the school year as 2026-2027.')
  .refine((value) => Number(value.slice(5)) === Number(value.slice(0, 4)) + 1, {
    message: 'The second year must follow the first, e.g. 2026-2027.',
  });

export const termInputSchema = z
  .object({
    schoolYear: schoolYearSchema,
    semester: z.enum(SEMESTERS),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
  })
  .refine((term) => term.startsOn < term.endsOn, {
    message: 'The term must end after it starts.',
    path: ['endsOn'],
  });
export type TermInput = z.infer<typeof termInputSchema>;

/** Course codes are stored uppercase with single spaces: "is 301" -> "IS 301". */
export const courseCodeSchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' ').toUpperCase())
  .pipe(
    z
      .string()
      .min(2)
      .max(20)
      .regex(/^[A-Z][A-Z0-9 -]*$/, 'Use letters, digits, spaces or dashes, e.g. "IS 301".'),
  );

export const courseSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  title: z.string(),
  description: z.string(),
  units: z.number().int(),
  programId: z.uuid().nullable(),
  programCode: z.string().nullable(),
  archived: z.boolean(),
});
export type Course = z.infer<typeof courseSchema>;

const courseFields = z.object({
  code: courseCodeSchema,
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().max(2000),
  units: z.coerce.number().int().min(1).max(6),
  /** Null for general education courses shared by every program. */
  programId: z.uuid().nullable(),
});

export const courseInputSchema = courseFields.extend({
  description: courseFields.shape.description.default(''),
});
export type CourseInput = z.infer<typeof courseInputSchema>;

/** Only the fields sent are changed; no defaults, so an omitted description is kept. */
export const courseUpdateSchema = courseFields
  .partial()
  .refine((update) => Object.keys(update).length > 0, { message: 'Nothing to change.' });
export type CourseUpdate = z.infer<typeof courseUpdateSchema>;

export const COURSE_PAGE_SIZE = 25;

export const courseListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  /** A program id, or "general" for courses without a program. */
  program: z.union([z.uuid(), z.literal('general')]).optional(),
  archived: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type CourseListQuery = z.infer<typeof courseListQuerySchema>;

export const courseListResponseSchema = z.object({
  items: z.array(courseSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type CourseListResponse = z.infer<typeof courseListResponseSchema>;

/** Archiving takes a course out of new sections; existing records stay. */
export const courseArchiveSchema = z.object({ reason: reasonSchema });
