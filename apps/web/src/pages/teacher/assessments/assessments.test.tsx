import type { AssessmentDetails, AssessmentList, AssessmentSummary } from '@lead/schema';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi, type FakeApi } from '../../../test/fake-api';
import { renderApp } from '../../../test/render-app';
import { fromManilaInput, toManilaInput } from './shared';

const ID = '11111111-1111-4111-8111-111111111111';
const SECTION = '22222222-2222-4222-8222-222222222222';
const O1 = '33333333-3333-4333-8333-333333333333';
const O2 = '44444444-4444-4444-8444-444444444444';
const LATER = '2099-10-22T09:00:00.000Z';

function summary(overrides: Partial<AssessmentSummary> = {}): AssessmentSummary {
  return {
    id: ID,
    sectionId: SECTION,
    sectionName: 'BSIS 3-A',
    courseId: '55555555-5555-4555-8555-555555555555',
    courseCode: 'IS 301',
    courseTitle: 'Database Systems',
    kind: 'quiz',
    title: 'Quiz 3',
    status: 'draft',
    opensAt: null,
    dueAt: null,
    objectiveCodes: [],
    points: 0,
    ...overrides,
  };
}

function details(overrides: Partial<AssessmentDetails> = {}): AssessmentDetails {
  return {
    ...summary(),
    instructions: '',
    timeLimitMinutes: null,
    maxAttempts: 1,
    objectiveIds: [],
    publishedAt: null,
    updatedAt: '2026-11-02T00:00:00.000Z',
    enrolled: 12,
    courseObjectives: [
      { id: O1, code: 'O1', description: 'Explain dependencies' },
      { id: O2, code: 'O2', description: 'Apply normalization' },
    ],
    questions: [],
    rubric: [],
    checklist: [
      {
        label: 'Title, class and objectives',
        ok: false,
        detail: 'Map the assessment to at least one learning objective.',
        fix: 'settings',
      },
      {
        label: 'Questions and answer keys',
        ok: false,
        detail: 'Add at least one question.',
        fix: 'questions',
      },
    ],
    ...overrides,
  };
}

const PATH = `/teacher/assessments/${ID}`;

function teacherApi(answer: AssessmentDetails = details()): FakeApi {
  const api = installFakeApi(fakeUser('teacher'));
  api.on(`GET ${PATH}`, { status: 200, body: answer });
  return api;
}

