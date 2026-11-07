import type { QuestionKind } from '@lead/schema';

export interface ScoredQuestion {
  readonly id: string;
  readonly kind: QuestionKind;
  readonly points: number;
  readonly objectiveId: string | null;
  /** The correct choice of a multiple-choice question. */
  readonly correctChoiceId: string | null;
}

export interface GivenAnswer {
  readonly questionId: string;
  readonly choiceId: string | null;
  readonly text: string;
}

export interface Scoring {
  /** Points per answered multiple-choice question (0 when wrong). */
  readonly awarded: ReadonlyMap<string, number>;
  readonly score: number;
  /** Points of all multiple-choice questions, answered or not. */
  readonly scoredPoints: number;
}

/** Multiple choice is scored at once; written answers wait for the teacher. */
export function scoreAttempt(
  questions: readonly ScoredQuestion[],
  answers: readonly GivenAnswer[],
): Scoring {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const awarded = new Map<string, number>();
  let score = 0;
  let scoredPoints = 0;
  for (const question of questions) {
    if (question.kind !== 'multiple_choice') continue;
    scoredPoints += question.points;
    const answer = byQuestion.get(question.id);
    if (!answer) continue;
    const points =
      answer.choiceId !== null && answer.choiceId === question.correctChoiceId
        ? question.points
        : 0;
    awarded.set(question.id, points);
    score += points;
  }
  return { awarded, score, scoredPoints };
}

/** Whether a saved answer says anything (a chosen option, or written text). */
export function isAnswered(answer: GivenAnswer | undefined): boolean {
  return answer !== undefined && (answer.choiceId !== null || answer.text.trim() !== '');
}
