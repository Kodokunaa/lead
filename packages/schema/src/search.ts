import { z } from 'zod';

/**
 * Permission-scoped search (wireframe H09). Each role searches only what it may open:
 * students their classes and the published lessons and approved resources in them; teachers
 * their classes and courses this term; administrators records across the college.
 */
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_LIMIT_PER_TYPE = 10;

export const searchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(SEARCH_MIN_LENGTH, `Type at least ${SEARCH_MIN_LENGTH} characters.`)
    .max(100)
    .refine((value) => !value.includes('\u0000'), 'Remove the invalid character.'),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const SEARCH_RESULT_TYPES = [
  'class',
  'course',
  'module',
  'lesson',
  'resource',
  'section',
  'user',
] as const;
export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

export const SEARCH_TYPE_LABELS: Readonly<Record<SearchResultType, string>> = {
  class: 'Class',
  course: 'Course',
  module: 'Module',
  lesson: 'Lesson',
  resource: 'Resource',
  section: 'Section',
  user: 'Account',
};

/** Where a result opens, by wireframe screen; the web app turns it into a link. */
export const searchTargetSchema = z.discriminatedUnion('screen', [
  z.object({ screen: z.literal('S03'), sectionId: z.uuid() }),
  z.object({ screen: z.literal('S05'), sectionId: z.uuid(), lessonId: z.uuid() }),
  z.object({ screen: z.literal('S06'), sectionId: z.uuid(), resourceId: z.uuid() }),
  z.object({ screen: z.literal('T03'), sectionId: z.uuid() }),
  z.object({ screen: z.literal('T05'), courseId: z.uuid(), moduleId: z.uuid() }),
  z.object({ screen: z.literal('T06'), courseId: z.uuid(), lessonId: z.uuid() }),
  z.object({ screen: z.literal('T07'), courseId: z.uuid() }),
  z.object({ screen: z.literal('A03'), userId: z.uuid() }),
  z.object({ screen: z.literal('A05') }),
  z.object({ screen: z.literal('A07'), sectionId: z.uuid() }),
  z.object({ screen: z.literal('A11'), resourceId: z.uuid() }),
]);
export type SearchTarget = z.infer<typeof searchTargetSchema>;

export const searchResultSchema = z.object({
  type: z.enum(SEARCH_RESULT_TYPES),
  id: z.uuid(),
  title: z.string(),
  /** Where it sits, e.g. "IS 301 · Module 2: Normalization". */
  context: z.string(),
  /** Why the searcher may see it, e.g. "Enrolled", "Approved", "Draft". */
  access: z.string(),
  target: searchTargetSchema,
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  query: z.string(),
  results: z.array(searchResultSchema),
  /** True when some type had more matches than SEARCH_LIMIT_PER_TYPE. */
  truncated: z.boolean(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
