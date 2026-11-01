import type { SectionDetails, SectionListResponse, SectionSummary, Term } from '@lead/schema';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi, type FakeApi } from '../../../test/fake-api';
import { renderApp } from '../../../test/render-app';

const CURRENT: Term = {
  id: '11111111-1111-4111-8111-111111111111',
  schoolYear: '2026-2027',
  semester: 'first',
  startsOn: '2026-08-10',
  endsOn: '2026-12-18',
  current: true,
};
const NEXT: Term = {
  ...CURRENT,
  id: '22222222-2222-4222-8222-222222222222',
  semester: 'second',
  current: false,
};

const SECTION_ID = '33333333-3333-4333-8333-333333333333';
const TEACHER = {
  id: '44444444-4444-4444-8444-444444444444',
  displayName: 'Maria Santos',
  email: 'teacher01@lead.test',
};
const STUDENT = {
  id: '55555555-5555-4555-8555-555555555555',
  displayName: 'Juan Dela Cruz',
  email: 'learner01@lead.test',
};

function summary(overrides: Partial<SectionSummary> = {}): SectionSummary {
  return {
    id: SECTION_ID,
    name: 'BSIS 3-A',
    capacity: 40,
    enrolled: 1,
    course: {
      id: '66666666-6666-4666-8666-666666666666',
      code: 'IS 301',
      title: 'Database Systems',
      units: 3,
    },
    term: { id: CURRENT.id, schoolYear: CURRENT.schoolYear, semester: 'first', current: true },
    teachers: [TEACHER],
    ...overrides,
  };
}

function details(overrides: Partial<SectionDetails> = {}): SectionDetails {
  return {
    ...summary(),
    roster: [
      { ...STUDENT, status: 'enrolled', enrolledAt: '2026-08-01T00:00:00.000Z', droppedAt: null },
    ],
    ...overrides,
  };
}

function list(
  items: SectionSummary[],
  termId: string | null = CURRENT.id,
): { status: number; body: SectionListResponse } {
  return { status: 200, body: { items, total: items.length, page: 1, pageSize: 25, termId } };
}

function adminApi(): FakeApi {
  const api = installFakeApi(fakeUser('admin'));
  api.on('GET /admin/terms', { status: 200, body: [CURRENT, NEXT] });
  api.on('GET /admin/sections?page=1', list([summary()]));
  api.on(`GET /admin/sections/${SECTION_ID}`, { status: 200, body: details() });
  return api;
}

