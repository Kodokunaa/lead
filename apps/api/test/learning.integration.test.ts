import type {
  Course,
  CourseContent,
  Lesson,
  ResourceDetails,
  SectionSummary,
  StudentClassOverview,
  StudentLesson,
  StudentResourceView,
  Term,
} from '@lead/schema';
import { randomInt } from 'node:crypto';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { createUser, TEST_PASSWORD } from './test-users';

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

/**
 * One class, built through the real API: a published module with a published and a draft lesson,
 * a draft module, and resources in every review state.
 */
describe('student course views (integration)', () => {
  let testApp: TestApp;
  let sql: Sql;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let studentEmail: string;
  let course: Course;
  let section: SectionSummary;
  const ids = {
    published: '',
    draftLesson: '',
    hiddenLesson: '',
    approved: '',
    pending: '',
    draftModuleResource: '',
  };
  const server = () => testApp.server();

  async function tokenFor(email: string): Promise<string> {
    const response = await request(server())
      .post('/api/auth/sign-in')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  const get = (path: string, token = studentToken) =>
    request(server()).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token: string) =>
    request(server()).post(`/api${path}`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    testApp = await createTestApp();
    sql = testApp.app.get<Sql>(SQL_CLIENT);
    adminToken = await tokenFor(await createUser(sql, { role: 'admin' }));
    const teacherEmail = await createUser(sql, { role: 'teacher' });
    teacherToken = await tokenFor(teacherEmail);
    studentEmail = await createUser(sql);
    studentToken = await tokenFor(studentEmail);

    const start = randomInt(2200, 9000);
    const term = (
      await post('/admin/terms', adminToken)
        .send({
          schoolYear: `${start}-${start + 1}`,
          semester: 'first',
          startsOn: `${start}-08-10`,
          endsOn: `${start}-12-18`,
        })
        .expect(201)
    ).body as Term;
    await post(`/admin/terms/${term.id}/make-current`, adminToken).expect(200);
    course = (
      await post('/admin/courses', adminToken)
        .send({
          code: `IS ${randomInt(100_000, 999_999)}`,
          title: 'Database Systems',
          units: 3,
          programId: null,
        })
        .expect(201)
    ).body as Course;
    section = (
      await post('/admin/sections', adminToken)
        .send({ courseCode: course.code, termId: term.id, name: 'BSIS 3-A', capacity: 40 })
        .expect(201)
    ).body as SectionSummary;
    await post(`/admin/sections/${section.id}/teachers`, adminToken)
      .send({ email: teacherEmail })
      .expect(200);
    await post(`/admin/sections/${section.id}/enrollments`, adminToken)
      .send({ emails: studentEmail })
      .expect(200);

    const base = `/teacher/content/${course.id}`;
    const { objectives } = (
      await post(`${base}/objectives`, teacherToken)
        .send({ description: 'Normalize a relation to 3NF' })
        .expect(201)
    ).body as CourseContent;
    const o1 = objectives[0]!.id;
    const withModules = async (title: string) => {
      const content = (
        await post(`${base}/modules`, teacherToken)
          .send({ title, objectiveIds: [o1] })
          .expect(201)
      ).body as CourseContent;
      return content.modules.find((module) => module.title === title)!.id;
    };
    const published = await withModules('Normalization');
    const draft = await withModules('Advanced design');
    await post(`${base}/modules/${published}/publish`, teacherToken).expect(200);

    const lesson = async (moduleId: string, title: string, publish: boolean) => {
      const created = (
        await post(`${base}/modules/${moduleId}/lessons`, teacherToken)
          .send({ title, objectiveId: o1, body: `${title}: line one.\nLine two <b>not bold</b>.` })
          .expect(201)
      ).body as Lesson;
      if (publish) await post(`${base}/lessons/${created.id}/publish`, teacherToken).expect(200);
      return created.id;
    };
    ids.published = await lesson(published, 'Normal forms', true);
    ids.draftLesson = await lesson(published, 'Worked examples', false);
    ids.hiddenLesson = await lesson(draft, 'Denormalization', true);

    const upload = async (title: string, moduleId?: string) => {
      const req = post(`${base}/resources`, teacherToken).field('title', title);
      if (moduleId) req.field('moduleId', moduleId);
      return ((await req.attach('file', PDF, `${title}.pdf`).expect(201)).body as ResourceDetails)
        .id;
    };
    ids.approved = await upload('Normalization guide', published);
    ids.pending = await upload('Draft handout');
    ids.draftModuleResource = await upload('Advanced notes', draft);
    const approve = async (resourceId: string) => {
      const details = (await get(`/admin/resources/${resourceId}`, adminToken).expect(200))
        .body as ResourceDetails;
      await post(`/admin/resources/${resourceId}/versions/${details.latest.id}/approve`, adminToken)
        .send({ confirmSource: true, confirmPermissions: true })
        .expect(200);
    };
    await approve(ids.approved);
    await approve(ids.draftModuleResource);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('shows the class with published modules and lessons and approved resources only', async () => {
    const overview = (await get(`/student/classes/${section.id}`).expect(200))
      .body as StudentClassOverview;

    expect(overview.section).toMatchObject({ id: section.id, name: 'BSIS 3-A' });
    expect(overview.objectives.map((objective) => objective.code)).toEqual(['O1']);
    expect(overview.modules.map((module) => [module.position, module.title])).toEqual([
      [1, 'Normalization'],
    ]);
    expect(overview.modules[0]?.lessons.map((lesson) => lesson.title)).toEqual(['Normal forms']);
    expect(overview.resources.map((resource) => resource.title)).toEqual(['Normalization guide']);
    expect(overview.calendar.term.id).toBeTruthy();
  });

  it('opens a published lesson, as plain text, with its module and resources', async () => {
    const lesson = (
      await get(`/student/classes/${section.id}/lessons/${ids.published}`).expect(200)
    ).body as StudentLesson;

    expect(lesson).toMatchObject({
      title: 'Normal forms',
      body: 'Normal forms: line one.\nLine two <b>not bold</b>.',
      objective: { code: 'O1' },
      course: { code: course.code },
      module: { title: 'Normalization', lessons: [{ title: 'Normal forms', position: 1 }] },
    });
    expect(lesson.resources.map((resource) => resource.title)).toEqual(['Normalization guide']);

    await get(`/student/classes/${section.id}/lessons/${ids.draftLesson}`).expect(404);
    await get(`/student/classes/${section.id}/lessons/${ids.hiddenLesson}`).expect(404);
  });

  it('gives the approved version of a resource only, and nothing once withdrawn', async () => {
    const view = (await get(`/student/classes/${section.id}/resources/${ids.approved}`).expect(200))
      .body as StudentResourceView;
    expect(view).toMatchObject({
      title: 'Normalization guide',
      course: { code: course.code },
      version: { number: 1, kind: 'file' },
    });
    // Read the whole download: a response left unread keeps the file open, and on Windows the
    // test worker can then abort when it exits.
    const file = await get(`/student/classes/${section.id}/resources/${ids.approved}/file`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers['content-disposition']).toMatch(/^attachment;/);
    expect(Buffer.compare(file.body as Buffer, PDF)).toBe(0);

    await get(`/student/classes/${section.id}/resources/${ids.pending}`).expect(404);
    // Approved, but its module is still a draft.
    await get(`/student/classes/${section.id}/resources/${ids.draftModuleResource}`).expect(404);
    await get(`/student/classes/${section.id}/resources/${ids.draftModuleResource}/file`).expect(
      404,
    );
    await get(`/student/classes/${section.id}/resources/${ids.pending}/file`).expect(404);

    const details = (await get(`/admin/resources/${ids.approved}`, adminToken).expect(200))
      .body as ResourceDetails;
    await post(
      `/admin/resources/${ids.approved}/versions/${details.latest.id}/withdraw`,
      adminToken,
    )
      .send({ reason: 'Replaced by the publisher' })
      .expect(200);
    await get(`/student/classes/${section.id}/resources/${ids.approved}`).expect(404);
    await get(`/student/classes/${section.id}/resources/${ids.approved}/file`).expect(404);
  });

  it('keeps out students who are not, or no longer, enrolled', async () => {
    const outsider = await tokenFor(await createUser(sql));
    await get(`/student/classes/${section.id}`, outsider).expect(404);
    await get(`/student/classes/${section.id}/lessons/${ids.published}`, outsider).expect(404);
    await get(`/student/classes/${section.id}`, teacherToken).expect(403);

    const dropped = await createUser(sql);
    const droppedToken = await tokenFor(dropped);
    await post(`/admin/sections/${section.id}/enrollments`, adminToken)
      .send({ emails: dropped })
      .expect(200);
    await get(`/student/classes/${section.id}`, droppedToken).expect(200);
    const [row] = await sql`select id from users where email = ${dropped}`;
    await post(`/admin/sections/${section.id}/enrollments/${row?.id as string}/drop`, adminToken)
      .send({ reason: 'Shifted to BSTM' })
      .expect(200);
    await get(`/student/classes/${section.id}`, droppedToken).expect(404);
  });
});
