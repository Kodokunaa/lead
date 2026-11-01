import { describe, expect, it } from 'vitest';
import {
  approveRequestSchema,
  resourceInputSchema,
  resourceUrlSchema,
  returnRequestSchema,
} from './resources';

const OBJECTIVE = '11111111-1111-4111-8111-111111111111';

describe('resourceUrlSchema', () => {
  it('accepts web links only', () => {
    expect(resourceUrlSchema.safeParse('https://ccc.edu.ph/guide.pdf').success).toBe(true);
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///C:/x',
      'ftp://a.ph/x',
      'https://ccc.edu.ph@evil.example/login',
    ]) {
      expect(resourceUrlSchema.safeParse(url).success).toBe(false);
    }
  });
});

describe('resourceInputSchema', () => {
  it('reads multipart fields: one objective or many, and blanks as absent', () => {
    expect(
      resourceInputSchema.parse({
        title: ' Normalization guide ',
        moduleId: '',
        objectiveIds: OBJECTIVE,
        url: '',
      }),
    ).toEqual({ title: 'Normalization guide', objectiveIds: [OBJECTIVE] });
    expect(
      resourceInputSchema.parse({ title: 'A', objectiveIds: [OBJECTIVE, OBJECTIVE] }).objectiveIds,
    ).toEqual([OBJECTIVE]);
  });
});

describe('review requests', () => {
  it('approves only with both checks confirmed', () => {
    expect(approveRequestSchema.safeParse({ confirmSource: true }).success).toBe(false);
    expect(approveRequestSchema.parse({ confirmSource: true, confirmPermissions: true })).toEqual({
      confirmSource: true,
      confirmPermissions: true,
      note: '',
    });
  });

  it('returns only with a note for the teacher', () => {
    expect(returnRequestSchema.safeParse({ note: '' }).success).toBe(false);
    expect(returnRequestSchema.safeParse({ note: 'Cite the source.' }).success).toBe(true);
  });
});
