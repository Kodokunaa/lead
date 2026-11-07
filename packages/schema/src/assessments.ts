import { z } from 'zod';
import { CONTENT_STATUSES, type ContentStatus } from './content';

/**
 * Assessments (wireframes T08–T12). An assessment belongs to one class (section): its dates,
 * attempts and grades are the class's. Quizzes and examinations are made of questions; assignments
 * and projects are scored with a rubric. Drafts are edited; a published assessment is read-only
 * until it is unpublished.
 */
export const ASSESSMENT_KINDS = ['quiz', 'exam', 'assignment', 'project'] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

export const ASSESSMENT_KIND_LABELS: Record<AssessmentKind, string> = {
  quiz: 'Quiz',
  exam: 'Examination',
  assignment: 'Assignment',
  project: 'Project',
};

/** Quizzes and examinations have questions; assignments and projects have a rubric. */
export function usesQuestions(kind: AssessmentKind): boolean {
  return kind === 'quiz' || kind === 'exam';
}

export const QUESTION_KINDS = ['multiple_choice', 'written'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const DIFFICULTIES = ['easy', 'moderate', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const ASSESSMENT_STATUSES = CONTENT_STATUSES;
export type AssessmentStatus = ContentStatus;

export const MAX_INSTRUCTIONS = 5000;
export const MAX_QUESTIONS = 100;
export const MAX_CHOICES = 6;
export const MAX_CRITERIA = 10;
export const MAX_LEVELS = 5;
export const MAX_ASSESSMENT_OBJECTIVES = 20;

/** Plain text; Postgres cannot store NUL characters. Render as text, never as HTML. */
const plainText = () =>
  z.string().refine((value) => !value.includes('\u0000'), 'Remove the invalid character.');

const titleSchema = plainText().trim().min(1, 'Enter a title.').max(120);

/**
 * A moment with its offset, e.g. `2026-10-22T17:00:00+08:00`. Blank means "not set yet" (a draft
 * may leave dates open; publishing needs both).
 */
const momentSchema = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.iso
    .datetime({ offset: true, message: 'Enter a date and time.' })
    .refine((value) => {
      const year = new Date(value).getUTCFullYear();
      return year >= 2000 && year <= 2100;
    }, 'Enter a date between 2000 and 2100.')
    .nullable(),
);

const blankToNull = (value: unknown) => (value === '' || value === undefined ? null : value);

export const assessmentCreateSchema = z.object({
  sectionId: z.uuid('Choose a class.'),
  kind: z.enum(ASSESSMENT_KINDS, 'Choose the assessment type.'),
  title: titleSchema,
});
export type AssessmentCreate = z.infer<typeof assessmentCreateSchema>;

const settingsFields = {
  title: titleSchema,
  instructions: plainText().trim().max(MAX_INSTRUCTIONS),
  opensAt: momentSchema,
  dueAt: momentSchema,
  /** Minutes; blank means untimed. Used by quizzes and examinations only. */
  timeLimitMinutes: z.preprocess(blankToNull, z.coerce.number().int().min(1).max(600).nullable()),
  maxAttempts: z.coerce.number().int().min(1).max(10),
  /** Assignments and projects: accept submissions after the due date, marked late. */
  acceptLate: z.boolean(),
  objectiveIds: z
    .array(z.uuid())
    .max(MAX_ASSESSMENT_OBJECTIVES)
    .transform((ids) => [...new Set(ids)]),
};

// Only the fields sent change, so no defaults here.
export const assessmentSettingsSchema = z
  .object(settingsFields)
  .partial()
  .refine((update) => Object.keys(update).length > 0, { message: 'Nothing to change.' });
export type AssessmentSettings = z.infer<typeof assessmentSettingsSchema>;

const choiceInputSchema = z.object({
  text: plainText().trim().min(1, 'Write every answer choice.').max(500),
  correct: z.boolean(),
});

export const questionInputSchema = z
  .object({
    kind: z.enum(QUESTION_KINDS),
    prompt: plainText().trim().min(1, 'Write the question.').max(2000),
    points: z.coerce.number().int().min(1).max(100),
    difficulty: z.enum(DIFFICULTIES).default('moderate'),
    /** Null only while a draft; publishing needs one of the assessment's objectives. */
    objectiveId: z.preprocess(blankToNull, z.uuid().nullable()).default(null),
    choices: z.array(choiceInputSchema).max(MAX_CHOICES).default([]),
  })
  .superRefine((question, context) => {
    if (question.kind === 'written') {
      if (question.choices.length > 0) {
        context.addIssue({
          code: 'custom',
          path: ['choices'],
          message: 'A written question has no answer choices.',
        });
      }
      return;
    }
    if (question.choices.length < 2) {
      context.addIssue({
        code: 'custom',
        path: ['choices'],
        message: 'Give at least two answer choices.',
      });
    }
    if (question.choices.filter((choice) => choice.correct).length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['choices'],
        message: 'Mark exactly one choice as the correct answer.',
      });
    }
  });
