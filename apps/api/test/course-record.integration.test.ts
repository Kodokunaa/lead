import type {
  Course,
  CourseContent,
  CourseRecord,
  Lesson,
  ResourceDetails,
  SectionSummary,
} from '@lead/schema';
import { randomUUID, randomInt } from 'node:crypto';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { createTestTerm } from './test-terms';
import { createUser, TEST_PASSWORD } from './test-users';

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

describe('course record, A06 (integration)', () => {
  let testApp: TestApp;
  let sql: Sql;
  let adminToken: string;
  const server = () => testApp.server();

  async function tokenFor(email: string): Promise<string> {
    const response = await request(server())
      .post('/api/auth/sign-in')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  const get = (path: string, token = adminToken) =>
    request(server()).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token = adminToken) =>
    request(server()).post(`/api${path}`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    testApp = await createTestApp();
    sql = testApp.app.get<Sql>(SQL_CLIENT);
    adminToken = await tokenFor(await createUser(sql, { role: 'admin' }));
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('shows where the course is taught, by whom, and how far its content has come', async () => {
    const past = await createTestTerm(server(), adminToken);
    const current = await createTestTerm(server(), adminToken, { current: true });
    const course = (
      await post('/admin/courses')
        .send({
          code: `IS ${randomInt(100_000, 999_999)}`,
          title: 'Database Systems',
          units: 3,
          programId: null,
        })
        .expect(201)
    ).body as Course;
    const section = async (termId: string, name: string) =>
      (
        await post('/admin/sections')
          .send({ courseCode: course.code, termId, name, capacity: 40 })
          .expect(201)
      ).body as SectionSummary;
    const a = await section(current.id, 'BSIS 3-A');
    await section(current.id, 'BSIS 3-B');
    await section(past.id, 'BSIS 2-A');

    const teacherEmail = await createUser(sql, { role: 'teacher' });
    await post(`/admin/sections/${a.id}/teachers`).send({ email: teacherEmail }).expect(200);
    await post(`/admin/sections/${a.id}/enrollments`)
      .send({ emails: `${await createUser(sql)}, ${await createUser(sql)}` })
      .expect(200);

    const teacher = await tokenFor(teacherEmail);
    const base = `/teacher/content/${course.id}`;
    const { objectives } = (
      await post(`${base}/objectives`, teacher).send({ description: 'Normalize data' }).expect(201)
    ).body as CourseContent;
    const { modules } = (
      await post(`${base}/modules`, teacher)
        .send({ title: 'Normalization', objectiveIds: [objectives[0]!.id] })
        .expect(201)
    ).body as CourseContent;
    await post(`${base}/modules/${modules[0]!.id}/publish`, teacher).expect(200);
    const lesson = (
      await post(`${base}/modules/${modules[0]!.id}/lessons`, teacher)
        .send({ title: 'Normal forms', objectiveId: objectives[0]!.id, body: 'Text.' })
        .expect(201)
    ).body as Lesson;
    await post(`${base}/lessons/${lesson.id}/publish`, teacher).expect(200);
    await post(`${base}/modules/${modules[0]!.id}/lessons`, teacher)
      .send({ title: 'Draft lesson' })
      .expect(201);
    const resource = (
      await post(`${base}/resources`, teacher)
        .field('title', 'Guide')
        .attach('file', PDF, 'guide.pdf')
        .expect(201)
    ).body as ResourceDetails;
    await post(`/admin/resources/${resource.id}/versions/${resource.latest.id}/approve`)
      .send({ confirmSource: true, confirmPermissions: true })
      .expect(200);
    await post(`${base}/resources`, teacher)
      .field('title', 'Notes')
      .attach('file', PDF, 'notes.pdf')
      .expect(201);

    const record = (await get(`/admin/courses/${course.id}/record`).expect(200))
      .body as CourseRecord;

    expect(record.course).toMatchObject({ id: course.id, code: course.code, archived: false });
    // Newest term first (the two test terms have random years).
    const expected = [
      { year: current.year, entry: [current.id, ['BSIS 3-A', 'BSIS 3-B']] },
      { year: past.year, entry: [past.id, ['BSIS 2-A']] },
    ].sort((x, y) => y.year - x.year);
    expect(
      record.offerings.map((offering) => [
        offering.term.id,
        offering.sections.map((item) => item.name),
      ]),
    ).toEqual(expected.map((item) => item.entry));
    const currentOffering = record.offerings.find((offering) => offering.term.id === current.id);
    expect(currentOffering?.term.current).toBe(true);
    expect(currentOffering?.sections[0]).toMatchObject({
      enrolled: 2,
      capacity: 40,
      teachers: [expect.objectContaining({ displayName: expect.any(String) as unknown })],
    });
    expect(record.content).toEqual({
      objectives: 1,
      modules: 1,
      publishedModules: 1,
      lessons: 2,
      publishedLessons: 1,
    });
    expect(record.resources).toEqual({ total: 2, approved: 1, pending: 1 });
  });

  it('answers 404 for an unknown course and is for administrators only', async () => {
    await get(`/admin/courses/${randomUUID()}/record`).expect(404);
    await get('/admin/courses/not-a-uuid/record').expect(400);
    const teacher = await tokenFor(await createUser(sql, { role: 'teacher' }));
    await get(`/admin/courses/${randomUUID()}/record`, teacher).expect(403);
  });
});
