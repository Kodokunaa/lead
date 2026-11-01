import type { Course, CourseListResponse, Program, Term } from '@lead/schema';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi, type FakeApi, type FakeResponse } from '../../../test/fake-api';
import { renderApp } from '../../../test/render-app';

const BSIS: Program = {
  id: '55555555-5555-4555-8555-555555555555',
  code: 'BSIS',
  name: 'Bachelor of Science in Information Systems',
  active: true,
};
const BPA: Program = {
  id: '66666666-6666-4666-8666-666666666666',
  code: 'BPA',
  name: 'Bachelor of Public Administration',
  active: false,
};

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    code: 'IS 301',
    title: 'Database Systems',
    description: '',
    units: 3,
    programId: BSIS.id,
    programCode: 'BSIS',
    archived: false,
    ...overrides,
  };
}

function page(items: Course[]): { status: number; body: CourseListResponse } {
  return { status: 200, body: { items, total: items.length, page: 1, pageSize: 25 } };
}

function adminApi(): FakeApi {
  const api = installFakeApi(fakeUser('admin'));
  api.on('GET /admin/programs', { status: 200, body: [BPA, BSIS] });
  api.on('GET /admin/courses?page=1', page([course()]));
  return api;
}

describe('course management (A05)', () => {
  it('lists courses with their program', async () => {
    adminApi();
    renderApp('/admin/courses');

    const row = await screen.findByRole('row', { name: /IS 301/ });
    expect(within(row).getByText('Database Systems')).toBeInTheDocument();
    expect(within(row).getByText('BSIS')).toBeInTheDocument();
  });

  it('adds a course, offering only programs that are still offered', async () => {
    const api = adminApi();
    api.on('POST /admin/courses', () => {
      api.on(
        'GET /admin/courses?page=1',
        page([course(), course({ id: BSIS.id, code: 'IS 302' })]),
      );
      return { status: 201, body: course({ code: 'IS 302' }) };
    });
    renderApp('/admin/courses');

    await userEvent.click(await screen.findByRole('button', { name: 'Add course' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a course' });
    const programOptions = within(within(dialog).getByLabelText('Program'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(programOptions).toEqual([
      'General education (all programs)',
      'BSIS – Bachelor of Science in Information Systems',
    ]);

    await userEvent.type(within(dialog).getByLabelText('Course code'), 'is 302');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Systems Analysis');
    await userEvent.selectOptions(within(dialog).getByLabelText('Program'), BSIS.id);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add course' }));

    expect(await screen.findByRole('row', { name: /IS 302/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.bodyOf('POST /admin/courses')).toEqual({
      code: 'is 302',
      title: 'Systems Analysis',
      units: '3',
      description: '',
      programId: BSIS.id,
    });
  });

  it('keeps the dialog open with the error when the code is taken', async () => {
    const api = adminApi();
    api.on('POST /admin/courses', {
      status: 409,
      body: { message: 'A course with code IS 301 already exists.' },
    });
    renderApp('/admin/courses');

    await userEvent.click(await screen.findByRole('button', { name: 'Add course' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a course' });
    await userEvent.type(within(dialog).getByLabelText('Course code'), 'IS 301');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Databases');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add course' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already exists');
  });

  it('archives with a reason, closes the dialog, reloads and announces it', async () => {
    const api = adminApi();
    api.on(`POST /admin/courses/${course().id}/archive`, () => {
      api.on('GET /admin/courses?page=1', page([]));
      return { status: 200, body: course({ archived: true }) };
    });
    renderApp('/admin/courses');

    await userEvent.click(await screen.findByRole('button', { name: 'Archive IS 301' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive IS 301' });
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Replaced by IS 310');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive course' }));

    // Focus lands on the announcement, since the row (and its button) are gone.
    const notice = await screen.findByText('IS 301 archived.');
    expect(notice.closest('[role="status"]')).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /IS 301/ })).not.toBeInTheDocument();
    expect(api.bodyOf(`POST /admin/courses/${course().id}/archive`)).toEqual({
      reason: 'Replaced by IS 310',
    });
  });

  it('edits a course with its current values filled in', async () => {
    const api = adminApi();
    api.on(`PATCH /admin/courses/${course().id}`, {
      status: 200,
      body: course({ title: 'Advanced Databases' }),
    });
    renderApp('/admin/courses');

    await userEvent.click(await screen.findByRole('button', { name: 'Edit IS 301' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit IS 301' });
    expect(within(dialog).getByLabelText('Course code')).toHaveValue('IS 301');
    expect(within(dialog).getByLabelText('Program')).toHaveValue(BSIS.id);

    const title = within(dialog).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Advanced Databases');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.bodyOf(`PATCH /admin/courses/${course().id}`)).toMatchObject({
      title: 'Advanced Databases',
      programId: BSIS.id,
    });
  });

  it('keeps Add and Edit off until the program list has loaded', async () => {
    const api = adminApi();
    let answerPrograms: (response: FakeResponse) => void = () => undefined;
    api.on(
      'GET /admin/programs',
      () =>
        new Promise<FakeResponse>((resolve) => {
          answerPrograms = resolve;
        }),
    );
    renderApp('/admin/courses');

    expect(await screen.findByRole('button', { name: 'Edit IS 301' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add course' })).toBeDisabled();

    answerPrograms({ status: 200, body: [BSIS] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit IS 301' })).toBeEnabled());
  });

  it('restores an archived course, and says so when it cannot', async () => {
    const api = adminApi();
    const archived = course({ archived: true });
    api.on('GET /admin/courses?archived=true&page=1', page([archived]));
    api.on(`POST /admin/courses/${archived.id}/restore`, {
      status: 409,
      body: { message: 'The course is not archived.' },
    });
    renderApp('/admin/courses');

    await userEvent.click(await screen.findByLabelText('Show archived courses'));
    await userEvent.click(await screen.findByRole('button', { name: 'Restore IS 301' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The course is not archived.');

    api.on(`POST /admin/courses/${archived.id}/restore`, { status: 200, body: course() });
    await userEvent.click(screen.getByRole('button', { name: 'Restore IS 301' }));
    expect(await screen.findByText('IS 301 restored.')).toBeInTheDocument();
  });

  it('steps back a page when the last one becomes empty', async () => {
    const api = adminApi();
    const many = Array.from({ length: 25 }, (_, index) =>
      course({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        code: `IS ${300 + index}`,
      }),
    );
    api.on('GET /admin/courses?page=1', {
      status: 200,
      body: { items: many, total: 26, page: 1, pageSize: 25 },
    });
    api.on('GET /admin/courses?page=2', {
      status: 200,
      body: { items: [], total: 25, page: 2, pageSize: 25 },
    });
    renderApp('/admin/courses');

    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(api.calls.filter((call) => call === 'GET /admin/courses?page=1')).toHaveLength(2),
    );
    expect(await screen.findByRole('row', { name: /IS 300/ })).toBeInTheDocument();
  });

  it('filters by program', async () => {
    const api = adminApi();
    api.on(`GET /admin/courses?program=${BSIS.id}&page=1`, page([course()]));
    renderApp('/admin/courses');

    await screen.findByRole('row', { name: /IS 301/ });
    await userEvent.selectOptions(screen.getByLabelText('Program'), BSIS.id);

    await screen.findByRole('row', { name: /IS 301/ });
    expect(api.calls).toContain(`GET /admin/courses?program=${BSIS.id}&page=1`);
  });
});

describe('programs and terms tabs', () => {
  it('stops offering a program', async () => {
    const api = adminApi();
    api.on(`PATCH /admin/programs/${BSIS.id}`, {
      status: 200,
      body: { ...BSIS, active: false },
    });
    renderApp('/admin/courses');

    await userEvent.click(await screen.findByRole('tab', { name: 'Programs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop offering BSIS' }));

    expect(api.bodyOf(`PATCH /admin/programs/${BSIS.id}`)).toEqual({ active: false });
  });

  it('shows an error when a term cannot be made current', async () => {
    const api = adminApi();
    const term: Term = {
      id: '99999999-9999-4999-8999-999999999999',
      schoolYear: '2026-2027',
      semester: 'second',
      startsOn: '2027-01-11',
      endsOn: '2027-05-21',
      current: false,
    };
    api.on('GET /admin/terms', { status: 200, body: [term] });
    api.on(`POST /admin/terms/${term.id}/make-current`, {
      status: 404,
      body: { message: 'No such term.' },
    });
    renderApp('/admin/courses');

    await userEvent.click(await screen.findByRole('tab', { name: 'Terms' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Make Second Semester 2026-2027 current' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('No such term.');
  });

  it('shows the current term and makes another current', async () => {
    const api = adminApi();
    const terms: Term[] = [
      {
        id: '88888888-8888-4888-8888-888888888888',
        schoolYear: '2026-2027',
        semester: 'first',
        startsOn: '2026-08-10',
        endsOn: '2026-12-18',
        current: true,
      },
      {
        id: '99999999-9999-4999-8999-999999999999',
        schoolYear: '2026-2027',
        semester: 'second',
        startsOn: '2027-01-11',
        endsOn: '2027-05-21',
        current: false,
      },
    ];
    api.on('GET /admin/terms', { status: 200, body: terms });
    api.on(`POST /admin/terms/${terms[1]?.id}/make-current`, { status: 200, body: terms[1] });
    renderApp('/admin/courses');

    await userEvent.click(await screen.findByRole('tab', { name: 'Terms' }));
    const current = await screen.findByRole('row', { name: /First Semester 2026-2027/ });
    expect(within(current).getByText('Current')).toBeInTheDocument();
    expect(within(current).getByText('Aug 10, 2026 – Dec 18, 2026')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Make Second Semester 2026-2027 current' }),
    );
    expect(api.calls).toContain(`POST /admin/terms/${terms[1]?.id}/make-current`);
  });
});
