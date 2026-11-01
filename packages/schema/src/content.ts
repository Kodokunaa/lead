import { z } from 'zod';

/**
 * Course content (wireframes T04–T06): learning objectives, modules and lessons. Content belongs
 * to the course, so every section of IS 301 follows the same outline.
 */
export const CONTENT_STATUSES = ['draft', 'published'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const MAX_LESSON_BODY = 20_000;
export const MAX_MODULE_OBJECTIVES = 20;

/**
 * Text teachers type. Postgres cannot store NUL characters, so they are refused here (a clear
 * 400) rather than failing in the database. Stored as plain text: render it as text, never as HTML.
 */
const plainText = () =>
  z.string().refine((value) => !value.includes('\u0000'), 'Remove the invalid character.');

const titleSchema = plainText().trim().min(1, 'Enter a title.').max(120);
const descriptionSchema = plainText().trim().max(1000);

export const objectiveDescriptionSchema = plainText()
  .trim()
  .min(5, 'Describe what students will be able to do.')
  .max(300);

/** Blank means "no mastery condition"; otherwise the score (50–100%) that counts as mastered. */
export const masteryThresholdSchema = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.coerce.number().int().min(50).max(100).nullable(),
);

export const objectiveInputSchema = z.object({ description: objectiveDescriptionSchema });
export type ObjectiveInput = z.infer<typeof objectiveInputSchema>;

const moduleFields = {
  title: titleSchema,
  description: descriptionSchema,
  objectiveIds: z
    .array(z.uuid())
    .max(MAX_MODULE_OBJECTIVES)
    .transform((ids) => [...new Set(ids)]),
  /** The previous module must be finished first. */
  requiresPrevious: z.boolean(),
  masteryThreshold: masteryThresholdSchema,
};

export const moduleInputSchema = z.object({
  ...moduleFields,
  description: moduleFields.description.default(''),
  objectiveIds: moduleFields.objectiveIds.default([]),
  requiresPrevious: moduleFields.requiresPrevious.default(false),
  masteryThreshold: moduleFields.masteryThreshold.default(null),
});
export type ModuleInput = z.infer<typeof moduleInputSchema>;

// Built from the plain fields, so a partial update never fills in defaults for fields not sent.
export const moduleUpdateSchema = z
  .object(moduleFields)
  .partial()
  .refine((update) => Object.keys(update).length > 0, { message: 'Nothing to change.' });
export type ModuleUpdate = z.infer<typeof moduleUpdateSchema>;

export const moveRequestSchema = z.object({ direction: z.enum(['up', 'down']) });
export type MoveRequest = z.infer<typeof moveRequestSchema>;

const lessonFields = {
  title: titleSchema,
  /** Null only while a draft; publishing needs an objective of the lesson's module. */
  objectiveId: z.uuid().nullable(),
  body: plainText().max(MAX_LESSON_BODY),
};

export const lessonInputSchema = z.object({
  ...lessonFields,
  objectiveId: lessonFields.objectiveId.default(null),
  body: lessonFields.body.default(''),
});
export type LessonInput = z.infer<typeof lessonInputSchema>;

export const lessonUpdateSchema = z
  .object(lessonFields)
  .partial()
  .refine((update) => Object.keys(update).length > 0, { message: 'Nothing to change.' });
export type LessonUpdate = z.infer<typeof lessonUpdateSchema>;

// ---------- Responses

export const objectiveSchema = z.object({
  id: z.uuid(),
  /** "O1", "O2", … numbered per course. */
  code: z.string(),
  description: z.string(),
});
export type Objective = z.infer<typeof objectiveSchema>;

export const lessonSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  position: z.number().int(),
  objectiveId: z.uuid().nullable(),
  status: z.enum(CONTENT_STATUSES),
});
export type LessonSummary = z.infer<typeof lessonSummarySchema>;

export const lessonSchema = lessonSummarySchema.extend({
  moduleId: z.uuid(),
  body: z.string(),
  updatedAt: z.string(),
});
export type Lesson = z.infer<typeof lessonSchema>;

export const contentModuleSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  title: z.string(),
  description: z.string(),
  objectiveIds: z.array(z.uuid()),
  requiresPrevious: z.boolean(),
  masteryThreshold: z.number().int().nullable(),
  status: z.enum(CONTENT_STATUSES),
  lessons: z.array(lessonSummarySchema),
});
export type ContentModule = z.infer<typeof contentModuleSchema>;

export const contentCourseSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  title: z.string(),
});

export const courseContentSchema = z.object({
  course: contentCourseSchema,
  objectives: z.array(objectiveSchema),
  modules: z.array(contentModuleSchema),
});
export type CourseContent = z.infer<typeof courseContentSchema>;

/** A course the teacher may edit: they teach one of its sections this term. */
export const teacherCourseSchema = contentCourseSchema.extend({
  sections: z.array(z.string()),
});
export type TeacherCourse = z.infer<typeof teacherCourseSchema>;
