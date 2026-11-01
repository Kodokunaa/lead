import type { SectionDetails, SectionSummary, StudentClass } from '@lead/schema';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi } from '../../test/fake-api';
import { renderApp } from '../../test/render-app';

const SECTION_ID = '33333333-3333-4333-8333-333333333333';
const TEACHER = {
  id: '44444444-4444-4444-8444-444444444444',
  displayName: 'Maria Santos',
  email: 'teacher01@lead.test',
};

function summary(overrides: Partial<SectionSummary> = {}): SectionSummary {
  return {
    id: SECTION_ID,
    name: 'BSIS 3-A',
    capacity: 40,
    enrolled: 2,
    course: {
      id: '66666666-6666-4666-8666-666666666666',
      code: 'IS 301',
      title: 'Database Systems',
      units: 3,
    },
    term: {
      id: '11111111-1111-4111-8111-111111111111',
      schoolYear: '2026-2027',
      semester: 'first',
      current: true,
    },
    teachers: [TEACHER],
    ...overrides,
  };
}

describe('teacher classes (T02)', () => {
  it('shows the teacher’s classes as cards and opens the class list', async () => {
    const api = installFakeApi(fakeUser('teacher'));
    api.on('GET /teacher/classes', { status: 200, body: [summary()] });
    const roster: SectionDetails['roster'] = [
      {
        id: '55555555-5555-4555-8555-555555555555',
        displayName: 'Juan Dela Cruz',
        email: 'learner01@lead.test',
        status: 'enrolled',
        enrolledAt: '2026-08-01T00:00:00.000Z',
        droppedAt: null,
      },
      {
        id: '77777777-7777-4777-8777-777777777777',
        displayName: 'Ana Reyes',
        email: 'learner02@lead.test',
        status: 'dropped',
        enrolledAt: '2026-08-01T00:00:00.000Z',
        droppedAt: '2026-09-01T00:00:00.000Z',
      },
    ];
    api.on(`GET /teacher/classes/${SECTION_ID}`, {
      status: 200,
      body: { ...summary({ enrolled: 1 }), roster },
    });
    renderApp('/teacher/classes');

    const cards = await screen.findByRole('list', { name: 'Classes' });
    expect(within(cards).getByText('2 students')).toBeInTheDocument();
    await userEvent.click(
      within(cards).getByRole('link', { name: 'IS 301 Database Systems, BSIS 3-A' }),
    );

    expect(await screen.findByRole('heading', { name: 'IS 301 · BSIS 3-A' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Juan Dela Cruz/ })).toBeInTheDocument();
    // Teachers see who is in the class now, not who left.
    expect(screen.queryByText('Ana Reyes')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Drop/ })).not.toBeInTheDocument();
  });

  it('says when the teacher has no classes', async () => {
    const api = installFakeApi(fakeUser('teacher'));
    api.on('GET /teacher/classes', { status: 200, body: [] });
    renderApp('/teacher/classes');

    expect(await screen.findByText(/no classes this term/)).toBeInTheDocument();
  });

  it('shows an error for a class the teacher does not teach', async () => {
    const api = installFakeApi(fakeUser('teacher'));
    api.on(`GET /teacher/classes/${SECTION_ID}`, {
      status: 404,
      body: { message: 'Class not found.' },
    });
    renderApp(`/teacher/classes/${SECTION_ID}`);

    expect(await screen.findByText('Class not found.')).toBeInTheDocument();
  });
});

describe('student courses (S02)', () => {
  it('groups classes by term, current term first', async () => {
    const api = installFakeApi(fakeUser('student'));
    const current: StudentClass = {
      ...withoutSeats(summary()),
      enrolledAt: '2026-08-01T00:00:00.000Z',
    };
    const past: StudentClass = {
      ...withoutSeats(
        summary({
          id: '88888888-8888-4888-8888-888888888888',
          course: {
            id: '99999999-9999-4999-8999-999999999999',
            code: 'IS 201',
            title: 'Programming 2',
            units: 3,
          },
          term: {
            id: '22222222-2222-4222-8222-222222222222',
            schoolYear: '2025-2026',
            semester: 'second',
            current: false,
          },
        }),
      ),
      enrolledAt: '2026-01-10T00:00:00.000Z',
    };
    api.on('GET /student/classes', { status: 200, body: [past, current] });
    renderApp('/student/courses');

    const groups = await screen.findAllByRole('region', { name: /Semester/ });
    expect(
      groups.map((group) => within(group).getByRole('heading', { level: 2 }).textContent),
    ).toEqual(['First Semester 2026-2027current term', 'Second Semester 2025-2026']);
    // Course titles sit one level below their term.
    expect(
      within(groups[0]!).getByRole('heading', { level: 3, name: 'Database Systems' }),
    ).toBeInTheDocument();
    expect(
      within(groups[1]!).getByRole('heading', { level: 3, name: 'Programming 2' }),
    ).toBeInTheDocument();
  });

  it('says when the student is not enrolled anywhere', async () => {
    const api = installFakeApi(fakeUser('student'));
    api.on('GET /student/classes', { status: 200, body: [] });
    renderApp('/student/courses');

    expect(await screen.findByText(/not enrolled in any class yet/)).toBeInTheDocument();
  });
});

function withoutSeats(section: SectionSummary): Omit<StudentClass, 'enrolledAt'> {
  const { id, name, course, term, teachers } = section;
  return { id, name, course, term, teachers };
}
