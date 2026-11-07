import type {
  AttemptResult,
  AttemptView,
  StudentAssessmentDetails,
  StudentAssessmentSummary,
} from '@lead/schema';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi, type FakeApi } from '../../../test/fake-api';
import { renderApp } from '../../../test/render-app';
import { formatRemaining } from './shared';
import { interpretation } from './ResultPage';

const QUIZ = '11111111-1111-4111-8111-111111111111';
const ATTEMPT = '22222222-2222-4222-8222-222222222222';
const SECTION = '33333333-3333-4333-8333-333333333333';
const Q1 = '44444444-4444-4444-8444-444444444444';
const Q2 = '55555555-5555-4555-8555-555555555555';
const RIGHT = '66666666-6666-4666-8666-666666666666';
const WRONG = '77777777-7777-4777-8777-777777777777';
const HOUR = 60 * 60 * 1000;

function summary(overrides: Partial<StudentAssessmentSummary> = {}): StudentAssessmentSummary {
  return {
    id: QUIZ,
    sectionId: SECTION,
    sectionName: 'BSIS 3-A',
    courseCode: 'IS 301',
    courseTitle: 'Database Systems',
    kind: 'quiz',
    title: 'Quiz 3',
    objectiveCodes: ['O2'],
    opensAt: '2026-11-01T00:00:00.000Z',
    dueAt: '2099-11-22T09:00:00.000Z',
    state: 'available',
    attemptsUsed: 0,
    maxAttempts: 2,
    ...overrides,
  };
}

function view(overrides: Partial<AttemptView> = {}): AttemptView {
  const now = new Date();
  return {
    id: ATTEMPT,
    number: 1,
    status: 'in_progress',
    assessmentId: QUIZ,
    sectionId: SECTION,
    title: 'Quiz 3',
    kind: 'quiz',
    courseCode: 'IS 301',
    sectionName: 'BSIS 3-A',
    maxAttempts: 2,
    deadlineAt: new Date(now.getTime() + HOUR).toISOString(),
    serverNow: now.toISOString(),
    questions: [
      {
        id: Q1,
        position: 1,
        kind: 'multiple_choice',
        prompt: 'Which change removes a partial dependency?',
        points: 2,
        choices: [
          { id: RIGHT, text: 'Separate the dependent attributes' },
          { id: WRONG, text: 'Keep one relation' },
        ],
      },
      { id: Q2, position: 2, kind: 'written', prompt: 'Explain 2NF.', points: 5, choices: [] },
    ],
    answers: [],
    ...overrides,
  };
}

const result: AttemptResult = {
  id: ATTEMPT,
  number: 1,
  assessmentId: QUIZ,
  sectionId: SECTION,
  title: 'Quiz 3',
  courseCode: 'IS 301',
  sectionName: 'BSIS 3-A',
  submittedAt: '2026-11-07T01:00:00.000Z',
  autoSubmitted: false,
  answered: 2,
  questionCount: 2,
  score: 2,
  scoredPoints: 2,
  pendingPoints: 5,
  objectives: [
    { code: 'O1', description: 'Explain dependencies', correct: 1, scored: 1, pending: 0 },
    { code: 'O2', description: 'Apply normalization', correct: 0, scored: 0, pending: 1 },
  ],
  attemptsUsed: 1,
  maxAttempts: 2,
  canRetake: true,
  grade: null,
};

function studentApi(): FakeApi {
  const api = installFakeApi(fakeUser('student'));
  api.on(`GET /student/attempts/${ATTEMPT}`, { status: 200, body: view() });
  api.on(`GET /student/attempts/${ATTEMPT}/result`, { status: 200, body: result });
  api.on(`POST /student/attempts/${ATTEMPT}/submit`, { status: 200, body: result });
  return api;
}

const saved = (questionId: string) => ({
  status: 200,
  body: { questionId, savedAt: new Date().toISOString() },
});

