import type {
  GradingQueue,
  GradingView,
  RubricCriterion,
  StudentAssignment,
  SubmissionFile,
} from '@lead/schema';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi } from '../../../test/fake-api';
import { renderApp } from '../../../test/render-app';

const WORK = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';
const SUB1 = '33333333-3333-4333-8333-333333333333';
const SUB2 = '44444444-4444-4444-8444-444444444444';
const C1 = '55555555-5555-4555-8555-555555555555';
const C2 = '66666666-6666-4666-8666-666666666666';

const levels = (criterion: string) =>
  [
    ['Strong', 4],
    ['Developing', 2],
    ['Needs work', 0],
  ].map(([label, points]) => ({
    id: `${criterion.slice(0, 30)}${String(points).padStart(6, '0')}`,
    label: label as string,
    points: points as number,
    descriptor: '',
  }));
const RUBRIC: RubricCriterion[] = [
  { id: C1, name: 'Correctness', levels: levels(C1) },
  { id: C2, name: 'Explanation', levels: levels(C2) },
];
const level = (criterion: number, points: number) =>
  RUBRIC[criterion]!.levels.find((item) => item.points === points)!.id;

function file(overrides: Partial<SubmissionFile> = {}): SubmissionFile {
  return {
    id: SUB1,
    number: 1,
    status: 'submitted',
    fileName: 'exercise.pdf',
    sizeBytes: 2048,
    note: '',
    savedAt: '2026-11-07T01:00:00.000Z',
    submittedAt: '2026-11-07T01:10:00.000Z',
    late: false,
    ...overrides,
  };
}

function assignment(overrides: Partial<StudentAssignment> = {}): StudentAssignment {
  return {
    id: WORK,
    sectionId: STUDENT,
    sectionName: 'BSIS 3-A',
    courseCode: 'IS 301',
    courseTitle: 'Database Systems',
    kind: 'assignment',
    title: 'Normalization exercise',
    instructions: 'Explain each normalization step.',
    objectives: [{ code: 'O2', description: 'Apply normalization' }],
    opensAt: '2026-11-01T00:00:00.000Z',
    dueAt: '2099-11-23T09:00:00.000Z',
    acceptLate: false,
    maxSubmissions: 2,
    rubric: RUBRIC,
    points: 8,
    submissions: [],
    blockedReason: null,
    grade: null,
    ...overrides,
  };
}

function view(overrides: Partial<GradingView> = {}): GradingView {
  return {
    assessmentId: WORK,
    title: 'Normalization exercise',
    kind: 'assignment',
    courseCode: 'IS 301',
    courseTitle: 'Database Systems',
    sectionName: 'BSIS 3-A',
    dueAt: '2099-11-23T09:00:00.000Z',
    student: { id: STUDENT, name: 'Learner 01', email: 'learner01@lead.test' },
    rubric: RUBRIC,
    points: 8,
    submissions: [file()],
    grade: null,
    ...overrides,
  };
}

const STUDENT_PATH = `/student/assignments/${WORK}`;
const GRADE_PATH = `/teacher/grading/${WORK}/students/${STUDENT}`;