export type QuestionInput = z.infer<typeof questionInputSchema>;

export const questionMoveSchema = z.object({ direction: z.enum(['up', 'down']) });

const levelInputSchema = z.object({
  label: plainText().trim().min(1, 'Name every level.').max(60),
  points: z.coerce.number().int().min(0).max(100),
  descriptor: plainText().trim().max(500).default(''),
});

const criterionInputSchema = z
  .object({
    name: plainText().trim().min(1, 'Name every criterion.').max(120),
    levels: z
      .array(levelInputSchema)
      .min(2, 'Give each criterion at least two levels.')
      .max(MAX_LEVELS),
  })
  .refine(
    (criterion) =>
      new Set(criterion.levels.map((level) => level.points)).size === criterion.levels.length,
    { path: ['levels'], message: 'Give each level of a criterion different points.' },
  );

/** The whole rubric, saved at once (T11). */
export const rubricInputSchema = z.object({
  criteria: z.array(criterionInputSchema).max(MAX_CRITERIA),
});
export type RubricInput = z.infer<typeof rubricInputSchema>;

// ---------- Answers

export interface AssessmentObjective {
  readonly id: string;
  readonly code: string;
  readonly description: string;
}

export interface AssessmentSummary {
  readonly id: string;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly courseId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly kind: AssessmentKind;
  readonly title: string;
  readonly status: AssessmentStatus;
  readonly opensAt: string | null;
  readonly dueAt: string | null;
  readonly objectiveCodes: readonly string[];
  readonly points: number;
}

export interface QuestionChoice {
  readonly id: string;
  readonly text: string;
  readonly correct: boolean;
}

export interface Question {
  readonly id: string;
  readonly position: number;
  readonly kind: QuestionKind;
  readonly prompt: string;
  readonly points: number;
  readonly difficulty: Difficulty;
  readonly objectiveId: string | null;
  readonly choices: readonly QuestionChoice[];
}

export interface RubricLevel {
  readonly id: string;
  readonly label: string;
  readonly points: number;
  readonly descriptor: string;
}

export interface RubricCriterion {
  readonly id: string;
  readonly name: string;
  readonly levels: readonly RubricLevel[];
}

/** Where a teacher fixes a failed publication check. */
export type ChecklistFix = 'settings' | 'questions' | 'rubric';

export interface ChecklistItem {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly fix: ChecklistFix;
}

export interface AssessmentDetails extends AssessmentSummary {
  readonly instructions: string;
  readonly timeLimitMinutes: number | null;
  readonly maxAttempts: number;
  readonly acceptLate: boolean;
  readonly objectiveIds: readonly string[];
  readonly publishedAt: string | null;
  readonly updatedAt: string;
  readonly enrolled: number;
  /** The course's objectives, to choose from. */
  readonly courseObjectives: readonly AssessmentObjective[];
  readonly questions: readonly Question[];
  readonly rubric: readonly RubricCriterion[];
  /** T12: what publishing checks, each passed or not. */
  readonly checklist: readonly ChecklistItem[];
}

/** A class the teacher can create assessments in (current term, course not archived). */
export interface AssessmentClass {
  readonly id: string;
  readonly name: string;
  readonly courseCode: string;
  readonly courseTitle: string;
}

export interface AssessmentList {
  readonly classes: readonly AssessmentClass[];
  readonly items: readonly AssessmentSummary[];
}