describe('section management (A07)', () => {
  it('lists the current term’s sections with teachers and seats', async () => {
    adminApi();
    renderApp('/admin/sections');

    const row = await screen.findByRole('row', { name: /IS 301/ });
    expect(within(row).getByText('Maria Santos')).toBeInTheDocument();
    expect(
      within(row).getByRole('meter', { name: 'Seats taken, IS 301 BSIS 3-A' }),
    ).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByLabelText('Term')).toHaveValue(CURRENT.id);
  });

  it('switches terms', async () => {
    const api = adminApi();
    api.on(`GET /admin/sections?term=${NEXT.id}&page=1`, list([], NEXT.id));
    renderApp('/admin/sections');

    await screen.findByRole('row', { name: /IS 301/ });
    await userEvent.selectOptions(screen.getByLabelText('Term'), NEXT.id);

    expect(await screen.findByText(/No sections in this term yet/)).toBeInTheDocument();
  });

  it('says when there is no current term', async () => {
    const api = adminApi();
    api.on('GET /admin/terms', { status: 200, body: [] });
    api.on('GET /admin/sections?page=1', list([], null));
    renderApp('/admin/sections');

    expect(await screen.findByText(/No current term/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add section' })).toBeDisabled();
  });

  it('adds a section in the chosen term', async () => {
    const api = adminApi();
    api.on('POST /admin/sections', () => {
      api.on(
        'GET /admin/sections?page=1',
        list([summary(), summary({ id: NEXT.id, name: 'BSIS 3-B', enrolled: 0 })]),
      );
      return { status: 201, body: summary({ name: 'BSIS 3-B' }) };
    });
    renderApp('/admin/sections');

    await screen.findByRole('row', { name: /BSIS 3-A/ });
    await userEvent.click(screen.getByRole('button', { name: 'Add section' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a section' });
    await userEvent.type(within(dialog).getByLabelText('Course code'), 'IS 301');
    await userEvent.type(within(dialog).getByLabelText('Section name'), 'BSIS 3-B');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add section' }));

    expect(await screen.findByRole('link', { name: 'IS 301 BSIS 3-B' })).toBeInTheDocument();
    expect(api.bodyOf('POST /admin/sections')).toEqual({
      courseCode: 'IS 301',
      termId: CURRENT.id,
      name: 'BSIS 3-B',
      capacity: '40',
    });
  });

  it('shows a section with its teachers and class list', async () => {
    adminApi();
    renderApp(`/admin/sections/${SECTION_ID}`);

    expect(await screen.findByRole('heading', { name: 'IS 301 · BSIS 3-A' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Teachers' })).getByText('Maria Santos'),
    ).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Juan Dela Cruz/ })).toHaveTextContent('Enrolled');
  });

  it('enrolls students and explains the ones it skipped', async () => {
    const api = adminApi();
    api.on(`POST /admin/sections/${SECTION_ID}/enrollments`, {
      status: 200,
      body: {
        added: ['learner02@lead.test'],
        skipped: [{ email: 'nobody@lead.test', reason: 'not_found' }],
      },
    });
    renderApp(`/admin/sections/${SECTION_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Enroll students' }));
    const dialog = await screen.findByRole('dialog', { name: 'Enroll students' });
    await userEvent.type(
      within(dialog).getByLabelText('Student emails'),
      'learner02@lead.test, nobody@lead.test',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enroll' }));

    expect(
      await screen.findByText(
        /Enrolled 1 student\. nobody@lead\.test: no account uses this email\./,
      ),
    ).toBeInTheDocument();
    expect(api.bodyOf(`POST /admin/sections/${SECTION_ID}/enrollments`)).toEqual({
      emails: 'learner02@lead.test, nobody@lead.test',
    });
  });

  it('drops a student with a reason', async () => {
    const api = adminApi();
    api.on(`POST /admin/sections/${SECTION_ID}/enrollments/${STUDENT.id}/drop`, () => {
      api.on(`GET /admin/sections/${SECTION_ID}`, {
        status: 200,
        body: details({
          enrolled: 0,
          roster: [
            {
              ...STUDENT,
              status: 'dropped',
              enrolledAt: '2026-08-01T00:00:00.000Z',
              droppedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        }),
      });
      return { status: 204 };
    });
    renderApp(`/admin/sections/${SECTION_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Drop Juan Dela Cruz' }));
    const dialog = await screen.findByRole('dialog', { name: 'Drop Juan Dela Cruz' });
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Shifted to BSTM');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Drop student' }));

    expect(await screen.findByText('Juan Dela Cruz was dropped.')).toBeInTheDocument();
    expect(await screen.findByRole('row', { name: /Juan Dela Cruz/ })).toHaveTextContent('Dropped');
    expect(api.bodyOf(`POST /admin/sections/${SECTION_ID}/enrollments/${STUDENT.id}/drop`)).toEqual(
      {
        reason: 'Shifted to BSTM',
      },
    );
  });

  it('assigns a teacher and shows the server’s refusal', async () => {
    const api = adminApi();
    api.on(`POST /admin/sections/${SECTION_ID}/teachers`, {
      status: 409,
      body: { message: 'Maria Santos already teaches this section.' },
    });
    renderApp(`/admin/sections/${SECTION_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Assign teacher' }));
    const dialog = await screen.findByRole('dialog', { name: 'Assign a teacher' });
    await userEvent.type(within(dialog).getByLabelText("Teacher's email"), TEACHER.email);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already teaches');
  });

  it('adding a section to another term switches the list to that term', async () => {
    const api = adminApi();
    api.on('POST /admin/sections', { status: 201, body: summary({ name: 'BSIS 3-C' }) });
    api.on(
      `GET /admin/sections?term=${NEXT.id}&page=1`,
      list([summary({ name: 'BSIS 3-C' })], NEXT.id),
    );
    renderApp('/admin/sections');

    await screen.findByRole('row', { name: /BSIS 3-A/ });
    await userEvent.click(screen.getByRole('button', { name: 'Add section' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a section' });
    await userEvent.type(within(dialog).getByLabelText('Course code'), 'IS 301');
    await userEvent.selectOptions(within(dialog).getByLabelText('Term'), NEXT.id);
    await userEvent.type(within(dialog).getByLabelText('Section name'), 'BSIS 3-C');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add section' }));

    expect(await screen.findByRole('link', { name: 'IS 301 BSIS 3-C' })).toBeInTheDocument();
    expect(screen.getByLabelText('Term')).toHaveValue(NEXT.id);
  });

  it('edits the name and capacity, not below the students enrolled', async () => {
    const api = adminApi();
    api.on(`PATCH /admin/sections/${SECTION_ID}`, {
      status: 200,
      body: summary({ name: 'BSIS 3-Z', capacity: 35 }),
    });
    renderApp(`/admin/sections/${SECTION_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit section' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit BSIS 3-A' });
    const capacity = within(dialog).getByLabelText('Capacity');
    expect(capacity).toHaveAttribute('min', '1');
    await userEvent.clear(within(dialog).getByLabelText('Section name'));
    await userEvent.type(within(dialog).getByLabelText('Section name'), 'BSIS 3-Z');
    await userEvent.clear(capacity);
    await userEvent.type(capacity, '35');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Section updated.')).toBeInTheDocument();
    expect(api.bodyOf(`PATCH /admin/sections/${SECTION_ID}`)).toEqual({
      name: 'BSIS 3-Z',
      capacity: '35',
    });
  });

  it('removes a teacher and announces it', async () => {
    const api = adminApi();
    api.on(`POST /admin/sections/${SECTION_ID}/teachers/${TEACHER.id}/remove`, () => {
      api.on(`GET /admin/sections/${SECTION_ID}`, { status: 200, body: details({ teachers: [] }) });
      return { status: 200, body: details({ teachers: [] }) };
    });
    renderApp(`/admin/sections/${SECTION_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Remove Maria Santos' }));

    const notice = await screen.findByText('Maria Santos no longer teaches this section.');
    expect(notice.closest('[role="status"]')).toHaveFocus();
    expect(await screen.findByText('No teacher assigned yet.')).toBeInTheDocument();
  });

  it('offers no Drop for a student already dropped', async () => {
    const api = adminApi();
    api.on(`GET /admin/sections/${SECTION_ID}`, {
      status: 200,
      body: details({
        enrolled: 0,
        roster: [
          {
            ...STUDENT,
            status: 'dropped',
            enrolledAt: '2026-08-01T00:00:00.000Z',
            droppedAt: '2026-09-01T00:00:00.000Z',
          },
        ],
      }),
    });
    renderApp(`/admin/sections/${SECTION_ID}`);

    expect(await screen.findByRole('row', { name: /Juan Dela Cruz/ })).toHaveTextContent('Dropped');
    expect(screen.queryByRole('button', { name: /^Drop/ })).not.toBeInTheDocument();
  });

  it('keeps teachers out of section management', async () => {
    installFakeApi(fakeUser('teacher'));
    renderApp(`/admin/sections/${SECTION_ID}`);

    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeInTheDocument();
  });
});
