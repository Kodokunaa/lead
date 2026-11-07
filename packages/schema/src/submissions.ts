import { z } from 'zod';
import type { AssessmentKind, RubricCriterion } from './assessments';

/**
 * Assignment and project submissions (S12) and their grading (T13, T14, X05). A student uploads
 * a file as a draft, then confirms it; each confirmed submission counts against the allowed
 * number. Teachers score the latest one with the rubric, write feedback and release it; a
 * released grade changes only with a reason.
 */
export const SUBMISSION_STATUSES = ['draft', 'submitted'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const GRADE_STATUSES = ['draft', 'released'] as const;
export type GradeStatus = (typeof GRADE_STATUSES)[number];

export const MAX_SUBMISSION_NOTE = 1000;
export const MAX_FEEDBACK = 5000;

const plainText = () =>
  z.string().refine((value) => !value.includes('\u0000'), 'Remove the invalid character.');

/** Multipart fields sent with the file. */
export const submissionDraftSchema = z.object({
  note: plainText()
    .trim()
    .max(MAX_SUBMISSION_NOTE, 'Keep the note under 1,000 characters.')
    .default(''),
});

export const submissionConfirmSchema = z.object({
  confirmFile: z.literal(true, 'Confirm that this is the file you intend to submit.'),
});

export const gradeInputSchema = z.object({
  /** The chosen level of every rubric criterion: { criterionId: levelId }. */
  levels: z.record(z.uuid(), z.uuid()),
  feedback: plainText().trim().max(MAX_FEEDBACK, 'Keep the feedback under 5,000 characters.'),
  /** Release the grade and feedback to the student now. */
  release: z.boolean().default(false),
  /** Required when a released grade or its feedback changes (X05). */
  reason: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    plainText().trim().min(5, 'Give a reason of at least 5 characters.').max(1000).optional(),
  ),
});
export type GradeInput = z.infer<typeof gradeInputSchema>;

export interface SubmissionFile {
  readonly id: string;
  readonly number: number;
  readonly status: SubmissionStatus;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly note: string;
  readonly savedAt: string;
  readonly submittedAt: string | null;
  readonly late: boolean;
}

/** A released grade as its student sees it. */
export interface ReleasedGrade {
  readonly score: number;
  readonly maxPoints: number;
  readonly feedback: string;
  readonly releasedAt: string;
  /** Submission the grade is for. */
  readonly submissionNumber: number | null;
  /** The level given for each criterion. */
  readonly levels: readonly { criterion: string; level: string; points: number }[];
}

/** S12: an assignment or project for one student. */
export interface StudentAssignment {
  readonly id: string;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly kind: AssessmentKind;
  readonly title: string;
  readonly instructions: string;
  readonly objectives: readonly { code: string; description: string }[];
  readonly opensAt: string;
  readonly dueAt: string;
  readonly acceptLate: boolean;
  readonly maxSubmissions: number;
  readonly rubric: readonly RubricCriterion[];
  readonly points: number;
  readonly submissions: readonly SubmissionFile[];
  /** Why no file can be uploaded or submitted now, or null. */
  readonly blockedReason: string | null;
  readonly grade: ReleasedGrade | null;
}

/** T13: where one student's work on one assessment stands. */
export type QueueStatus = 'needs_review' | 'draft_grade' | 'released' | 'missing';

export interface QueueItem {
  readonly assessmentId: string;
  readonly title: string;
  readonly kind: AssessmentKind;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly courseCode: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly submittedAt: string | null;
  readonly late: boolean;
  readonly status: QueueStatus;
}

export interface GradingQueue {
  readonly classes: readonly { id: string; name: string; courseCode: string }[];
  readonly items: readonly QueueItem[];
}

/** T14: one student's submissions and grade, for the teacher. */
export interface GradingView {
  readonly assessmentId: string;
  readonly title: string;
  readonly kind: AssessmentKind;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly sectionName: string;
  readonly dueAt: string;
  readonly student: { readonly id: string; readonly name: string; readonly email: string };
  readonly rubric: readonly RubricCriterion[];
  readonly points: number;
  readonly submissions: readonly SubmissionFile[];
  readonly grade: {
    readonly status: GradeStatus;
    readonly score: number;
    readonly feedback: string;
    readonly levels: Readonly<Record<string, string>>;
    readonly submissionId: string | null;
    readonly gradedAt: string;
    readonly releasedAt: string | null;
  } | null;
}
