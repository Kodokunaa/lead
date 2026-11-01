import type { Course, CourseContent, Lesson, SectionSummary, TeacherCourse } from '@lead/schema';
import { createHash, randomInt } from 'node:crypto';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { createTestTerm } from './test-terms';
import { createUser, TEST_PASSWORD } from './test-users';

describe('course content (integration)', () => {
  let testApp: TestApp;
  let sql: Sql;
  let adminToken: string;
  let teacherToken: string;
  let teacherEmail: string;
  let course: Course;
  const server = () => testApp.server();

  async function tokenFor(email: string): Promise<string> {
    const response = await request(server())
      .post('/api/auth/sign-in')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  const call = (method: 'get' | 'post' | 'patch', path: string, token = teacherToken) => {
    const url = `/api${path}`;
    const req =
      method === 'get'
        ? request(server()).get(url)
        : method === 'post'
          ? request(server()).post(url)
          : request(server()).patch(url);
    return req.set('Authorization', `Bearer ${token}`);
  };

  /** A fresh course taught by the shared teacher this term, so each test starts empty. */
  async function newCourse(): Promise<Course> {
    const created = (
      await call('post', '/admin/courses', adminToken)
        .send({
          code: `IS ${randomInt(100_000, 999_999)}`,
          title: 'Database Systems',
          units: 3,
          programId: null,
        })
        .expect(201)
    ).body as Course;
    const [term] = await sql`select id from academic_terms where current`;
    const section = (
      await call('post', '/admin/sections', adminToken)
        .send({
          courseCode: created.code,
          termId: term?.id as string,
          name: 'BSIS 3-A',
          capacity: 40,
        })
        .expect(201)
    ).body as SectionSummary;
    await call('post', `/admin/sections/${section.id}/teachers`, adminToken)
      .send({ email: teacherEmail })
      .expect(200);
    return created;
  }

  const outline = async (courseId = course.id) =>
    (await call('get', `/teacher/content/${courseId}`).expect(200)).body as CourseContent;

  async function addObjective(courseId: string, description: string) {
    return (
      await call('post', `/teacher/content/${courseId}/objectives`)
        .send({ description })
        .expect(201)
    ).body as CourseContent;
  }

  async function addModule(courseId: string, body: Record<string, unknown>) {
    return (await call('post', `/teacher/content/${courseId}/modules`).send(body).expect(201))
      .body as CourseContent;
  }

  async function lastAudit(action: string, targetId: string) {
    const [row] = await sql`
      select actor_role, before, after from audit_events
      where action = ${action} and target_id = ${targetId}
      order by occurred_at desc limit 1`;
    return row;
  }

  beforeAll(async () => {
    testApp = await createTestApp();
    sql = testApp.app.get<Sql>(SQL_CLIENT);
    adminToken = await tokenFor(await createUser(sql, { role: 'admin' }));
    teacherEmail = await createUser(sql, { role: 'teacher' });
    teacherToken = await tokenFor(teacherEmail);

    // A current term of its own; test files run one at a time, so nothing else moves it meanwhile.
    await createTestTerm(server(), adminToken, { current: true });
    course = await newCourse();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('access', () => {
    it("lists the teacher's courses and hides everyone else's", async () => {
      const courses = (await call('get', '/teacher/content').expect(200)).body as TeacherCourse[];
      expect(courses).toContainEqual(
        expect.objectContaining({ id: course.id, code: course.code, sections: ['BSIS 3-A'] }),
      );

      const outsider = await tokenFor(await createUser(sql, { role: 'teacher' }));
      await call('get', `/teacher/content/${course.id}`, outsider).expect(404);
      await call('post', `/teacher/content/${course.id}/objectives`, outsider)
        .send({ description: 'Explain dependencies' })
        .expect(404);
      const student = await tokenFor(await createUser(sql));
      await call('get', `/teacher/content/${course.id}`, student).expect(403);
    });

    it('refuses changes to an archived course', async () => {
      const archived = await newCourse();
      await call('post', `/admin/courses/${archived.id}/archive`, adminToken)
        .send({ reason: 'Replaced by IS 310' })
        .expect(200);
      await call('post', `/teacher/content/${archived.id}/objectives`)
        .send({ description: 'Explain dependencies' })
        .expect(409);
    });
  });

  describe('objectives and modules', () => {
    it('numbers objectives per course and records edits', async () => {
      const own = await newCourse();
      await addObjective(own.id, 'Explain functional dependencies');
      const content = await addObjective(own.id, 'Normalize a relation to 3NF');
      expect(content.objectives.map((objective) => objective.code)).toEqual(['O1', 'O2']);

      const o2 = content.objectives[1]!;
      const updated = (
        await call('patch', `/teacher/content/${own.id}/objectives/${o2.id}`)
          .send({ description: 'Normalize a relation to BCNF' })
          .expect(200)
      ).body as CourseContent;
      expect(updated.objectives[1]).toMatchObject({
        code: 'O2',
        description: 'Normalize a relation to BCNF',
      });
      expect(await lastAudit('objective.updated', o2.id)).toMatchObject({ actor_role: 'teacher' });
    });

    it('adds modules in order, moves them, and edits only the fields sent', async () => {
      const own = await newCourse();
      const { objectives } = await addObjective(own.id, 'Explain functional dependencies');
      await addModule(own.id, {
        title: 'Foundations',
        description: 'Keys and dependencies',
        objectiveIds: [objectives[0]!.id],
      });
      const two = await addModule(own.id, { title: 'Normalization', masteryThreshold: '70' });
      expect(two.modules.map((module) => [module.position, module.title])).toEqual([
        [1, 'Foundations'],
        [2, 'Normalization'],
      ]);
      expect(two.modules[1]).toMatchObject({
        masteryThreshold: 70,
        status: 'draft',
        objectiveIds: [],
      });

      const [first, second] = two.modules;
      await call('post', `/teacher/content/${own.id}/modules/${first!.id}/move`)
        .send({ direction: 'up' })
        .expect(409);
      const moved = (
        await call('post', `/teacher/content/${own.id}/modules/${second!.id}/move`)
          .send({ direction: 'up' })
          .expect(200)
      ).body as CourseContent;
      expect(moved.modules.map((module) => module.title)).toEqual(['Normalization', 'Foundations']);

      const edited = (
        await call('patch', `/teacher/content/${own.id}/modules/${first!.id}`)
          .send({ title: 'Foundations of design' })
          .expect(200)
      ).body as CourseContent;
      expect(edited.modules[1]).toMatchObject({
        title: 'Foundations of design',
        description: 'Keys and dependencies',
        objectiveIds: [objectives[0]!.id],
      });
    });

    it("refuses another course's objective", async () => {
      const own = await newCourse();
      const other = await newCourse();
      const { objectives } = await addObjective(other.id, 'Write SQL joins');
      await call('post', `/teacher/content/${own.id}/modules`)
        .send({ title: 'Foundations', objectiveIds: [objectives[0]!.id] })
        .expect(409);
    });
  });

  describe('publishing', () => {
    it('publishes a module only with an objective, and keeps one while published', async () => {
      const own = await newCourse();
      const { objectives } = await addObjective(own.id, 'Explain functional dependencies');
      const { modules } = await addModule(own.id, { title: 'Foundations' });
      const moduleId = modules[0]!.id;

      await call('post', `/teacher/content/${own.id}/modules/${moduleId}/publish`).expect(409);
      await call('patch', `/teacher/content/${own.id}/modules/${moduleId}`)
        .send({ objectiveIds: [objectives[0]!.id] })
        .expect(200);
      const published = (
        await call('post', `/teacher/content/${own.id}/modules/${moduleId}/publish`).expect(200)
      ).body as CourseContent;
      expect(published.modules[0]?.status).toBe('published');
      await call('patch', `/teacher/content/${own.id}/modules/${moduleId}`)
        .send({ objectiveIds: [] })
        .expect(409);
      expect(await lastAudit('module.published', moduleId)).toMatchObject({
        after: { status: 'published' },
      });
    });

    it("publishes a lesson only with content and one of its module's objectives", async () => {
      const own = await newCourse();
      await addObjective(own.id, 'Explain functional dependencies');
      const { objectives } = await addObjective(own.id, 'Normalize a relation to 3NF');
      const [o1, o2] = objectives;
      const { modules } = await addModule(own.id, {
        title: 'Normalization',
        objectiveIds: [o2!.id],
      });
      const moduleId = modules[0]!.id;
      const base = `/teacher/content/${own.id}`;

      await call('post', `${base}/modules/${moduleId}/lessons`)
        .send({ title: 'Normal forms', objectiveId: o1!.id })
        .expect(409);
      const lesson = (
        await call('post', `${base}/modules/${moduleId}/lessons`)
          .send({ title: 'Normal forms' })
          .expect(201)
      ).body as Lesson;
      expect(lesson).toMatchObject({ position: 1, status: 'draft', objectiveId: null, body: '' });

      await call('post', `${base}/lessons/${lesson.id}/publish`).expect(409);
      await call('patch', `${base}/lessons/${lesson.id}`).send({ body: 'bad text' }).expect(400);
      await call('patch', `${base}/lessons/${lesson.id}`).send({ objectiveId: o2!.id }).expect(200);
      await call('post', `${base}/lessons/${lesson.id}/publish`).expect(409);
      await call('patch', `${base}/lessons/${lesson.id}`)
        .send({ body: 'First normal form removes repeating groups.' })
        .expect(200);
      const published = (await call('post', `${base}/lessons/${lesson.id}/publish`).expect(200))
        .body as Lesson;
      expect(published.status).toBe('published');

      // While published it must stay publishable, and its objective must stay on the module.
      await call('patch', `${base}/lessons/${lesson.id}`).send({ body: '   ' }).expect(409);
      const refused = await call('patch', `${base}/modules/${moduleId}`)
        .send({ objectiveIds: [o1!.id] })
        .expect(409);
      expect((refused.body as { message: string }).message).toContain('Normal forms');

      const back = (await call('post', `${base}/lessons/${lesson.id}/unpublish`).expect(200))
        .body as Lesson;
      expect(back.status).toBe('draft');
      expect(await lastAudit('lesson.updated', lesson.id)).toMatchObject({
        after: {
          body: {
            length: 43,
            sha256: createHash('sha256')
              .update('First normal form removes repeating groups.')
              .digest('hex'),
          },
        },
      });
    });
  });

  describe('simultaneous changes', () => {
    it('gives two modules added at once their own positions', async () => {
      const own = await newCourse();
      let pending: Promise<request.Response[]> | undefined;
      await sql.begin(async (tx) => {
        await tx`select id from courses where id = ${own.id} for update`;
        pending = Promise.all([
          call('post', `/teacher/content/${own.id}/modules`).send({ title: 'Foundations' }),
          call('post', `/teacher/content/${own.id}/modules`).send({ title: 'Normalization' }),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      const responses = await (pending ?? Promise.resolve([]));
      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      const positions = (await outline(own.id)).modules.map((module) => module.position);
      expect(positions.sort()).toEqual([1, 2]);
    });

    it('numbers two objectives added at once O1 and O2', async () => {
      const own = await newCourse();
      let pending: Promise<request.Response[]> | undefined;
      await sql.begin(async (tx) => {
        await tx`select id from courses where id = ${own.id} for update`;
        pending = Promise.all([
          call('post', `/teacher/content/${own.id}/objectives`).send({
            description: 'Explain keys',
          }),
          call('post', `/teacher/content/${own.id}/objectives`).send({
            description: 'Write joins',
          }),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      const responses = await (pending ?? Promise.resolve([]));
      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      expect((await outline(own.id)).objectives.map((objective) => objective.code)).toEqual([
        'O1',
        'O2',
      ]);
    });
  });
});
