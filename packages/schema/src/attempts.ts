import { z } from 'zod';
import type { AssessmentKind, QuestionKind } from './assessments';

/**
 * Quiz and examination attempts (wireframes S07–S11). The server keeps the clock: an attempt's
 * deadline is the time limit or the due date, whichever comes first, and an attempt left open
 * past it is submitted with the answers saved by then. The answer key never reaches students.
 */
export const ATTEMPT_STATUSES = ['in_progress', 'submitted'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** Answers that arrive this many seconds after the deadline still count (network delay). */
export const SAVE_GRACE_SECONDS = 15;
export const MAX_WRITTEN_ANSWER = 10_000;

export const answerInputSchema = z.object({
  /** Multiple choice: the chosen answer, or null to clear it. */
  choiceId: z.uuid().nullable().default(null),
  /** Written response. */
  text: z
    .string()
    .max(MAX_WRITTEN_ANSWER, 'Keep the answer under 10,000 characters.')
    .refine((value) => !value.includes('\u0000'), 'Remove the invalid character.')
    .default(''),
});
export type AnswerInput = z.infer<typeof answerInputSchema>;

/**
 * Where an assessment stands for one student (S07). `available` may follow earlier attempts
 * when more are allowed; `submitted` means no attempt is left; `missed` means it closed with none.
 */
export type StudentAssessmentState =
  'scheduled' | 'available' | 'in_progress' | 'submitted' | 'missed';

export interface StudentAssessmentSummary {
  readonly id: string;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly kind: AssessmentKind;
  readonly title: string;
  readonly objectiveCodes: readonly string[];
  readonly opensAt: string;
  readonly dueAt: string;
  readonly state: StudentAssessmentState;
  readonly attemptsUsed: number;
  readonly maxAttempts: number;
}

export interface AttemptSummary {
  readonly id: string;
  readonly number: number;
  readonly status: AttemptStatus;
  readonly startedAt: string;
  readonly submittedAt: string | null;
}

/** S08: what the student reads before beginning. */
export interface StudentAssessmentDetails extends StudentAssessmentSummary {
  readonly instructions: string;
  readonly timeLimitMinutes: number | null;
  readonly questionCount: number;
  readonly points: number;
  readonly objectives: readonly { code: string; description: string }[];
  readonly attempts: readonly AttemptSummary[];
  /** Why a new attempt cannot begin now, or null when it can (or one is in progress). */
  readonly blockedReason: string | null;
}

export interface AttemptQuestion {
  readonly id: string;
  readonly position: number;
  readonly kind: QuestionKind;
  readonly prompt: string;
  readonly points: number;
  /** Answer choices without the answer key. */
  readonly choices: readonly { id: string; text: string }[];
}

export interface SavedAnswer {
  readonly questionId: string;
  readonly choiceId: string | null;
  readonly text: string;
  readonly savedAt: string;
}

/** S09/S10: an attempt in progress. */
export interface AttemptView {
  readonly id: string;
  readonly number: number;
  readonly status: AttemptStatus;
  readonly assessmentId: string;
  readonly sectionId: string;
  readonly title: string;
  readonly kind: AssessmentKind;
  readonly courseCode: string;
  readonly sectionName: string;
  readonly maxAttempts: number;
  readonly deadlineAt: string;
  /** The server's clock when answering, so the countdown does not trust the device's clock. */
  readonly serverNow: string;
  readonly questions: readonly AttemptQuestion[];
  readonly answers: readonly SavedAnswer[];
}

export interface AnswerSaved {
  readonly questionId: string;
  readonly savedAt: string;
}

/** S11: a submitted attempt. Written answers stay pending until a teacher grades them. */
export interface AttemptResult {
  readonly id: string;
  readonly number: number;
  readonly assessmentId: string;
  readonly sectionId: string;
  readonly title: string;
  readonly courseCode: string;
  readonly sectionName: string;
  readonly submittedAt: string;
  /** Submitted by the server when time ran out. */
  readonly autoSubmitted: boolean;
  readonly answered: number;
  readonly questionCount: number;
  /** Points from multiple-choice questions, scored at once. */
  readonly score: number;
  readonly scoredPoints: number;
  /** Points of written questions waiting for the teacher. */
  readonly pendingPoints: number;
  readonly objectives: readonly {
    code: string;
    description: string;
    correct: number;
    scored: number;
    pending: number;
  }[];
  readonly attemptsUsed: number;
  readonly maxAttempts: number;
  readonly canRetake: boolean;
  /** The teacher's released grade of this attempt, written answers included. */
  readonly grade: {
    readonly score: number;
    readonly maxPoints: number;
    readonly feedback: string;
    readonly releasedAt: string;
    readonly written: readonly { position: number; points: number; maxPoints: number }[];
  } | null;
}
