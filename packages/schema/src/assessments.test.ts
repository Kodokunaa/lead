import { describe, expect, it } from 'vitest';
import {
  assessmentSettingsSchema,
  questionInputSchema,
  rubricInputSchema,
  usesQuestions,
} from './assessments';

const choice = (text: string, correct = false) => ({ text, correct });

describe('assessment schemas', () => {
  it('splits kinds into question-based and rubric-based', () => {
    expect(
      ['quiz', 'exam', 'assignment', 'project'].map((kind) => usesQuestions(kind as never)),
    ).toEqual([true, true, false, false]);
  });

  it('accepts a multiple-choice question with one correct answer', () => {
    const parsed = questionInputSchema.parse({
      kind: 'multiple_choice',
      prompt: ' Which removes a partial dependency? ',
      points: '2',
      objectiveId: '',
      choices: [choice('Split the relation', true), choice('Keep it')],
    });
    expect(parsed).toMatchObject({
      prompt: 'Which removes a partial dependency?',
      points: 2,
      difficulty: 'moderate',
      objectiveId: null,
    });
  });

  it('refuses answer keys that are missing, doubled, or on written questions', () => {
    const base = { kind: 'multiple_choice', prompt: 'Q', points: 1 };
    const messages = (input: object) =>
      questionInputSchema
        .safeParse({ ...base, ...input })
        .error?.issues.map((issue) => issue.message);
    expect(messages({ choices: [choice('A'), choice('B')] })).toEqual([
      'Mark exactly one choice as the correct answer.',
    ]);
    expect(messages({ choices: [choice('A', true), choice('B', true)] })).toEqual([
      'Mark exactly one choice as the correct answer.',
    ]);
    expect(messages({ choices: [choice('A', true)] })).toEqual([
      'Give at least two answer choices.',
    ]);
    expect(messages({ kind: 'written', choices: [choice('A', true)] })).toEqual([
      'A written question has no answer choices.',
    ]);
  });

  it('reads blank settings as not set and needs an offset on times', () => {
    expect(
      assessmentSettingsSchema.parse({ opensAt: '', timeLimitMinutes: '', maxAttempts: '2' }),
    ).toEqual({ opensAt: null, timeLimitMinutes: null, maxAttempts: 2 });
    expect(assessmentSettingsSchema.safeParse({ dueAt: '2026-10-22T17:00' }).success).toBe(false);
    expect(assessmentSettingsSchema.safeParse({ dueAt: '2026-10-22T17:00:00+08:00' }).success).toBe(
      true,
    );
    expect(assessmentSettingsSchema.safeParse({}).success).toBe(false);
  });

  it('needs distinct points for the levels of a criterion', () => {
    const level = (points: number) => ({ label: `L${points}`, points });
    expect(
      rubricInputSchema.safeParse({ criteria: [{ name: 'C', levels: [level(4), level(4)] }] })
        .success,
    ).toBe(false);
    expect(
      rubricInputSchema.parse({ criteria: [{ name: 'C', levels: [level(4), level(0)] }] })
        .criteria[0]?.levels[1],
    ).toEqual({ label: 'L0', points: 0, descriptor: '' });
  });
});
