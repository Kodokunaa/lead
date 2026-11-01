import type { CourseContent, Lesson, TeacherCourse } from '@lead/schema';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi, type FakeApi } from '../../../test/fake-api';
import { renderApp } from '../../../test/render-app';

const COURSE_ID = '11111111-1111-4111-8111-111111111111';
const O1 = '22222222-2222-4222-8222-222222222222';
const O2 = '33333333-3333-4333-8333-333333333333';
const FOUNDATIONS = '44444444-4444-4444-8444-444444444444';
const NORMALIZATION = '55555555-5555-4555-8555-555555555555';
const LESSON_ID = '66666666-6666-4666-8666-666666666666';
const BASE = `/teacher/content/${COURSE_ID}`;

function content(overrides: Partial<CourseContent> = {}): CourseContent {
  return {
    course: { id: COURSE_ID, code: 'IS 301', title: 'Database Management Systems' },
    objectives: [
      { id: O1, code: 'O1', description: 'Explain functional dependencies' },
      { id: O2, code: 'O2', description: 'Normalize a relation to 3NF' },
    ],
    modules: [
      {
        id: FOUNDATIONS,
        position: 1,
        title: 'Foundations',
        description: 'Keys and dependencies',
        objectiveIds: [O1],
        requiresPrevious: false,
        masteryThreshold: null,
        status: 'published',
        lessons: [
          { id: LESSON_ID, title: 'Dependencies', position: 1, objectiveId: O1, status: 'draft' },
        ],
      },
      {
        id: NORMALIZATION,
        position: 2,
        title: 'Normalization',
        description: '',
        objectiveIds: [],
        requiresPrevious: true,
        masteryThreshold: 70,
        status: 'draft',
        lessons: [],
      },
    ],
    ...overrides,
  };
}

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: LESSON_ID,
    moduleId: FOUNDATIONS,
    title: 'Dependencies',
    position: 1,
    objectiveId: O1,
    status: 'draft',
    body: 'A functional dependency X → Y means…',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function teacherApi(): FakeApi {
  const api = installFakeApi(fakeUser('teacher'));
  const courses: TeacherCourse[] = [
    { id: COURSE_ID, code: 'IS 301', title: 'Database Management Systems', sections: ['BSIS 3-A'] },
  ];
  api.on('GET /teacher/content', { status: 200, body: courses });
  api.on(`GET ${BASE}`, { status: 200, body: content() });
  api.on(`GET ${BASE}/lessons/${LESSON_ID}`, { status: 200, body: lesson() });
  return api;
}

