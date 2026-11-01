import { z } from 'zod';
import { classCalendarSchema } from './calendar';
import { objectiveSchema } from './content';
import { studentClassSchema } from './sections';

/**
 * What an enrolled student sees of a class (wireframes S03, S05, S06): published modules and
 * lessons only, and only the approved version of each resource.
 */
const objectiveRef = z.object({ id: z.uuid(), code: z.string() });

export const studentResourceSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  module: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  objectives: z.array(objectiveRef),
  /** The approved version: a file to download or a web link. */
  version: z.object({
    id: z.uuid(),
    number: z.number().int(),
    kind: z.enum(['file', 'link']),
    fileName: z.string().nullable(),
    contentType: z.string().nullable(),
    sizeBytes: z.number().int().nullable(),
    url: z.string().nullable(),
  }),
});
export type StudentResource = z.infer<typeof studentResourceSchema>;

const lessonRef = z.object({
  id: z.uuid(),
  title: z.string(),
  position: z.number().int(),
  objectiveId: z.uuid().nullable(),
});

export const studentModuleSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  title: z.string(),
  description: z.string(),
  objectiveIds: z.array(z.uuid()),
  requiresPrevious: z.boolean(),
  masteryThreshold: z.number().int().nullable(),
  lessons: z.array(lessonRef),
});
export type StudentModule = z.infer<typeof studentModuleSchema>;

/** S03 Course overview and syllabus. */
export const studentClassOverviewSchema = z.object({
  section: studentClassSchema,
  objectives: z.array(objectiveSchema),
  modules: z.array(studentModuleSchema),
  resources: z.array(studentResourceSchema),
  calendar: classCalendarSchema,
});
export type StudentClassOverview = z.infer<typeof studentClassOverviewSchema>;

/** S05 Lesson and objective view. The body is plain text: show it as text, never as HTML. */
export const studentLessonSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  objective: objectiveSchema.nullable(),
  course: z.object({ code: z.string(), title: z.string() }),
  module: z.object({
    id: z.uuid(),
    position: z.number().int(),
    title: z.string(),
    lessons: z.array(lessonRef),
  }),
  /** Approved resources of the lesson's module. */
  resources: z.array(studentResourceSchema),
});
export type StudentLesson = z.infer<typeof studentLessonSchema>;

/** S06 Approved learning resource viewer. */
export const studentResourceViewSchema = studentResourceSchema.extend({
  course: z.object({ code: z.string(), title: z.string() }),
});
export type StudentResourceView = z.infer<typeof studentResourceViewSchema>;