describe('quiz attempts (S07–S11)', () => {
  it('formats the time left and reads the evidence', () => {
    expect(formatRemaining(18 * 60_000 + 42_000, '')).toBe('18:42');
    expect(formatRemaining(HOUR + 5 * 60_000 + 9_000, '')).toBe('1:05:09');
    expect(interpretation({ code: 'O1', description: '', correct: 3, scored: 4, pending: 0 })).toBe(
      'Criterion met',
    );
    expect(interpretation({ code: 'O1', description: '', correct: 2, scored: 4, pending: 0 })).toBe(
      'Needs targeted practice',
    );
  });

  it('lists quizzes with what the student can do next (S07)', async () => {
    const api = installFakeApi(fakeUser('student'));
    api.on('GET /student/assessments', {
      status: 200,
      body: [
        summary(),
        summary({ id: ATTEMPT, title: 'Unit exam', kind: 'exam', state: 'scheduled' }),
      ],
    });
    renderApp('/student/assessments');

    const quiz = await screen.findByRole('row', { name: /Quiz 3/ });
    expect(within(quiz).getByText('Available')).toBeInTheDocument();
    expect(within(quiz).getByRole('link', { name: 'Start Quiz 3' })).toHaveAttribute(
      'href',
      `/student/assessments/${QUIZ}`,
    );
    const exam = screen.getByRole('row', { name: /Unit exam/ });
    expect(within(exam).getByText('Scheduled')).toBeInTheDocument();
  });

  it('begins an attempt from the instructions (S08)', async () => {
    const api = studentApi();
    const details: StudentAssessmentDetails = {
      ...summary(),
      instructions: 'Read each question carefully.',
      timeLimitMinutes: 20,
      questionCount: 2,
      points: 7,
      objectives: [{ code: 'O2', description: 'Apply normalization' }],
      attempts: [],
      blockedReason: null,
    };
    api.on(`GET /student/assessments/${QUIZ}`, { status: 200, body: details });
    api.on(`POST /student/assessments/${QUIZ}/attempts`, { status: 200, body: view() });
    renderApp(`/student/assessments/${QUIZ}`);

    expect(await screen.findByText('2 questions / 7 points / 20 minutes')).toBeInTheDocument();
    expect(screen.getByText('The AI assistant is off during the attempt.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Begin attempt 1' }));

    expect(
      await screen.findByRole('heading', { name: 'Quiz or examination attempt' }),
    ).toHaveFocus();
    expect(screen.getByText('Which change removes a partial dependency?')).toBeInTheDocument();
  });

  it('explains why an attempt cannot begin (S08)', async () => {
    const api = studentApi();
    api.on(`GET /student/assessments/${QUIZ}`, {
      status: 200,
      body: {
        ...summary({ state: 'scheduled' }),
        instructions: '',
        timeLimitMinutes: null,
        questionCount: 2,
        points: 7,
        objectives: [],
        attempts: [],
        blockedReason: 'It opens on Nov 20, 2026, 8:00 AM.',
      } satisfies StudentAssessmentDetails,
    });
    renderApp(`/student/assessments/${QUIZ}`);

    expect(await screen.findByText('It opens on Nov 20, 2026, 8:00 AM.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Begin/ })).not.toBeInTheDocument();
  });

  it('saves each answer and offers a retry when saving fails (S09, X02)', async () => {
    const api = studentApi();
    api.on(`PUT /student/attempts/${ATTEMPT}/answers/${Q1}`, {
      status: 503,
      body: { message: 'Service unavailable.' },
    });
    renderApp(`/student/attempts/${ATTEMPT}`);

    await userEvent.click(await screen.findByLabelText('Separate the dependent attributes'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your most recent answer has not been saved.',
    );
    expect(api.bodyOf(`PUT /student/attempts/${ATTEMPT}/answers/${Q1}`)).toEqual({
      choiceId: RIGHT,
      text: '',
    });

    api.on(`PUT /student/attempts/${ATTEMPT}/answers/${Q1}`, saved(Q1));
    await userEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
    expect(await screen.findByText(/^Saved at /)).toBeInTheDocument();
    expect(screen.getByText('Unanswered: 1 question')).toBeInTheDocument();

    api.on(`PUT /student/attempts/${ATTEMPT}/answers/${Q2}`, saved(Q2));
    await userEvent.click(screen.getByRole('button', { name: 'Question 2, not answered' }));
    expect(screen.getByRole('heading', { name: /Question 2 of 2/ })).toHaveFocus();
    await userEvent.type(screen.getByLabelText('Your answer'), 'No partial dependencies.');
    await waitFor(() =>
      expect(api.bodyOf(`PUT /student/attempts/${ATTEMPT}/answers/${Q2}`)).toEqual({
        choiceId: null,
        text: 'No partial dependencies.',
      }),
    );
    expect(screen.getByRole('button', { name: 'Question 2, answered' })).toBeInTheDocument();
  });

  it('submits on its own when time runs out (S09)', async () => {
    const api = studentApi();
    const now = new Date().toISOString();
    api.on(`GET /student/attempts/${ATTEMPT}`, {
      status: 200,
      body: view({ deadlineAt: now, serverNow: now }),
    });
    renderApp(`/student/attempts/${ATTEMPT}`);

    expect(await screen.findByText('Multiple choice: 2 / 2 (100%)')).toBeInTheDocument();
    expect(api.calls).toContain(`POST /student/attempts/${ATTEMPT}/submit`);
  });

  it('reviews unanswered questions and submits (S10, S11)', async () => {
    const api = studentApi();
    api.on(`GET /student/attempts/${ATTEMPT}`, {
      status: 200,
      body: view({
        answers: [{ questionId: Q1, choiceId: RIGHT, text: '', savedAt: new Date().toISOString() }],
      }),
    });
    renderApp(`/student/attempts/${ATTEMPT}/review`);

    const row = await screen.findByRole('row', { name: /1–2/ });
    expect(within(row).getByText('1 of 2')).toBeInTheDocument();
    expect(within(row).getByText('Question 2 unanswered')).toBeInTheDocument();
    expect(screen.getByText(/1 question is unanswered/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm submit' }));

    expect(
      await screen.findByRole('heading', { name: 'Assessment result and feedback' }),
    ).toHaveFocus();
    expect(api.calls).toContain(`POST /student/attempts/${ATTEMPT}/submit`);
    expect(screen.getByText('Multiple choice: 2 / 2 (100%)')).toBeInTheDocument();
    expect(
      screen.getByText('Written answers: 5 points awaiting teacher grading'),
    ).toBeInTheDocument();
    const o2 = screen.getByRole('row', { name: /O2/ });
    expect(within(o2).getByText('Awaiting teacher grading')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Try again/ })).toHaveAttribute(
      'href',
      `/student/assessments/${QUIZ}`,
    );
  });

  it('sends a submitted attempt to its result (S09)', async () => {
    const api = studentApi();
    api.on(`GET /student/attempts/${ATTEMPT}`, {
      status: 200,
      body: view({ status: 'submitted' }),
    });
    renderApp(`/student/attempts/${ATTEMPT}`);

    expect(await screen.findByText('Multiple choice: 2 / 2 (100%)')).toBeInTheDocument();
    expect(api.calls).not.toContain(`POST /student/attempts/${ATTEMPT}/submit`);
  });

  it('shows the grade once the teacher releases it (S11)', async () => {
    const api = studentApi();
    api.on(`GET /student/attempts/${ATTEMPT}/result`, {
      status: 200,
      body: {
        ...result,
        grade: {
          score: 6,
          maxPoints: 7,
          feedback: 'Good start.',
          releasedAt: '2026-11-08T01:00:00.000Z',
          written: [{ position: 2, points: 4, maxPoints: 5 }],
        },
      } satisfies AttemptResult,
    });
    renderApp(`/student/attempts/${ATTEMPT}/result`);

    expect(await screen.findByText('Total graded by your teacher: 6 / 7')).toBeInTheDocument();
    expect(screen.getByText('Written question 2: 4 / 5')).toBeInTheDocument();
    expect(screen.getByText('Feedback: Good start.')).toBeInTheDocument();
    expect(screen.queryByText(/This is not your official grade/)).not.toBeInTheDocument();
  });
});
