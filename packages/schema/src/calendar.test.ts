import { describe, expect, it } from 'vitest';
import {
  calendarEventInputSchema,
  gradingPeriodsRequestSchema,
  MAX_GRADING_PERIODS,
  termDatesSchema,
} from './calendar';

const COURSE = '11111111-1111-4111-8111-111111111111';

describe('termDatesSchema', () => {
  it('needs the term to end after it starts', () => {
    expect(
      termDatesSchema.safeParse({ startsOn: '2026-08-10', endsOn: '2026-12-18' }).success,
    ).toBe(true);
    expect(
      termDatesSchema.safeParse({ startsOn: '2026-12-18', endsOn: '2026-08-10' }).success,
    ).toBe(false);
  });
});

describe('gradingPeriodsRequestSchema', () => {
  it('sorts the periods by start date', () => {
    const parsed = gradingPeriodsRequestSchema.parse({
      periods: [
        { name: 'Finals', startsOn: '2026-11-16', endsOn: '2026-12-18' },
        { name: 'Prelim', startsOn: '2026-08-10', endsOn: '2026-09-25' },
        { name: 'Midterm', startsOn: '2026-09-28', endsOn: '2026-11-13' },
      ],
    });
    expect(parsed.periods.map((period) => period.name)).toEqual(['Prelim', 'Midterm', 'Finals']);
  });

  it('refuses overlapping periods, repeated names and too many periods', () => {
    expect(
      gradingPeriodsRequestSchema.safeParse({
        periods: [
          { name: 'Prelim', startsOn: '2026-08-10', endsOn: '2026-09-30' },
          { name: 'Midterm', startsOn: '2026-09-30', endsOn: '2026-11-13' },
        ],
      }).success,
    ).toBe(false);
    expect(
      gradingPeriodsRequestSchema.safeParse({
        periods: [
          { name: 'Prelim', startsOn: '2026-08-10', endsOn: '2026-08-20' },
          { name: 'prelim', startsOn: '2026-09-01', endsOn: '2026-09-20' },
        ],
      }).success,
    ).toBe(false);
    const many = Array.from({ length: MAX_GRADING_PERIODS + 1 }, (_, index) => ({
      name: `P${index}`,
      startsOn: `2026-0${index + 1}-01`,
      endsOn: `2026-0${index + 1}-02`,
    }));
    expect(gradingPeriodsRequestSchema.safeParse({ periods: many }).success).toBe(false);
  });
});

describe('calendarEventInputSchema', () => {
  it('reads a blank end date as a single day and every course by default', () => {
    expect(
      calendarEventInputSchema.parse({
        title: ' Grade release ',
        kind: 'grade_release',
        startsOn: '2026-12-22',
        endsOn: '',
      }),
    ).toEqual({
      title: 'Grade release',
      kind: 'grade_release',
      startsOn: '2026-12-22',
      endsOn: null,
      courseIds: [],
    });
  });

  it('refuses an event that ends before it starts, and drops repeated courses', () => {
    expect(
      calendarEventInputSchema.safeParse({
        title: 'Midterm exams',
        kind: 'assessment_period',
        startsOn: '2026-10-10',
        endsOn: '2026-10-01',
      }).success,
    ).toBe(false);
    expect(
      calendarEventInputSchema.parse({
        title: 'Quiz week',
        kind: 'class_event',
        startsOn: '2026-10-10',
        endsOn: null,
        courseIds: [COURSE, COURSE],
      }).courseIds,
    ).toEqual([COURSE]);
  });
});
