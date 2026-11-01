import { describe, expect, it } from 'vitest';
import {
  courseCodeSchema,
  courseInputSchema,
  courseUpdateSchema,
  programInputSchema,
  termInputSchema,
} from './catalog';

describe('courseCodeSchema', () => {
  it('stores codes uppercase with single spaces', () => {
    expect(courseCodeSchema.parse('  is   301 ')).toBe('IS 301');
    expect(courseCodeSchema.parse('Math-101')).toBe('MATH-101');
  });

  it('refuses symbols and codes that do not start with a letter', () => {
    expect(courseCodeSchema.safeParse('301 IS').success).toBe(false);
    expect(courseCodeSchema.safeParse('IS/301').success).toBe(false);
  });
});

describe('courseInputSchema', () => {
  it('accepts a general education course without a program', () => {
    const parsed = courseInputSchema.parse({
      code: 'ge 1',
      title: 'Understanding the Self',
      units: '3',
      programId: null,
    });
    expect(parsed).toMatchObject({ code: 'GE 1', units: 3, description: '' });
  });

  it('keeps units within a normal course load', () => {
    const base = { code: 'IS 301', title: 'Databases', programId: null };
    expect(courseInputSchema.safeParse({ ...base, units: 0 }).success).toBe(false);
    expect(courseInputSchema.safeParse({ ...base, units: 7 }).success).toBe(false);
  });
});

describe('courseUpdateSchema', () => {
  it('keeps only the fields sent, without create-time defaults', () => {
    expect(courseUpdateSchema.parse({ title: 'New title' })).toEqual({ title: 'New title' });
    expect(courseUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('programInputSchema', () => {
  it('accepts codes as CCC writes them', () => {
    expect(
      programInputSchema.safeParse({ code: 'BSED Math', name: 'Secondary Education' }).success,
    ).toBe(true);
    expect(programInputSchema.safeParse({ code: 'BS/IS', name: 'Bad code' }).success).toBe(false);
  });
});

describe('termInputSchema', () => {
  const valid = {
    schoolYear: '2026-2027',
    semester: 'first',
    startsOn: '2026-08-10',
    endsOn: '2026-12-18',
  };

  it('accepts a normal semester', () => {
    expect(termInputSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a school year that does not span consecutive years', () => {
    expect(termInputSchema.safeParse({ ...valid, schoolYear: '2026-2028' }).success).toBe(false);
    expect(termInputSchema.safeParse({ ...valid, schoolYear: '26-27' }).success).toBe(false);
  });

  it('refuses a term that ends before it starts', () => {
    const result = termInputSchema.safeParse({ ...valid, endsOn: '2026-08-01' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['endsOn']);
  });
});
