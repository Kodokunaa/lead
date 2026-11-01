import type {
  CourseContent,
  ResourceDetails,
  ResourceListResponse,
  ResourceSummary,
  ResourceVersion,
} from '@lead/schema';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeUser, installFakeApi, type FakeApi } from '../../../test/fake-api';
import { renderApp } from '../../../test/render-app';

const COURSE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const V1 = '33333333-3333-4333-8333-333333333333';
const V2 = '44444444-4444-4444-8444-444444444444';
const O1 = '55555555-5555-4555-8555-555555555555';
const TEACHER_BASE = `/teacher/content/${COURSE_ID}/resources`;

function version(overrides: Partial<ResourceVersion> = {}): ResourceVersion {
  return {
    id: V1,
    number: 1,
    kind: 'file',
    fileName: 'guide.pdf',
    contentType: 'application/pdf',
    sizeBytes: 250_000,
    url: null,
    status: 'pending',
    submittedBy: 'Maria Santos',
    submittedAt: '2026-11-01T00:00:00.000Z',
    reviewedBy: null,
    reviewedAt: null,
    note: null,
    ...overrides,
  };
}

function summary(overrides: Partial<ResourceSummary> = {}): ResourceSummary {
  return {
    id: RESOURCE_ID,
    title: 'Normalization guide',
    course: { id: COURSE_ID, code: 'IS 301', title: 'Database Systems' },
    module: null,
    objectives: [{ id: O1, code: 'O1' }],
    latest: version(),
    approvedVersion: null,
    ragStatus: 'not_indexed',
    ...overrides,
  };
}

function details(versions: ResourceVersion[]): ResourceDetails {
  const approved = versions.find((item) => item.status === 'approved');
  return {
    ...summary({ latest: versions[0]!, approvedVersion: approved?.number ?? null }),
    ragStatus: versions[0]?.status === 'withdrawn' && !approved ? 'excluded' : 'not_indexed',
    versions,
  };
}

const content: CourseContent = {
  course: { id: COURSE_ID, code: 'IS 301', title: 'Database Systems' },
  objectives: [{ id: O1, code: 'O1', description: 'Normalize a relation' }],
  modules: [],
};

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x') }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('teacher resources (T07)', () => {
  function teacherApi(resources: ResourceSummary[] = [summary()]): FakeApi {
    const api = installFakeApi(fakeUser('teacher'));
    api.on(`GET /teacher/content/${COURSE_ID}`, { status: 200, body: content });
    api.on(`GET ${TEACHER_BASE}`, { status: 200, body: resources });
    return api;
  }

  it('lists resources with their review status and the reviewer’s note', async () => {
    teacherApi([
      summary({
        latest: version({ number: 2, status: 'returned', note: 'Cite section 2.' }),
        approvedVersion: 1,
      }),
    ]);
    renderApp(TEACHER_BASE);

    const row = await screen.findByRole('row', { name: /Normalization guide/ });
    expect(row).toHaveTextContent('Returned for revision');
    expect(row).toHaveTextContent('Reviewer: Cite section 2.');
    expect(row).toHaveTextContent('Students get v1');
  });

  it('uploads a file with its objectives for approval', async () => {
    const api = teacherApi([]);
    api.on(`POST ${TEACHER_BASE}`, { status: 201, body: details([version()]) });
    renderApp(TEACHER_BASE);

    await userEvent.type(await screen.findByLabelText('Resource title'), 'Normalization guide');
    const file = new File(['%PDF-1.4'], 'guide.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText('File'), file);
    await userEvent.click(screen.getByLabelText('O1 – Normalize a relation'));
    // jsdom's form validation cannot see files attached by user-event, so submit directly.
    fireEvent.submit(screen.getByRole('button', { name: 'Submit for approval' }).closest('form')!);

    expect(
      await screen.findByText('Normalization guide was sent for approval.'),
    ).toBeInTheDocument();
    const body = api.bodyOf(`POST ${TEACHER_BASE}`) as FormData;
    expect(body.get('title')).toBe('Normalization guide');
    // jsdom leaves the chosen file out of FormData; the API tests cover the file itself.
    expect(body.has('file')).toBe(true);
    expect(body.getAll('objectiveIds')).toEqual([O1]);
    expect(body.get('url')).toBeNull();
    // The form starts empty again for the next upload.
    expect(screen.getByLabelText('Resource title')).toHaveValue('');
  });

  it('sends a link instead of a file when chosen', async () => {
    const api = teacherApi([]);
    api.on(`POST ${TEACHER_BASE}`, { status: 201, body: details([version()]) });
    renderApp(TEACHER_BASE);

    await userEvent.type(await screen.findByLabelText('Resource title'), 'CCC guide');
    await userEvent.click(screen.getByLabelText('Approved link'));
    await userEvent.type(screen.getByLabelText('Link'), 'https://ccc.edu.ph/guide');
    await userEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));

    await screen.findByText('CCC guide was sent for approval.');
    const body = api.bodyOf(`POST ${TEACHER_BASE}`) as FormData;
    expect(body.get('url')).toBe('https://ccc.edu.ph/guide');
    expect(body.get('file')).toBeNull();
  });

  it('allows no new version while one waits for review, and downloads the file', async () => {
    const api = teacherApi();
    api.on(`GET ${TEACHER_BASE}/${RESOURCE_ID}/versions/${V1}/file`, { status: 200, body: {} });
    renderApp(TEACHER_BASE);

    expect(
      await screen.findByRole('button', { name: 'New version of Normalization guide' }),
    ).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Open Normalization guide' }));
    await vi.waitFor(() =>
      expect(api.calls).toContain(`GET ${TEACHER_BASE}/${RESOURCE_ID}/versions/${V1}/file`),
    );
  });
});

