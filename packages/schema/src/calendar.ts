import { z } from 'zod';
import { isoDateSchema, termSchema } from './catalog';

/**
 * Academic calendar (wireframe A08): a term's dates, its grading periods and calendar events.
 * Dates are calendar days as YYYY-MM-DD, compared as text (which orders them correctly).
 */
export const CALENDAR_EVENT_KINDS = [
  'assessment_period',
  'grade_release',
  'holiday',
  'class_event',
] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

export const CALENDAR_EVENT_LABELS: Readonly<Record<CalendarEventKind, string>> = {
  assessment_period: 'Assessment period',
  grade_release: 'Grade release',
  holiday: 'Holiday / no classes',
  class_event: 'Class event',
};

export const MAX_GRADING_PERIODS = 6;
export const MAX_EVENT_COURSES = 50;

const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'Enter a name.')
    .max(max)
    .refine((value) => !value.includes('\u0000'), 'Remove the invalid character.');

export const termDatesSchema = z
  .object({ startsOn: isoDateSchema, endsOn: isoDateSchema })
  .refine((dates) => dates.startsOn < dates.endsOn, {
    message: 'The term must end after it starts.',
    path: ['endsOn'],
  });
export type TermDates = z.infer<typeof termDatesSchema>;

export const gradingPeriodInputSchema = z
  .object({ name: plainText(40), startsOn: isoDateSchema, endsOn: isoDateSchema })
  .refine((period) => period.startsOn <= period.endsOn, {
    message: 'A grading period cannot end before it starts.',
    path: ['endsOn'],
  });
export type GradingPeriodInput = z.infer<typeof gradingPeriodInputSchema>;

/**
 * The whole list of a term's grading periods (e.g. Prelim, Midterm, Finals), replaced at once.
 * Sorted by start date; they may not overlap or share a name.
 */
export const gradingPeriodsRequestSchema = z
  .object({ periods: z.array(gradingPeriodInputSchema).max(MAX_GRADING_PERIODS) })
  .transform(({ periods }) => ({
    periods: [...periods].sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1)),
  }))
  .superRefine(({ periods }, context) => {
    const names = new Set<string>();
    periods.forEach((period, index) => {
      const key = period.name.toLowerCase();
      if (names.has(key)) {
        context.addIssue({ code: 'custom', message: `"${period.name}" is listed twice.` });
      }
      names.add(key);
      const previous = periods[index - 1];
      if (previous && period.startsOn <= previous.endsOn) {
        context.addIssue({
          code: 'custom',
          message: `${previous.name} and ${period.name} overlap.`,
        });
      }
    });
  });
export type GradingPeriodsRequest = z.infer<typeof gradingPeriodsRequestSchema>;

export const calendarEventInputSchema = z
  .object({
    title: plainText(120),
    kind: z.enum(CALENDAR_EVENT_KINDS),
    startsOn: isoDateSchema,
    /** Null for a single day. */
    endsOn: z.preprocess(
      (value) => (value === '' || value === undefined ? null : value),
      isoDateSchema.nullable(),
    ),
    /** Empty means every course this term. */
    courseIds: z
      .array(z.uuid())
      .max(MAX_EVENT_COURSES)
      .default([])
      .transform((ids) => [...new Set(ids)]),
  })
  .refine((event) => event.endsOn === null || event.startsOn <= event.endsOn, {
    message: 'The event cannot end before it starts.',
    path: ['endsOn'],
  });
export type CalendarEventInput = z.infer<typeof calendarEventInputSchema>;

// ---------- Responses

export const gradingPeriodSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  position: z.number().int(),
  startsOn: z.string(),
  endsOn: z.string(),
});
export type GradingPeriod = z.infer<typeof gradingPeriodSchema>;

const courseRef = z.object({ id: z.uuid(), code: z.string() });

export const calendarEventSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  kind: z.enum(CALENDAR_EVENT_KINDS),
  startsOn: z.string(),
  endsOn: z.string().nullable(),
  /** Empty means every course this term. */
  courses: z.array(courseRef),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

/** A course offered this term (it has at least one section), for scoping events. */
export const offeringSchema = courseRef.extend({ title: z.string(), sections: z.number().int() });
export type Offering = z.infer<typeof offeringSchema>;

export const termCalendarSchema = z.object({
  term: termSchema,
  gradingPeriods: z.array(gradingPeriodSchema),
  events: z.array(calendarEventSchema),
  offerings: z.array(offeringSchema),
});
export type TermCalendar = z.infer<typeof termCalendarSchema>;

/** One class's view (T03): its term's grading periods and the events that apply to its course. */
export const classCalendarSchema = z.object({
  term: termSchema,
  gradingPeriods: z.array(gradingPeriodSchema),
  events: z.array(calendarEventSchema),
});
export type ClassCalendar = z.infer<typeof classCalendarSchema>;
