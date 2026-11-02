import {
  usesQuestions,
  type AssessmentKind,
  type ChecklistItem,
  type Question,
  type RubricCriterion,
} from '@lead/schema';

const MANILA = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const plural = (total: number, noun: string) => `${total} ${noun}${total === 1 ? '' : 's'}`;

export function questionPoints(questions: readonly Pick<Question, 'points'>[]): number {
  return questions.reduce((total, question) => total + question.points, 0);
}

/** A rubric is worth the best level of every criterion. */
export function rubricPoints(rubric: readonly RubricCriterion[]): number {
  return rubric.reduce(
    (total, criterion) => total + Math.max(0, ...criterion.levels.map((level) => level.points)),
    0,
  );
}

export interface ChecklistInput {
  readonly kind: AssessmentKind;
  readonly objectiveCodes: readonly string[];
  readonly opensAt: Date | null;
  readonly dueAt: Date | null;
  readonly timeLimitMinutes: number | null;
  readonly maxAttempts: number;
  readonly questions: readonly Question[];
  readonly rubric: readonly RubricCriterion[];
}

/**
 * What publishing checks (wireframe T12), each passed or not, with where to fix it. Publishing is
 * refused while any item fails.
 */
export function publicationChecklist(input: ChecklistInput, now: Date): ChecklistItem[] {
  return [
    {
      label: 'Title, class and objectives',
      ok: input.objectiveCodes.length > 0,
      detail:
        input.objectiveCodes.length > 0
          ? `Measures ${input.objectiveCodes.join(', ')}`
          : 'Map the assessment to at least one learning objective.',
      fix: 'settings',
    },
    usesQuestions(input.kind) ? questionsItem(input.questions) : rubricItem(input.rubric),
    {
      label: usesQuestions(input.kind) ? 'Time limit and attempts' : 'Submissions',
      ok: true,
      detail: usesQuestions(input.kind)
        ? `${input.timeLimitMinutes ? plural(input.timeLimitMinutes, 'minute') : 'Untimed'} / ${plural(input.maxAttempts, 'attempt')}`
        : plural(input.maxAttempts, 'submission'),
      fix: 'settings',
    },
    datesItem(input.opensAt, input.dueAt, now),
    {
      label: 'AI use follows institutional policy',
      ok: true,
      detail: 'The AI assistant is off during attempts.',
      fix: 'settings',
    },
  ];
}

function questionsItem(questions: readonly Question[]): ChecklistItem {
  const unmapped = questions.find((question) => question.objectiveId === null);
  const ok = questions.length > 0 && !unmapped;
  return {
    label: 'Questions and answer keys',
    ok,
    detail:
      questions.length === 0
        ? 'Add at least one question.'
        : unmapped
          ? `Question ${unmapped.position} needs a learning objective.`
          : `${plural(questions.length, 'question')} / ${plural(questionPoints(questions), 'point')}`,
    fix: 'questions',
  };
}

function rubricItem(rubric: readonly RubricCriterion[]): ChecklistItem {
  return {
    label: 'Rubric and scoring',
    ok: rubric.length > 0,
    detail:
      rubric.length === 0
        ? 'Add at least one rubric criterion.'
        : `${plural(rubric.length, 'criterion').replace('criterions', 'criteria')} / ${plural(rubricPoints(rubric), 'point')}`,
    fix: 'rubric',
  };
}

function datesItem(opensAt: Date | null, dueAt: Date | null, now: Date): ChecklistItem {
  const label = 'Opening and due dates';
  if (!opensAt || !dueAt) {
    return { label, ok: false, detail: 'Set the opening and due dates.', fix: 'settings' };
  }
  if (dueAt <= now) {
    return {
      label,
      ok: false,
      detail: 'The due date has passed. Choose a later one.',
      fix: 'settings',
    };
  }
  return {
    label,
    ok: true,
    detail: `Opens ${MANILA.format(opensAt)} / due ${MANILA.format(dueAt)}`,
    fix: 'settings',
  };
}
