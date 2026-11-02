import type { Course, CourseRecord, Program } from '@lead/schema';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi, type FakeApi } from '../../../test/fake-api';
import { renderApp } from '../../../test/render-app';

const BSIS: Program = {
  id: '55555555-5555-4555-8555-555555555555',
  code: 'BSIS',
  name: 'Bachelor of Science in Information Systems',
  active: true,
};
const COURSE_ID = '77777777-7777-4777-8777-777777777777';
const SECTION_ID = '88888888-8888-4888-8888-888888888888';

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: COURSE_ID,
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

function record(overrides: Partial<CourseRecord> = {}): CourseRecord {
  return {
    course: course(),
    offerings: [
      {
        term: {
          id: '99999999-9999-4999-8999-999999999999',
          schoolYear: '2026-2027',
          semester: 'first',
          current: true,
        },
        sections: [
          {
            id: SECTION_ID,
            name: 'BSIS 3-A',
            capacity: 40,
            enrolled: 12,
            teachers: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'Ana Reyes' }],
          },
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            name: 'BSIS 3-B',
            capacity: 40,
            enrolled: 0,
            teachers: [],
          },
        ],
      },
    ],
    content: { objectives: 3, modules: 2, publishedModules: 1, lessons: 5, publishedLessons: 4 },
    resources: { total: 4, approved: 2, pending: 1 },
    ...overrides,
  };
}

const RECORD = `GET /admin/courses/${COURSE_ID}/record`;

function adminApi(answer: CourseRecord = record()): FakeApi {
  const api = installFakeApi(fakeUser('admin'));
  api.on('GET /admin/programs', { status: 200, body: [BSIS] });
  api.on(RECORD, { status: 200, body: answer });
  return api;
}

describe('course offering and curriculum record (A06)', () => {
  it('shows the course, its content and where it is taught', async () => {
    adminApi();
    renderApp(`/admin/courses/${COURSE_ID}`);

    expect(
      await screen.findByRole('heading', { name: 'Course offering and curriculum record' }),
    ).toHaveFocus();
    expect(screen.getByText('IS 301 – Database Systems')).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 modules published/)).toBeInTheDocument();
    expect(screen.getByText(/2 approved · 1 waiting for review · 4 in all/)).toBeInTheDocument();

    const table = screen.getByRole('table', { name: /2026-2027 \(current\)$/ });
    const first = within(table).getByRole('row', { name: /BSIS 3-A/ });
    expect(within(first).getByText('Ana Reyes')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'BSIS 3-A' })).toHaveAttribute(
      'href',
      `/admin/sections/${SECTION_ID}`,
    );
    expect(
      within(within(table).getByRole('row', { name: /BSIS 3-B/ })).getByText('No teacher yet'),
    ).toBeInTheDocument();
  });

  it('saves the course details and shows the saved values', async () => {
    const api = adminApi();
    api.on(`PATCH /admin/courses/${COURSE_ID}`, () => {
      api.on(RECORD, {
        status: 200,
        body: record({ course: course({ title: 'Advanced Databases' }) }),
      });
      return { status: 200, body: course({ title: 'Advanced Databases' }) };
    });
    renderApp(`/admin/courses/${COURSE_ID}`);

    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Advanced Databases');
    await userEvent.click(screen.getByRole('button', { name: 'Save course' }));

    expect((await screen.findByText('Changes saved.')).closest('[role="status"]')).toHaveFocus();
    expect(await screen.findByText('IS 301 – Advanced Databases')).toBeInTheDocument();
    expect(api.bodyOf(`PATCH /admin/courses/${COURSE_ID}`)).toMatchObject({
      title: 'Advanced Databases',
      programId: BSIS.id,
    });
  });

  it('warns that sections this term keep running when the course is archived', async () => {
    const api = adminApi();
    api.on(`POST /admin/courses/${COURSE_ID}/archive`, () => {
      api.on(RECORD, { status: 200, body: record({ course: course({ archived: true }) }) });
      return { status: 200, body: course({ archived: true }) };
    });
    renderApp(`/admin/courses/${COURSE_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Archive IS 301' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive IS 301' });
    expect(dialog).toHaveTextContent('2 sections of IS 301 this term will keep running');
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Replaced by IS 310');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive course' }));

    // The archive button is gone; focus lands on the announcement instead of the page.
    const notice = await screen.findByText('IS 301 archived.');
    expect(notice.closest('[role="status"]')).toHaveFocus();
    await waitFor(() =>
      expect(screen.getByText(/Archived courses cannot be edited/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Save course' })).not.toBeInTheDocument();
    expect(api.bodyOf(`POST /admin/courses/${COURSE_ID}/archive`)).toEqual({
      reason: 'Replaced by IS 310',
    });
  });

  it('restores an archived course', async () => {
    const api = adminApi(record({ course: course({ archived: true }), offerings: [] }));
    api.on(`POST /admin/courses/${COURSE_ID}/restore`, () => {
      api.on(RECORD, { status: 200, body: record({ offerings: [] }) });
      return { status: 200, body: course() };
    });
    renderApp(`/admin/courses/${COURSE_ID}`);

    expect(await screen.findByText(/No sections yet/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Restore IS 301' }));
    expect(await screen.findByRole('button', { name: 'Save course' })).toBeInTheDocument();
    expect(screen.getByText('IS 301 restored.').closest('[role="status"]')).toHaveFocus();
  });

  it('says so when the programs or a reload cannot be loaded', async () => {
    const api = adminApi();
    api.on('GET /admin/programs', { status: 500, body: { message: 'Programs are unavailable.' } });
    api.on(`POST /admin/courses/${COURSE_ID}/archive`, () => {
      api.on(RECORD, { status: 500, body: { message: 'Server error.' } });
      return { status: 200, body: course({ archived: true }) };
    });
    renderApp(`/admin/courses/${COURSE_ID}`);

    expect(await screen.findByText('Programs are unavailable.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Archive IS 301' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive IS 301' });
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Replaced');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive course' }));
    expect(
      await screen.findByText(/Could not reload the course: Server error./),
    ).toBeInTheDocument();
  });

  it('says so when there is no such course', async () => {
    const api = adminApi();
    api.on(RECORD, { status: 404, body: { message: 'No such course.' } });
    renderApp(`/admin/courses/${COURSE_ID}`);

    expect(await screen.findByText('No such course.')).toBeInTheDocument();
  });

  it('is linked from the course list', async () => {
    const api = adminApi();
    api.on('GET /admin/courses?page=1', {
      status: 200,
      body: { items: [course()], total: 1, page: 1, pageSize: 25 },
    });
    renderApp('/admin/courses');

    await userEvent.click(await screen.findByRole('link', { name: 'IS 301 record' }));
    expect(
      await screen.findByRole('heading', { name: 'Course offering and curriculum record' }),
    ).toBeInTheDocument();
  });
});