describe('assignment submission (S12)', () => {
  it('uploads a draft, then submits it once confirmed', async () => {
    const api = installFakeApi(fakeUser('student'));
    api.on(`GET ${STUDENT_PATH}`, { status: 200, body: assignment() });
    api.on(`POST ${STUDENT_PATH}/draft`, () => {
      api.on(`GET ${STUDENT_PATH}`, {
        status: 200,
        body: assignment({
          submissions: [file({ id: SUB2, status: 'draft', number: 0, submittedAt: null })],
        }),
      });
      return { status: 200, body: assignment() };
    });
    renderApp(STUDENT_PATH);

    expect(await screen.findByText('Correctness')).toBeInTheDocument();
    expect(screen.getByText('Not yet submitted')).toBeInTheDocument();
    const upload = new File(['%PDF-1.4'], 'exercise.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText('File'), upload);
    await userEvent.type(screen.getByLabelText('Note to your teacher (optional)'), 'Steps inside.');
    // jsdom's form validation cannot see files attached by user-event, so submit directly.
    fireEvent.submit(screen.getByRole('button', { name: 'Save draft' }).closest('form')!);

    expect(await screen.findByText(/Draft saved/)).toBeInTheDocument();
    const sent = api.bodyOf(`POST ${STUDENT_PATH}/draft`) as FormData;
    // jsdom leaves the chosen file's contents out; the API tests cover the file itself.
    expect(sent.has('file')).toBe(true);
    expect(sent.get('note')).toBe('Steps inside.');

    api.on(`POST ${STUDENT_PATH}/submit`, () => {
      api.on(`GET ${STUDENT_PATH}`, { status: 200, body: assignment({ submissions: [file()] }) });
      return { status: 200, body: assignment() };
    });
    await userEvent.click(await screen.findByLabelText('This is the file I intend to submit.'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm submit' }));
    expect(await screen.findByText('exercise.pdf submitted.')).toBeInTheDocument();
    expect(api.bodyOf(`POST ${STUDENT_PATH}/submit`)).toEqual({ confirmFile: true });
    expect(await screen.findByText('Submitted 1 of 2 allowed')).toBeInTheDocument();
  });

  it('downloads the draft from the review box without submitting it', async () => {
    const api = installFakeApi(fakeUser('student'));
    api.on(`GET ${STUDENT_PATH}`, {
      status: 200,
      body: assignment({
        submissions: [file({ id: SUB2, status: 'draft', number: 0, submittedAt: null })],
      }),
    });
    api.on(`GET /student/submissions/${SUB2}/file`, { status: 404, body: { message: 'Gone.' } });
    renderApp(STUDENT_PATH);

    await userEvent.click(await screen.findByLabelText('This is the file I intend to submit.'));
    await userEvent.click(screen.getByRole('button', { name: 'exercise.pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Download failed: Gone.');
    expect(api.calls).not.toContain(`POST ${STUDENT_PATH}/submit`);
  });

  it('shows why it is closed, and the released grade', async () => {
    const api = installFakeApi(fakeUser('student'));
    api.on(`GET ${STUDENT_PATH}`, {
      status: 200,
      body: assignment({
        submissions: [file()],
        blockedReason: 'This assignment is closed.',
        grade: {
          score: 6,
          maxPoints: 8,
          feedback: 'Clarify step 2.',
          releasedAt: '2026-11-08T01:00:00.000Z',
          submissionNumber: 1,
          levels: [
            { criterion: 'Correctness', level: 'Strong', points: 4 },
            { criterion: 'Explanation', level: 'Developing', points: 2 },
          ],
        },
      }),
    });
    renderApp(STUDENT_PATH);

    expect(await screen.findByText('This assignment is closed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.getByText('Score: 6 / 8 (submission 1)')).toBeInTheDocument();
    expect(screen.getByText('Feedback: Clarify step 2.')).toBeInTheDocument();
  });
});

describe('grading (T13, T14, X05)', () => {
  it('lists work to grade with its status (T13)', async () => {
    const api = installFakeApi(fakeUser('teacher'));
    const queue: GradingQueue = {
      classes: [{ id: STUDENT, name: 'BSIS 3-A', courseCode: 'IS 301' }],
      items: [
        {
          assessmentId: WORK,
          title: 'Normalization exercise',
          kind: 'assignment',
          sectionId: STUDENT,
          sectionName: 'BSIS 3-A',
          courseCode: 'IS 301',
          studentId: STUDENT,
          studentName: 'Learner 02',
          submittedAt: '2026-11-07T01:22:00.000Z',
          late: true,
          status: 'needs_review',
        },
        {
          assessmentId: WORK,
          title: 'Normalization exercise',
          kind: 'assignment',
          sectionId: STUDENT,
          sectionName: 'BSIS 3-A',
          courseCode: 'IS 301',
          studentId: SUB1,
          studentName: 'Learner 03',
          submittedAt: null,
          late: false,
          status: 'missing',
        },
      ],
    };
    api.on('GET /teacher/grading', { status: 200, body: queue });
    api.on('GET /teacher/grading?status=missing', {
      status: 200,
      body: { ...queue, items: queue.items.slice(1) },
    });
    renderApp('/teacher/grading');

    const late = await screen.findByRole('row', { name: /Learner 02/ });
    expect(within(late).getByText('Late')).toBeInTheDocument();
    expect(within(late).getByText('Needs review')).toBeInTheDocument();
    expect(
      within(late).getByRole('link', { name: 'Grade Learner 02, Normalization exercise' }),
    ).toHaveAttribute('href', `/teacher/grading/${WORK}/${STUDENT}`);
    expect(
      within(screen.getByRole('row', { name: /Learner 03/ })).getByText('No submission'),
    ).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'missing');
    await screen.findByRole('row', { name: /Learner 03/ });
    expect(screen.queryByRole('row', { name: /Learner 02/ })).not.toBeInTheDocument();
  });

  it('scores with the rubric, saves a draft and releases it (T14)', async () => {
    const api = installFakeApi(fakeUser('teacher'));
    api.on(`GET ${GRADE_PATH}`, { status: 200, body: view() });
    api.on(`PUT ${GRADE_PATH}`, { status: 200, body: view() });
    renderApp(`/teacher/grading/${WORK}/${STUDENT}`);

    const correctness = await screen.findByRole('group', { name: 'Correctness' });
    await userEvent.click(within(correctness).getByLabelText(/^Strong \/ 4/));
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Explanation' })).getByLabelText(/^Developing \/ 2/),
    );
    expect(screen.getByText('Total: 6 / 8')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Feedback'), 'Clarify step 2.');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft grade' }));

    expect(await screen.findByText('Draft grade saved.')).toBeInTheDocument();
    expect(api.bodyOf(`PUT ${GRADE_PATH}`)).toEqual({
      levels: { [C1]: level(0, 4), [C2]: level(1, 2) },
      feedback: 'Clarify step 2.',
      release: false,
      reason: '',
    });
  });

  it('releases the grade and feedback (T14)', async () => {
    const api = installFakeApi(fakeUser('teacher'));
    api.on(`GET ${GRADE_PATH}`, { status: 200, body: view() });
    api.on(`PUT ${GRADE_PATH}`, { status: 200, body: view() });
    renderApp(`/teacher/grading/${WORK}/${STUDENT}`);

    for (const name of ['Correctness', 'Explanation']) {
      await userEvent.click(
        within(await screen.findByRole('group', { name })).getByLabelText(/^Strong \/ 4/),
      );
    }
    await userEvent.click(screen.getByRole('button', { name: 'Release grade and feedback' }));

    expect(await screen.findByText('Grade and feedback released.')).toBeInTheDocument();
    expect(api.bodyOf(`PUT ${GRADE_PATH}`)).toMatchObject({
      levels: { [C1]: level(0, 4), [C2]: level(1, 4) },
      release: true,
    });
  });

  it('asks for a reason before changing a released grade (X05)', async () => {
    const api = installFakeApi(fakeUser('teacher'));
    api.on(`GET ${GRADE_PATH}`, {
      status: 200,
      body: view({
        submissions: [file({ id: SUB2, number: 2 }), file()],
        grade: {
          status: 'released',
          score: 6,
          feedback: 'Clarify step 2.',
          levels: { [C1]: level(0, 4), [C2]: level(1, 2) },
          submissionId: SUB1,
          gradedAt: '2026-11-08T01:00:00.000Z',
          releasedAt: '2026-11-08T01:00:00.000Z',
        },
      }),
    });
    api.on(`PUT ${GRADE_PATH}`, { status: 200, body: view() });
    renderApp(`/teacher/grading/${WORK}/${STUDENT}`);

    expect(await screen.findByText(/submitted a newer version/)).toBeInTheDocument();
    expect(screen.getByText('Total: 6 / 8')).toBeInTheDocument();
    expect(screen.getByText('Submission history')).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Explanation' })).getByLabelText(/^Strong \/ 4/),
    );
    await userEvent.type(
      screen.getByLabelText('Reason for changing a released grade'),
      'Regraded the second version',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm grade change' }));

    expect(await screen.findByText('Grade changed and recorded.')).toBeInTheDocument();
    expect(api.bodyOf(`PUT ${GRADE_PATH}`)).toMatchObject({
      levels: { [C1]: level(0, 4), [C2]: level(1, 4) },
      reason: 'Regraded the second version',
    });
  });
});
