import { describe, expect, it } from 'vitest';
import {
  lessonInputSchema,
  lessonUpdateSchema,
  MAX_LESSON_BODY,
  moduleInputSchema,
  moduleUpdateSchema,
  objectiveInputSchema,
} from './content';

const OBJECTIVE = '11111111-1111-4111-8111-111111111111';

describe('moduleInputSchema', () => {
  it('fills in defaults for a new module', () => {
    expect(moduleInputSchema.parse({ title: '  Foundations ' })).toEqual({
      title: 'Foundations',
      description: '',
      objectiveIds: [],
      requiresPrevious: false,
      masteryThreshold: null,
    });
  });

  it('reads a blank mastery threshold as none and refuses one outside 50–100', () => {
    expect(moduleInputSchema.parse({ title: 'A', masteryThreshold: '' }).masteryThreshold).toBe(
      null,
    );
    expect(moduleInputSchema.parse({ title: 'A', masteryThreshold: '70' }).masteryThreshold).toBe(
      70,
    );
    expect(moduleInputSchema.safeParse({ title: 'A', masteryThreshold: 40 }).success).toBe(false);
    expect(moduleInputSchema.safeParse({ title: 'A', masteryThreshold: 101 }).success).toBe(false);
  });

  it('refuses a blank title', () => {
    expect(moduleInputSchema.safeParse({ title: '   ' }).success).toBe(false);
  });
});

describe('moduleUpdateSchema', () => {
  it('keeps only the fields sent, and refuses an empty update', () => {
    expect(moduleUpdateSchema.parse({ title: 'Normalization' })).toEqual({
      title: 'Normalization',
    });
    expect(moduleUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('lessons', () => {
  it('allows a draft without an objective, and caps the body length', () => {
    expect(lessonInputSchema.parse({ title: 'Normal forms' })).toEqual({
      title: 'Normal forms',
      objectiveId: null,
      body: '',
    });
    expect(
      lessonInputSchema.safeParse({ title: 'A', body: 'x'.repeat(MAX_LESSON_BODY + 1) }).success,
    ).toBe(false);
  });

  it('updates only the fields sent', () => {
    expect(lessonUpdateSchema.parse({ objectiveId: OBJECTIVE })).toEqual({
      objectiveId: OBJECTIVE,
    });
    expect(lessonUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('plain text', () => {
  it('refuses NUL characters, which the database cannot store', () => {
    expect(moduleInputSchema.safeParse({ title: 'Foundations\u0000' }).success).toBe(false);
    expect(lessonInputSchema.safeParse({ title: 'A', body: 'x\u0000y' }).success).toBe(false);
  });

  it('drops repeated objective ids', () => {
    expect(
      moduleInputSchema.parse({ title: 'A', objectiveIds: [OBJECTIVE, OBJECTIVE] }).objectiveIds,
    ).toEqual([OBJECTIVE]);
  });
});

describe('objectiveInputSchema', () => {
  it('needs a real description', () => {
    expect(objectiveInputSchema.safeParse({ description: 'ok' }).success).toBe(false);
    expect(
      objectiveInputSchema.parse({ description: ' Normalize a relation to 3NF ' }).description,
    ).toBe('Normalize a relation to 3NF');
  });
});