describe('assessment builder (T08–T12)', () => {
  it('converts between Philippine time and instants', () => {
    expect(toManilaInput('2026-10-22T09:00:00.000Z')).toBe('2026-10-22T17:00');
    expect(fromManilaInput('2026-10-22T17:00')).toBe('2026-10-22T17:00:00+08:00');
    expect(fromManilaInput('')).toBe('');
    // Past midnight in Manila is still the previous day in UTC.
    expect(toManilaInput('2026-10-21T16:30:00.000Z')).toBe('2026-10-22T00:30');
  });

  it('lists assessments and creates a draft (T08)', async () => {
    const api = installFakeApi(fakeUser('teacher'));
    const list: AssessmentList = {
      classes: [
        { id: SECTION, name: 'BSIS 3-A', courseCode: 'IS 301', courseTitle: 'Database Systems' },
      ],
      items: [
        summary({
          title: 'Unit exam',
          kind: 'exam',
          status: 'published',
          opensAt: LATER,
          dueAt: LATER,
        }),
        summary({ id: O1, title: 'Quiz 3', objectiveCodes: ['O2'] }),
      ],
    };
    api.on('GET /teacher/assessments', { status: 200, body: list });
    api.on('POST /teacher/assessments', { status: 201, body: details({ title: 'Quiz 4' }) });
    api.on(`GET ${PATH}`, { status: 200, body: details({ title: 'Quiz 4' }) });
    renderApp('/teacher/assessments');

    const exam = await screen.findByRole('row', { name: /Unit exam/ });
    expect(within(exam).getByText('Scheduled')).toBeInTheDocument();
    expect(within(exam).getByRole('link', { name: 'View Unit exam' })).toBeInTheDocument();
    const quiz = screen.getByRole('row', { name: /Quiz 3/ });
    expect(within(quiz).getByText('Draft')).toBeInTheDocument();
    expect(within(quiz).getByText('Not set')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create assessment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create an assessment' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'exam');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Quiz 4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByRole('heading', { name: 'Assessment settings' })).toHaveFocus();
    expect(api.bodyOf('POST /teacher/assessments')).toEqual({
      sectionId: SECTION,
      kind: 'exam',
      title: 'Quiz 4',
    });
  });

  it('saves settings in Philippine time (T09)', async () => {
    const api = teacherApi();
    api.on(`PATCH ${PATH}`, () => {
      api.on(`GET ${PATH}`, {
        status: 200,
        body: details({ objectiveIds: [O2], objectiveCodes: ['O2'], timeLimitMinutes: 20 }),
      });
      return { status: 200, body: details() };
    });
    renderApp(PATH);

    await userEvent.type(
      await screen.findByLabelText('Opens (Philippine time)'),
      '2026-10-20T08:00',
    );
    await userEvent.type(screen.getByLabelText('Due (Philippine time)'), '2026-10-22T17:00');
    await userEvent.type(screen.getByLabelText('Time limit in minutes'), '20');
    await userEvent.click(screen.getByLabelText('O2 – Apply normalization'));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect((await screen.findByText('Changes saved.')).closest('[role="status"]')).toHaveFocus();
    expect(api.bodyOf(`PATCH ${PATH}`)).toEqual({
      title: 'Quiz 3',
      instructions: '',
      opensAt: '2026-10-20T08:00:00+08:00',
      dueAt: '2026-10-22T17:00:00+08:00',
      timeLimitMinutes: '20',
      maxAttempts: '1',
      objectiveIds: [O2],
    });
    await waitFor(() => expect(screen.getByLabelText('Time limit in minutes')).toHaveValue(20));
  });

  it('keeps a published assessment read-only (T09)', async () => {
    teacherApi(details({ status: 'published', opensAt: LATER, dueAt: LATER }));
    renderApp(PATH);

    expect(
      await screen.findByText(/This assessment is published, so it is read-only/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  });

  it('adds a multiple-choice question with its answer key (T10)', async () => {
    const api = teacherApi(details({ objectiveIds: [O2], objectiveCodes: ['O2'] }));
    api.on(`POST ${PATH}/questions`, {
      status: 400,
      body: { message: 'Write every answer choice.' },
    });
    renderApp(`${PATH}/questions`);

    await userEvent.type(
      await screen.findByLabelText('Question text'),
      'Which change removes a partial dependency?',
    );
    await userEvent.type(screen.getByLabelText('Choice A'), 'Keep every attribute together');
    await userEvent.type(screen.getByLabelText('Choice B'), 'Separate the dependent attributes');
    await userEvent.click(screen.getByLabelText('Remove choice D'));
    await userEvent.click(screen.getByLabelText('Remove choice C'));
    await userEvent.click(screen.getByLabelText('Choice B is correct'));
    await userEvent.clear(screen.getByLabelText('Points'));
    await userEvent.type(screen.getByLabelText('Points'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Add question' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Write every answer choice.');
    expect(api.bodyOf(`POST ${PATH}/questions`)).toEqual({
      kind: 'multiple_choice',
      prompt: 'Which change removes a partial dependency?',
      points: '2',
      difficulty: 'moderate',
      objectiveId: O2,
      choices: [
        { text: 'Keep every attribute together', correct: false },
        { text: 'Separate the dependent attributes', correct: true },
      ],
    });
  });

  it('shows questions and moves one (T10)', async () => {
    const question = (id: string, position: number, prompt: string) => ({
      id,
      position,
      kind: 'written' as const,
      prompt,
      points: 5,
      difficulty: 'hard' as const,
      objectiveId: O2,
      choices: [],
    });
    const api = teacherApi(
      details({
        objectiveIds: [O2],
        questions: [question(O1, 1, 'Explain 2NF.'), question(SECTION, 2, 'Explain 3NF.')],
      }),
    );
    api.on(`POST ${PATH}/questions/${SECTION}/move`, { status: 200, body: details() });
    renderApp(`${PATH}/questions`);

    expect(await screen.findByText('Explain 3NF.')).toBeInTheDocument();
    expect(screen.getAllByText(/O2 – Apply normalization · 5 points · hard/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Move question 1 up' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move question 2 up' }));
    expect(await screen.findByText('Question moved up.')).toBeInTheDocument();
    expect(api.bodyOf(`POST ${PATH}/questions/${SECTION}/move`)).toEqual({ direction: 'up' });
  });

  it('builds and saves a rubric (T11)', async () => {
    const api = teacherApi(details({ kind: 'assignment', objectiveCodes: ['O2'] }));
    api.on(`PUT ${PATH}/rubric`, { status: 200, body: details() });
    renderApp(`${PATH}/rubric`);

    await userEvent.click(await screen.findByRole('button', { name: 'Add criterion' }));
    await userEvent.type(screen.getByLabelText('Criterion 1 name'), 'Correctness');
    await userEvent.type(
      screen.getByLabelText('Descriptor, criterion 1, level 1'),
      'All transformations correct',
    );
    expect(screen.getByText('Total: 4 points / Objective O2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save rubric' }));

    expect(await screen.findByText('Rubric saved.')).toBeInTheDocument();
    expect(api.bodyOf(`PUT ${PATH}/rubric`)).toEqual({
      criteria: [
        {
          name: 'Correctness',
          levels: [
            { label: 'Strong', points: '4', descriptor: 'All transformations correct' },
            { label: 'Developing', points: '2', descriptor: '' },
            { label: 'Needs work', points: '0', descriptor: '' },
          ],
        },
      ],
    });
  });

  it('names what blocks publication and publishes (T12)', async () => {
    const api = teacherApi();
    api.on(`POST ${PATH}/publish`, {
      status: 409,
      body: { message: 'Map the assessment to at least one learning objective.' },
    });
    renderApp(`${PATH}/review`);

    const fix = await screen.findByRole('link', { name: 'Fix the questions' });
    expect(fix).toHaveAttribute('href', `${PATH}/questions`);
    expect(screen.getByText(/12 enrolled students/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm publish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Map the assessment to at least one learning objective.',
    );

    api.on(`POST ${PATH}/publish`, () => {
      api.on(`GET ${PATH}`, {
        status: 200,
        body: details({ status: 'published', opensAt: LATER, dueAt: LATER, publishedAt: LATER }),
      });
      return { status: 200, body: details() };
    });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm publish' }));
    expect(await screen.findByText('Quiz 3 published.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
  });

  it('marks only the current step as current', async () => {
    teacherApi();
    renderApp(`${PATH}/questions`);

    await screen.findByRole('heading', { name: 'Question and objective editor' });
    const steps = within(screen.getByRole('navigation', { name: 'Assessment steps' }));
    expect(steps.getAllByRole('link').filter((link) => link.getAttribute('aria-current'))).toEqual([
      steps.getByRole('link', { name: 'Questions' }),
    ]);
  });

  it('edits a question into a written one (T10)', async () => {
    const api = teacherApi(
      details({
        objectiveIds: [O2],
        questions: [
          {
            id: O1,
            position: 1,
            kind: 'multiple_choice',
            prompt: 'Pick one.',
            points: 2,
            difficulty: 'easy',
            objectiveId: O2,
            choices: [
              { id: SECTION, text: 'Yes', correct: true },
              { id: ID, text: 'No', correct: false },
            ],
          },
        ],
      }),
    );
    api.on(`PUT ${PATH}/questions/${O1}`, { status: 200, body: details() });
    renderApp(`${PATH}/questions`);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit question 1' }));
    expect(await screen.findByRole('heading', { name: 'Edit question 1' })).toHaveFocus();
    expect(screen.getByLabelText('Choice A')).toHaveValue('Yes');
    await userEvent.selectOptions(screen.getByLabelText('Format'), 'written');
    expect(screen.queryByLabelText('Choice A')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save question' }));

    expect(await screen.findByText('Question 1 saved.')).toBeInTheDocument();
    expect(api.bodyOf(`PUT ${PATH}/questions/${O1}`)).toEqual({
      kind: 'written',
      prompt: 'Pick one.',
      points: '2',
      difficulty: 'easy',
      objectiveId: O2,
      choices: [],
    });
  });

  it('unpublishes after confirming (T12)', async () => {
    const api = teacherApi(
      details({ status: 'published', opensAt: LATER, dueAt: LATER, publishedAt: LATER }),
    );
    api.on(`POST ${PATH}/unpublish`, () => {
      api.on(`GET ${PATH}`, { status: 200, body: details() });
      return { status: 200, body: details() };
    });
    renderApp(`${PATH}/review`);

    expect(await screen.findByText('Status: Scheduled')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Unpublish' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unpublish Quiz 3?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unpublish' }));

    expect(await screen.findByText('Quiz 3 is a draft again.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Confirm publish' })).toBeInTheDocument();
  });
});
