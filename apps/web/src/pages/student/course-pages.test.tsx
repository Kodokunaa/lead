import type {
  StudentClass,
  StudentClassOverview,
  StudentLesson,
  StudentResource,
  StudentResourceView,
} from '@lead/schema';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeUser, installFakeApi, type FakeApi } from '../../test/fake-api';
import { renderApp } from '../../test/render-app';

const SECTION_ID = '11111111-1111-4111-8111-111111111111';
const LESSON_1 = '22222222-2222-4222-8222-222222222222';
const LESSON_2 = '33333333-3333-4333-8333-333333333333';
const RESOURCE_ID = '44444444-4444-4444-8444-444444444444';
const O1 = '55555555-5555-4555-8555-555555555555';
const MODULE_ID = '66666666-6666-4666-8666-666666666666';
const BASE = `/student/classes/${SECTION_ID}`;

const section: StudentClass = {
  id: SECTION_ID,
  name: 'BSIS 3-A',
  course: {
    id: '77777777-7777-4777-8777-777777777777',
    code: 'IS 301',
    title: 'Database Systems',
    units: 3,
  },
  term: {
    id: '88888888-8888-4888-8888-888888888888',
    schoolYear: '2026-2027',
    semester: 'first',
    current: true,
  },
  teachers: [
    {
      id: '99999999-9999-4999-8999-999999999999',
      displayName: 'Maria Santos',
      email: 't@lead.test',
    },
  ],
  enrolledAt: '2026-08-01T00:00:00.000Z',
};

const resource: StudentResource = {
  id: RESOURCE_ID,
  title: 'Normalization guide',
  module: { id: MODULE_ID, title: 'Normalization' },
  objectives: [{ id: O1, code: 'O1' }],
  version: {
    id: '12121212-1212-4212-8212-121212121212',
    number: 1,
    kind: 'file',
    fileName: 'guide.pdf',
    contentType: 'application/pdf',
    sizeBytes: 250_000,
    url: null,
  },
};

const lessons = [
  { id: LESSON_1, title: 'Normal forms', position: 1, objectiveId: O1 },
  { id: LESSON_2, title: 'Worked examples', position: 2, objectiveId: O1 },
];

function overview(): StudentClassOverview {
  return {
    section,
    objectives: [{ id: O1, code: 'O1', description: 'Normalize a relation to 3NF' }],
    modules: [
      {
        id: MODULE_ID,
        position: 1,
        title: 'Normalization',
        description: 'From 1NF to BCNF.',
        objectiveIds: [O1],
        requiresPrevious: true,
        masteryThreshold: 70,
        lessons,
      },
    ],
    resources: [resource],
    calendar: {
      term: { ...section.term, startsOn: '2000-01-01', endsOn: '2999-12-31' },
      gradingPeriods: [],
      events: [
        {
          id: '13131313-1313-4313-8313-131313131313',
          title: 'Quiz 3',
          kind: 'assessment_period',
          startsOn: '2999-03-01',
          endsOn: null,
          courses: [],
        },
      ],
    },
  };
}

function lesson(): StudentLesson {
  return {
    id: LESSON_1,
    title: 'Normal forms',
    body: 'First normal form.\nNo repeating groups. <b>not bold</b>',
    objective: { id: O1, code: 'O1', description: 'Normalize a relation to 3NF' },
    course: { code: 'IS 301', title: 'Database Systems' },
    module: { id: MODULE_ID, position: 1, title: 'Normalization', lessons },
    resources: [resource],
  };
}

function studentApi(): FakeApi {
  const api = installFakeApi(fakeUser('student'));
  api.on('GET /student/classes', { status: 200, body: [section] });
  api.on(`GET ${BASE}`, { status: 200, body: overview() });
  api.on(`GET ${BASE}/lessons/${LESSON_1}`, { status: 200, body: lesson() });
  const view: StudentResourceView = {
    ...resource,
    course: { code: 'IS 301', title: 'Database Systems' },
  };
  api.on(`GET ${BASE}/resources/${RESOURCE_ID}`, { status: 200, body: view });
  return api;
}

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x') }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('student course pages (S03, S05, S06)', () => {
  it('opens a course from My Courses and shows its outline, references and upcoming work', async () => {
    studentApi();
    renderApp('/student/courses');

    await userEvent.click(await screen.findByRole('link', { name: /IS 301 Database Systems/ }));

    expect(
      await screen.findByRole('heading', { name: 'IS 301 · Database Systems' }),
    ).toBeInTheDocument();
    const modules = screen.getByRole('list', { name: /Learning modules/ });
    expect(within(modules).getByText('Module 1: Normalization')).toBeInTheDocument();
    expect(within(modules).getByText(/Finish the previous module first/)).toHaveTextContent(
      'Mastery means scoring 70% or more.',
    );
    expect(within(modules).getByRole('link', { name: '1. Normal forms' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: /approved references/ })).getByRole('link', {
        name: 'Normalization guide',
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Upcoming events' })).getByText('Quiz 3'),
    ).toBeInTheDocument();
  });

  it('shows a lesson as plain text with its objective, outline and next lesson', async () => {
    studentApi();
    renderApp(`/student/courses/${SECTION_ID}/lessons/${LESSON_1}`);

    expect(
      await screen.findByRole('heading', { name: 'Lesson: Normal forms' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Learning objective O1:/)).toBeInTheDocument();
    // Markup in a lesson is shown as typed, never interpreted.
    expect(screen.getByText(/<b>not bold<\/b>/)).toBeInTheDocument();
    expect(screen.getByText(/<b>not bold<\/b>/).querySelector('b')).toBeNull();
    expect(screen.getByText('1. Normal forms')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Lesson: Normal forms' })).toHaveFocus();
    expect(screen.queryByRole('link', { name: /Previous lesson/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next lesson: Worked examples' })).toBeInTheDocument();
  });

  it('shows an approved resource and downloads it', async () => {
    const api = studentApi();
    api.on(`GET ${BASE}/resources/${RESOURCE_ID}/file`, { status: 200, body: {} });
    renderApp(`/student/courses/${SECTION_ID}/resources/${RESOURCE_ID}`);

    expect(await screen.findByRole('heading', { name: 'Normalization guide' })).toBeInTheDocument();
    expect(screen.getByText('Available to enrolled learners.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await vi.waitFor(() =>
      expect(api.calls).toContain(`GET ${BASE}/resources/${RESOURCE_ID}/file`),
    );
  });

  it('shows the server’s answer for a class the student is not in', async () => {
    const api = installFakeApi(fakeUser('student'));
    api.on(`GET ${BASE}`, { status: 404, body: { message: 'No such class.' } });
    renderApp(`/student/courses/${SECTION_ID}`);

    expect(await screen.findByText('No such class.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Course' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Course' })).getByRole('link', {
        name: 'My Courses',
      }),
    ).toBeInTheDocument();
  });

  it('is for students only', async () => {
    installFakeApi(fakeUser('teacher'));
    renderApp(`/student/courses/${SECTION_ID}`);

    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeInTheDocument();
  });
});
