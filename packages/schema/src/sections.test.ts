import { describe, expect, it } from 'vitest';
import {
  MAX_BULK_ENROLL,
  sectionInputSchema,
  sectionNameSchema,
  sectionUpdateSchema,
  enrollRequestSchema,
} from './sections';

describe('enrollRequestSchema', () => {
  it('splits on commas, semicolons, spaces and new lines, lowercases and removes repeats', () => {
    const parsed = enrollRequestSchema.parse({
      emails: 'Learner01@lead.test, learner02@lead.test;\nlearner01@LEAD.test  learner03@lead.test',
    });
    expect(parsed.emails).toEqual([
      'learner01@lead.test',
      'learner02@lead.test',
      'learner03@lead.test',
    ]);
  });

  it('refuses an empty list, a malformed email, or too many at once', () => {
    expect(enrollRequestSchema.safeParse({ emails: '  ,; ' }).success).toBe(false);
    expect(enrollRequestSchema.safeParse({ emails: 'learner01@lead.test, nope' }).success).toBe(
      false,
    );
    const many = Array.from({ length: MAX_BULK_ENROLL + 1 }, (_, i) => `s${i}@lead.test`).join(',');
    expect(enrollRequestSchema.safeParse({ emails: many }).success).toBe(false);
  });
});

describe('section names and input', () => {
  it('tidies spacing and accepts CCC-style names', () => {
    expect(sectionNameSchema.parse('  BSIS   3-A ')).toBe('BSIS 3-A');
    expect(sectionNameSchema.safeParse('BSIS/3A').success).toBe(false);
  });

  it('normalizes the course code and keeps capacity within limits', () => {
    const base = {
      courseCode: 'is 301',
      termId: '7f9c2d1e-3b4a-4c5d-8e6f-0a1b2c3d4e5f',
      name: 'BSIS 3-A',
    };
    expect(sectionInputSchema.parse({ ...base, capacity: '40' })).toMatchObject({
      courseCode: 'IS 301',
      capacity: 40,
    });
    expect(sectionInputSchema.safeParse({ ...base, capacity: 0 }).success).toBe(false);
    expect(sectionInputSchema.safeParse({ ...base, capacity: 201 }).success).toBe(false);
  });

  it('refuses an empty update', () => {
    expect(sectionUpdateSchema.safeParse({}).success).toBe(false);
  });
});