describe('course content (T04)', () => {
  it('lists the courses the teacher teaches and opens the outline', async () => {
    teacherApi();
    renderApp('/teacher/content');

    const courses = await screen.findByRole('list', { name: 'Courses' });
    expect(within(courses).getByText('BSIS 3-A')).toBeInTheDocument();
    await userEvent.click(within(courses).getByRole('link', { name: /IS 301/ }));

    expect(
      await screen.findByRole('heading', { name: 'Course outline and content' }),
    ).toBeInTheDocument();
    const foundations = screen.getByRole('row', { name: /1 \/ Foundations/ });
    expect(foundations).toHaveTextContent('O1');
    expect(foundations).toHaveTextContent('Published');
    expect(screen.getByRole('row', { name: /Lesson: Dependencies/ })).toHaveTextContent('Draft');
    expect(screen.getByRole('row', { name: /2 \/ Normalization/ })).toHaveTextContent('None yet');
  });

  it('adds a learning objective', async () => {
    const api = teacherApi();
    api.on(`POST ${BASE}/objectives`, { status: 201, body: content() });
    renderApp(BASE);

    await userEvent.click(await screen.findByRole('button', { name: 'Add objective' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a learning objective' });
    await userEvent.type(within(dialog).getByLabelText('Objective'), 'Write SQL joins');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add objective' }));

    expect(await screen.findByText('Objective added.')).toBeInTheDocument();
    expect(api.bodyOf(`POST ${BASE}/objectives`)).toEqual({ description: 'Write SQL joins' });
  });

  it('moves a module and announces it, with the edge moves unavailable', async () => {
    const api = teacherApi();
    api.on(`POST ${BASE}/modules/${FOUNDATIONS}/move`, { status: 200, body: content() });
    renderApp(BASE);

    expect(await screen.findByRole('button', { name: 'Move Foundations up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Normalization down' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Foundations down' }));

    const notice = await screen.findByText('Foundations moved down.');
    expect(notice.closest('[role="status"]')).toHaveFocus();
    expect(api.bodyOf(`POST ${BASE}/modules/${FOUNDATIONS}/move`)).toEqual({ direction: 'down' });
  });

  it('adds a module and opens its editor', async () => {
    const api = teacherApi();
    const added = content();
    const created = {
      ...added.modules[1]!,
      id: '77777777-7777-4777-8777-777777777777',
      position: 3,
      title: 'SQL queries',
    };
    api.on(`POST ${BASE}/modules`, () => {
      const next = { ...added, modules: [...added.modules, created] };
      api.on(`GET ${BASE}`, { status: 200, body: next });
      return { status: 201, body: next };
    });
    renderApp(BASE);

    await userEvent.click(await screen.findByRole('button', { name: 'Add module' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a module' });
    await userEvent.type(within(dialog).getByLabelText('Module title'), 'SQL queries');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add module' }));

    expect(
      await screen.findByRole('heading', { name: 'Module and learning objective editor' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Module title')).toHaveValue('SQL queries');
  });

  it('is for teachers only', async () => {
    installFakeApi(fakeUser('student'));
    renderApp(BASE);

    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeInTheDocument();
  });
});

describe('module editor (T05)', () => {
  it('saves objectives, prerequisite and mastery score', async () => {
    const api = teacherApi();
    api.on(`PATCH ${BASE}/modules/${NORMALIZATION}`, { status: 200, body: content() });
    renderApp(`${BASE}/modules/${NORMALIZATION}`);

    const title = await screen.findByLabelText('Module title');
    expect(title).toHaveValue('Normalization');
    expect(screen.getByLabelText('Mastery score (%)')).toHaveValue(70);
    expect(screen.getByLabelText('Students finish the previous module first')).toBeChecked();
    await userEvent.click(screen.getByLabelText('O2 – Normalize a relation to 3NF'));
    await userEvent.click(screen.getByLabelText('Students finish the previous module first'));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(api.bodyOf(`PATCH ${BASE}/modules/${NORMALIZATION}`)).toEqual({
      title: 'Normalization',
      description: '',
      objectiveIds: [O2],
      requiresPrevious: false,
      masteryThreshold: '70',
    });
  });

  it("shows the server's reason when publishing is refused", async () => {
    const api = teacherApi();
    api.on(`POST ${BASE}/modules/${NORMALIZATION}/publish`, {
      status: 409,
      body: { message: 'Map at least one learning objective to this module before publishing it.' },
    });
    renderApp(`${BASE}/modules/${NORMALIZATION}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Publish module' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Map at least one learning objective',
    );
  });
});

describe('lesson editor (T06)', () => {
  it("offers only the module's objectives and saves the lesson", async () => {
    const api = teacherApi();
    api.on(`PATCH ${BASE}/lessons/${LESSON_ID}`, { status: 200, body: lesson() });
    renderApp(`${BASE}/lessons/${LESSON_ID}`);

    const objective = await screen.findByLabelText('Objective');
    expect(
      within(objective)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose an objective', 'O1 – Explain functional dependencies']);
    expect(screen.getByText('1. Dependencies')).toHaveAttribute('aria-current', 'page');
    const body = screen.getByLabelText('Lesson content');
    await userEvent.clear(body);
    await userEvent.type(body, 'Armstrong axioms');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText('Lesson saved.')).toBeInTheDocument();
    expect(api.bodyOf(`PATCH ${BASE}/lessons/${LESSON_ID}`)).toEqual({
      title: 'Dependencies',
      objectiveId: O1,
      body: 'Armstrong axioms',
    });
  });

  it('publishes the lesson', async () => {
    const api = teacherApi();
    api.on(`POST ${BASE}/lessons/${LESSON_ID}/publish`, () => {
      api.on(`GET ${BASE}/lessons/${LESSON_ID}`, {
        status: 200,
        body: lesson({ status: 'published' }),
      });
      return { status: 200, body: lesson({ status: 'published' }) };
    });
    renderApp(`${BASE}/lessons/${LESSON_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Publish lesson' }));

    expect(await screen.findByText('Lesson published.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
  });
});

describe('editing safety', () => {
  it('will not publish a lesson with unsaved edits', async () => {
    const api = teacherApi();
    renderApp(`${BASE}/lessons/${LESSON_ID}`);

    await userEvent.type(await screen.findByLabelText('Lesson content'), ' More text.');
    await userEvent.click(screen.getByRole('button', { name: 'Publish lesson' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Save your changes before publishing.',
    );
    expect(api.calls).not.toContain(`POST ${BASE}/lessons/${LESSON_ID}/publish`);
  });

  it('keeps what was typed when a save is refused', async () => {
    const api = teacherApi();
    api.on(`PATCH ${BASE}/modules/${NORMALIZATION}`, {
      status: 409,
      body: { message: 'Choose objectives of this course only.' },
    });
    renderApp(`${BASE}/modules/${NORMALIZATION}`);

    const title = await screen.findByLabelText('Module title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Normal forms');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose objectives');
    expect(screen.getByLabelText('Module title')).toHaveValue('Normal forms');
  });

  it('keeps the editor when the refresh after a save fails', async () => {
    const api = teacherApi();
    api.on(`PATCH ${BASE}/lessons/${LESSON_ID}`, () => {
      api.on(`GET ${BASE}/lessons/${LESSON_ID}`, {
        status: 503,
        body: { message: 'The server is busy.' },
      });
      return { status: 200, body: lesson() };
    });
    renderApp(`${BASE}/lessons/${LESSON_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText(/Could not refresh the lesson/)).toBeInTheDocument();
    expect(screen.getByLabelText('Lesson content')).toBeInTheDocument();
  });

  it('reloads the outline when a move is refused', async () => {
    const api = teacherApi();
    api.on(`POST ${BASE}/modules/${FOUNDATIONS}/move`, () => {
      // Someone else reordered meanwhile; the reload must show their order.
      const [foundations, normalization] = content().modules;
      api.on(`GET ${BASE}`, {
        status: 200,
        body: content({
          modules: [
            { ...normalization!, position: 1 },
            { ...foundations!, position: 2 },
          ],
        }),
      });
      return { status: 409, body: { message: 'Foundations is already the last module.' } };
    });
    renderApp(BASE);

    await userEvent.click(await screen.findByRole('button', { name: 'Move Foundations down' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already the last module');
    expect(await screen.findByRole('row', { name: /1 \/ Normalization/ })).toBeInTheDocument();
  });
});
