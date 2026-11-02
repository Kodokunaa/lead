import type {
  Course,
  CourseContent,
  Lesson,
  ResourceDetails,
  SearchResponse,
  SectionSummary,
} from '@lead/schema';
import { randomBytes, randomInt } from 'node:crypto';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { createTestTerm } from './test-terms';
import { createUser, TEST_PASSWORD } from './test-users';

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

/**
 * Two courses built through the real API. The student and teacher belong to course A only; both
 * courses hold matching content in every state, so anything out of scope would show up.
 */
describe('permission-scoped search (integration)', () => {
  let testApp: TestApp;
  let sql: Sql;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let studentEmail: string;
  // A word no other test data contains, so results are exactly this test's records.
  const word = `Zq${randomBytes(4).toString('hex')}`;
  const server = () => testApp.server();

  async function tokenFor(email: string): Promise<string> {
    const response = await request(server())
      .post('/api/auth/sign-in')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  const get = (path: string, token: string) =>
    request(server()).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token: string) =>
    request(server()).post(`/api${path}`).set('Authorization', `Bearer ${token}`);

  async function search(q: string, token: string): Promise<SearchResponse> {
    return (await get(`/search?q=${encodeURIComponent(q)}`, token).expect(200))
      .body as SearchResponse;
  }

  const titles = (response: SearchResponse, type: string) =>
    response.results
      .filter((result) => result.type === type)
      .map((result) => result.title)
      .sort();

  /** A course with a published and a draft lesson, and an approved and a pending resource. */
  async function buildCourse(termId: string, teacherEmail: string, label: string) {
    const course = (
      await post('/admin/courses', adminToken)
        .send({
          code: `IS ${randomInt(100_000, 999_999)}`,
          title: `${word} ${label}`,
          units: 3,
          programId: null,
        })
        .expect(201)
    ).body as Course;
    const section = (
      await post('/admin/sections', adminToken)
        .send({ courseCode: course.code, termId, name: 'BSIS 3-A', capacity: 40 })
        .expect(201)
    ).body as SectionSummary;
    await post(`/admin/sections/${section.id}/teachers`, adminToken)
      .send({ email: teacherEmail })
      .expect(200);

    const teacher = await tokenFor(teacherEmail);
    const base = `/teacher/content/${course.id}`;
    const { objectives } = (
      await post(`${base}/objectives`, teacher).send({ description: 'Normalize data' }).expect(201)
    ).body as CourseContent;
    const { modules } = (
      await post(`${base}/modules`, teacher)
        .send({ title: `${word} module ${label}`, objectiveIds: [objectives[0]!.id] })
        .expect(201)
    ).body as CourseContent;
    const moduleId = modules[0]!.id;
    await post(`${base}/modules/${moduleId}/publish`, teacher).expect(200);
    for (const [title, publish] of [
      [`${word} lesson ${label}`, true],
      [`${word} draft ${label}`, false],
    ] as const) {
      const lesson = (
        await post(`${base}/modules/${moduleId}/lessons`, teacher)
          .send({ title, objectiveId: objectives[0]!.id, body: 'Text.' })
          .expect(201)
      ).body as Lesson;
      if (publish) await post(`${base}/lessons/${lesson.id}/publish`, teacher).expect(200);
    }
    for (const [title, approve] of [
      [`${word} guide ${label}`, true],
      [`${word} notes ${label}`, false],
    ] as const) {
      const resource = (
        await post(`${base}/resources`, teacher)
          .field('title', title)
          .attach('file', PDF, 'file.pdf')
          .expect(201)
      ).body as ResourceDetails;
      if (approve) {
        await post(
          `/admin/resources/${resource.id}/versions/${resource.latest.id}/approve`,
          adminToken,
        )
          .send({ confirmSource: true, confirmPermissions: true })
          .expect(200);
      }
    }
    return { course, section };
  }

  beforeAll(async () => {
    testApp = await createTestApp();
    sql = testApp.app.get<Sql>(SQL_CLIENT);
    adminToken = await tokenFor(await createUser(sql, { role: 'admin' }));
    const teacherA = await createUser(sql, { role: 'teacher' });
    const teacherB = await createUser(sql, { role: 'teacher' });
    teacherToken = await tokenFor(teacherA);
    studentEmail = await createUser(sql);
    studentToken = await tokenFor(studentEmail);

    const term = await createTestTerm(server(), adminToken, { current: true });

    const a = await buildCourse(term.id, teacherA, 'A');
    await buildCourse(term.id, teacherB, 'B');
    await post(`/admin/sections/${a.section.id}/enrollments`, adminToken)
      .send({ emails: studentEmail })
      .expect(200);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it("finds only a student's own classes, published lessons and approved resources", async () => {
    const response = await search(word, studentToken);

    expect(titles(response, 'class')).toHaveLength(1);
    expect(titles(response, 'lesson')).toEqual([`${word} lesson A`]);
    expect(titles(response, 'resource')).toEqual([`${word} guide A`]);
    expect(titles(response, 'module')).toEqual([]);
    expect(titles(response, 'user')).toEqual([]);
    const lesson = response.results.find((result) => result.type === 'lesson');
    expect(lesson?.target).toMatchObject({ screen: 'S05' });
    expect(lesson?.access).toBe('Enrolled');
  });

  it("finds a teacher's own courses' content in every state, and nothing else", async () => {
    const response = await search(word, teacherToken);

    expect(titles(response, 'class')).toHaveLength(1);
    expect(titles(response, 'module')).toEqual([`${word} module A`]);
    expect(titles(response, 'lesson')).toEqual([`${word} draft A`, `${word} lesson A`]);
    expect(titles(response, 'resource')).toEqual([`${word} guide A`, `${word} notes A`]);
    const draft = response.results.find((result) => result.title === `${word} draft A`);
    expect(draft).toMatchObject({ access: 'Draft', target: { screen: 'T06' } });
    const notes = response.results.find((result) => result.title === `${word} notes A`);
    expect(notes?.access).toBe('Pending review');
  });

  it('finds records across the college for administrators', async () => {
    const response = await search(word, adminToken);

    expect(titles(response, 'course')).toHaveLength(2);
    expect(titles(response, 'section')).toHaveLength(2);
    expect(titles(response, 'resource')).toHaveLength(4);
    expect(titles(response, 'lesson')).toEqual([]);

    const byEmail = await search(studentEmail, adminToken);
    expect(byEmail.results).toEqual([
      expect.objectContaining({
        type: 'user',
        target: expect.objectContaining({ screen: 'A03' }) as unknown,
      }),
    ]);
  });

  it('treats wildcards as plain text and needs a real query', async () => {
    expect((await search('%_', adminToken)).results).toEqual([]);
    await get('/search?q=a', studentToken).expect(400);
    await get('/search', studentToken).expect(400);
    await request(server()).get(`/api/search?q=${word}`).expect(401);
  });
});