describe('teacher resources, more (T07)', () => {
  function teacherApi(resources: ResourceSummary[]): FakeApi {
    const api = installFakeApi(fakeUser('teacher'));
    api.on(`GET /teacher/content/${COURSE_ID}`, { status: 200, body: content });
    api.on(`GET ${TEACHER_BASE}`, { status: 200, body: resources });
    return api;
  }

  it('sends a new version as a link after a return', async () => {
    const api = teacherApi([summary({ latest: version({ status: 'returned' }) })]);
    api.on(`POST ${TEACHER_BASE}/${RESOURCE_ID}/versions`, {
      status: 201,
      body: details([version({ id: V2, number: 2 }), version({ status: 'returned' })]),
    });
    renderApp(TEACHER_BASE);

    await userEvent.click(
      await screen.findByRole('button', { name: 'New version of Normalization guide' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'New version of Normalization guide',
    });
    await userEvent.click(within(dialog).getByLabelText('Approved link'));
    await userEvent.type(within(dialog).getByLabelText('Link'), 'https://ccc.edu.ph/guide-v2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit for approval' }));

    expect(
      await screen.findByText('A new version of Normalization guide was sent.'),
    ).toBeInTheDocument();
    const body = api.bodyOf(`POST ${TEACHER_BASE}/${RESOURCE_ID}/versions`) as FormData;
    expect(body.get('url')).toBe('https://ccc.edu.ph/guide-v2');
  });

  it('keeps what was typed when the upload is refused', async () => {
    const api = teacherApi([]);
    api.on(`POST ${TEACHER_BASE}`, {
      status: 400,
      body: { message: 'Remove the user name or password from the link.' },
    });
    renderApp(TEACHER_BASE);

    await userEvent.type(await screen.findByLabelText('Resource title'), 'CCC guide');
    await userEvent.click(screen.getByLabelText('Approved link'));
    await userEvent.type(screen.getByLabelText('Link'), 'https://a@ccc.edu.ph/guide');
    await userEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Remove the user name');
    expect(screen.getByLabelText('Resource title')).toHaveValue('CCC guide');
    expect(screen.getByLabelText('Link')).toHaveValue('https://a@ccc.edu.ph/guide');
  });

  it('opens a link resource in a new tab without giving it this page', async () => {
    teacherApi([
      summary({
        latest: version({ kind: 'link', url: 'https://ccc.edu.ph/guide', fileName: null }),
      }),
    ]);
    renderApp(TEACHER_BASE);

    const link = await screen.findByRole('link', {
      name: 'Open Normalization guide (opens a new tab)',
    });
    expect(link).toHaveAttribute('href', 'https://ccc.edu.ph/guide');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('resource library and review (A10, A11)', () => {
  function adminApi(versions: ResourceVersion[]): FakeApi {
    const api = installFakeApi(fakeUser('admin'));
    const list: ResourceListResponse = {
      items: [summary()],
      total: 1,
      page: 1,
      pageSize: 25,
    };
    api.on('GET /admin/resources?page=1', { status: 200, body: list });
    api.on(`GET /admin/resources/${RESOURCE_ID}`, { status: 200, body: details(versions) });
    return api;
  }

  it('lists resources and filters by status', async () => {
    const api = adminApi([version()]);
    api.on('GET /admin/resources?status=approved&page=1', {
      status: 200,
      body: { items: [], total: 0, page: 1, pageSize: 25 },
    });
    renderApp('/admin/courses/resources');

    const row = await screen.findByRole('row', { name: /Normalization guide/ });
    expect(row).toHaveTextContent('IS 301');
    expect(row).toHaveTextContent('Pending review');
    expect(row).toHaveTextContent('Not indexed yet');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'approved');

    expect(await screen.findByText('No resources match.')).toBeInTheDocument();
  });

  it('approves only after both checks, with the note', async () => {
    const api = adminApi([version({ id: V2, number: 2 }), version({ status: 'approved' })]);
    api.on(`POST /admin/resources/${RESOURCE_ID}/versions/${V2}/approve`, {
      status: 200,
      body: details([version({ id: V2, number: 2, status: 'approved' })]),
    });
    renderApp(`/admin/courses/resources/${RESOURCE_ID}`);

    expect(await screen.findByText(/it replaces version 1 once approved/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    // The browser's own check stops the form while a box is unticked.
    expect(api.calls).not.toContain(`POST /admin/resources/${RESOURCE_ID}/versions/${V2}/approve`);

    await userEvent.click(screen.getByLabelText('Confirm source is approved'));
    await userEvent.click(screen.getByLabelText('Verify permissions and metadata'));
    await userEvent.type(screen.getByLabelText('Approval note (optional)'), 'Checked.');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Version 2 approved.')).toBeInTheDocument();
    expect(api.bodyOf(`POST /admin/resources/${RESOURCE_ID}/versions/${V2}/approve`)).toEqual({
      confirmSource: true,
      confirmPermissions: true,
      note: 'Checked.',
    });
  });

  it('returns a version with a note, without approving it', async () => {
    const api = adminApi([version()]);
    api.on(`POST /admin/resources/${RESOURCE_ID}/versions/${V1}/return`, {
      status: 200,
      body: details([version({ status: 'returned', note: 'Cite section 2.' })]),
    });
    renderApp(`/admin/courses/resources/${RESOURCE_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Return for revision' }));
    const dialog = await screen.findByRole('dialog', { name: 'Return version 1' });
    await userEvent.type(within(dialog).getByLabelText('What should change?'), 'Cite section 2.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Return to teacher' }));

    expect(await screen.findByText('Version 1 returned to the teacher.')).toBeInTheDocument();
    expect(api.bodyOf(`POST /admin/resources/${RESOURCE_ID}/versions/${V1}/return`)).toEqual({
      note: 'Cite section 2.',
    });
    expect(api.calls).not.toContain(`POST /admin/resources/${RESOURCE_ID}/versions/${V1}/approve`);
  });

  it('withdraws the approved version with a reason', async () => {
    const api = adminApi([version({ status: 'approved' })]);
    api.on(`POST /admin/resources/${RESOURCE_ID}/versions/${V1}/withdraw`, {
      status: 200,
      body: details([version({ status: 'withdrawn' })]),
    });
    renderApp(`/admin/courses/resources/${RESOURCE_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw version 1' });
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Publisher asked');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw version' }));

    expect(await screen.findByText('Version 1 withdrawn.')).toBeInTheDocument();
    expect(api.bodyOf(`POST /admin/resources/${RESOURCE_ID}/versions/${V1}/withdraw`)).toEqual({
      reason: 'Publisher asked',
    });
  });
});
