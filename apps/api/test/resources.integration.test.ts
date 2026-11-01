import type {
  Course,
  CourseContent,
  ResourceDetails,
  ResourceListResponse,
  ResourceSummary,
  SectionSummary,
  Term,
} from '@lead/schema';
import { randomInt } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { createUser, TEST_PASSWORD } from './test-users';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

describe('course resources (integration)', () => {
  let testApp: TestApp;
  let sql: Sql;
  let adminToken: string;
  let teacherToken: string;
  let teacherEmail: string;
  const server = () => testApp.server();

  async function tokenFor(email: string): Promise<string> {
    const response = await request(server())
      .post('/api/auth/sign-in')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  const get = (path: string, token = teacherToken) =>
    request(server()).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token = teacherToken) =>
    request(server()).post(`/api${path}`).set('Authorization', `Bearer ${token}`);

  /** A fresh course taught by the shared teacher this term. */
  async function newCourse(): Promise<Course> {
    const course = (
      await post('/admin/courses', adminToken)
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
      await post('/admin/sections', adminToken)
        .send({
          courseCode: course.code,
          termId: term?.id as string,
          name: 'BSIS 3-A',
          capacity: 40,
        })
        .expect(201)
    ).body as SectionSummary;
    await post(`/admin/sections/${section.id}/teachers`, adminToken)
      .send({ email: teacherEmail })
      .expect(200);
    return course;
  }

  function uploadPdf(courseId: string, title = 'Normalization guide', name = 'guide.pdf') {
    return post(`/teacher/content/${courseId}/resources`)
      .field('title', title)
      .attach('file', PDF, name);
  }

  async function lastAudit(action: string, targetId: string) {
    const [row] = await sql`
      select reason, before, after from audit_events
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
    // A current term of its own; test files run one at a time.
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
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('teachers', () => {
    it('upload a file for review and can download it back, safely', async () => {
      const course = await newCourse();
      const { objectives } = (
        await post(`/teacher/content/${course.id}/objectives`)
          .send({ description: 'Normalize a relation to 3NF' })
          .expect(201)
      ).body as CourseContent;

      const created = (
        await post(`/teacher/content/${course.id}/resources`)
          .field('title', 'Normalization guide')
          .field('objectiveIds', objectives[0]!.id)
          .attach('file', PDF, 'Guide "v1".pdf')
          .expect(201)
      ).body as ResourceDetails;
      expect(created).toMatchObject({
        title: 'Normalization guide',
        objectives: [{ code: 'O1' }],
        approvedVersion: null,
        latest: {
          number: 1,
          kind: 'file',
          status: 'pending',
          fileName: 'Guide v1.pdf',
          contentType: 'application/pdf',
        },
      });

      const list = (await get(`/teacher/content/${course.id}/resources`).expect(200))
        .body as ResourceSummary[];
      expect(list.map((item) => item.id)).toEqual([created.id]);

      const download = await get(
        `/teacher/content/${course.id}/resources/${created.id}/versions/${created.latest.id}/file`,
      )
        .buffer(true)
        .parse((response, done) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(Buffer.compare(download.body as Buffer, PDF)).toBe(0);
      expect(download.headers['content-type']).toBe('application/pdf');
      expect(download.headers['content-disposition']).toMatch(
        /^attachment; filename="Guide v1.pdf"/,
      );
      expect(download.headers['x-content-type-options']).toBe('nosniff');
      expect(await lastAudit('resource.submitted', created.id)).toMatchObject({
        after: { version: 1, fileName: 'Guide v1.pdf' },
      });
    });

    it('refuse files that are not what they claim, bad links, and both or neither', async () => {
      const course = await newCourse();
      const base = `/teacher/content/${course.id}/resources`;
      await post(base)
        .field('title', 'Not a PDF')
        .attach('file', Buffer.from('<script>alert(1)</script>'), 'trick.pdf')
        .expect(400);
      await post(base).field('title', 'Program').attach('file', PDF, 'setup.exe').expect(400);
      await post(base).field('title', 'Link').field('url', 'javascript:alert(1)').expect(400);
      await post(base).field('title', 'Nothing').expect(400);
      await post(base)
        .field('title', 'Both')
        .field('url', 'https://ccc.edu.ph/guide')
        .attach('file', PDF, 'guide.pdf')
        .expect(400);
      const link = (
        await post(base)
          .field('title', 'CCC guide')
          .field('url', 'https://ccc.edu.ph/guide')
          .expect(201)
      ).body as ResourceDetails;
      expect(link.latest).toMatchObject({ kind: 'link', url: 'https://ccc.edu.ph/guide' });
    });

    it('read several ticked objectives sent as repeated form fields', async () => {
      const course = await newCourse();
      await post(`/teacher/content/${course.id}/objectives`)
        .send({ description: 'Explain dependencies' })
        .expect(201);
      const { objectives } = (
        await post(`/teacher/content/${course.id}/objectives`)
          .send({ description: 'Normalize a relation' })
          .expect(201)
      ).body as CourseContent;
      const created = (
        await post(`/teacher/content/${course.id}/resources`)
          .field('title', 'Guide')
          .field('objectiveIds', objectives[0]!.id)
          .field('objectiveIds', objectives[1]!.id)
          .attach('file', PDF, 'guide.pdf')
          .expect(201)
      ).body as ResourceDetails;
      expect(created.objectives.map((objective) => objective.code)).toEqual(['O1', 'O2']);
    });

    it('leave no stored file behind when an upload is refused', async () => {
      const course = await newCourse();
      const other = await newCourse();
      const { objectives } = (
        await post(`/teacher/content/${other.id}/objectives`)
          .send({ description: 'Write SQL joins' })
          .expect(201)
      ).body as CourseContent;
      const resource = (await uploadPdf(course.id).expect(201)).body as ResourceDetails;
      const stored = async () => (await readdir(process.env.RESOURCE_STORAGE_DIR ?? '')).length;
      const before = await stored();

      await post(`/teacher/content/${course.id}/resources`)
        .field('title', 'Guide')
        .field('objectiveIds', objectives[0]!.id)
        .attach('file', PDF, 'guide.pdf')
        .expect(409);
      await post(`/teacher/content/${course.id}/resources/${resource.id}/versions`)
        .attach('file', PDF, 'guide-v2.pdf')
        .expect(409);

      expect(await stored()).toBe(before);
    });

    it('strip invisible characters that disguise a file name', async () => {
      const course = await newCourse();
      const created = (await uploadPdf(course.id, 'Report', 'report‮fdp.pdf').expect(201))
        .body as ResourceDetails;
      expect(created.latest.fileName).toBe('reportfdp.pdf');
    });

    it("keep to their own courses and the course's own objectives", async () => {
      const course = await newCourse();
      const other = await newCourse();
      const { objectives } = (
        await post(`/teacher/content/${other.id}/objectives`)
          .send({ description: 'Write SQL joins' })
          .expect(201)
      ).body as CourseContent;
      await post(`/teacher/content/${course.id}/resources`)
        .field('title', 'Guide')
        .field('objectiveIds', objectives[0]!.id)
        .attach('file', PDF, 'guide.pdf')
        .expect(409);

      const outsider = await tokenFor(await createUser(sql, { role: 'teacher' }));
      await post(`/teacher/content/${course.id}/resources`, outsider)
        .field('title', 'Guide')
        .attach('file', PDF, 'guide.pdf')
        .expect(404);
      const student = await tokenFor(await createUser(sql));
      await get(`/admin/resources`, student).expect(403);
    });
  });

  describe('review', () => {
    it('approves with both checks, supersedes the old version, returns and withdraws', async () => {
      const course = await newCourse();
      const v1 = (await uploadPdf(course.id).expect(201)).body as ResourceDetails;
      expect(v1.ragStatus).toBe('not_indexed');
      const review = (versionId: string, action: string) =>
        post(`/admin/resources/${v1.id}/versions/${versionId}/${action}`, adminToken);

      await review(v1.latest.id, 'approve').send({ confirmSource: true }).expect(400);
      const approved = (
        await review(v1.latest.id, 'approve')
          .send({ confirmSource: true, confirmPermissions: true })
          .expect(200)
      ).body as ResourceDetails;
      expect(approved).toMatchObject({ approvedVersion: 1, ragStatus: 'not_indexed' });

      // A second version waits for review while v1 stays what learners get.
      const v2 = (
        await post(`/teacher/content/${course.id}/resources/${v1.id}/versions`)
          .attach('file', PDF, 'guide-v2.pdf')
          .expect(201)
      ).body as ResourceDetails;
      expect(v2).toMatchObject({ approvedVersion: 1, latest: { number: 2, status: 'pending' } });
      await post(`/teacher/content/${course.id}/resources/${v1.id}/versions`)
        .field('url', 'https://ccc.edu.ph/guide')
        .expect(409);

      await review(v2.latest.id, 'return').send({ note: 'x' }).expect(400);
      const returned = (
        await review(v2.latest.id, 'return').send({ note: 'Cite section 2.' }).expect(200)
      ).body as ResourceDetails;
      expect(returned.versions.map((version) => [version.number, version.status])).toEqual([
        [2, 'returned'],
        [1, 'approved'],
      ]);

      const v3 = (
        await post(`/teacher/content/${course.id}/resources/${v1.id}/versions`)
          .attach('file', PDF, 'guide-v3.pdf')
          .expect(201)
      ).body as ResourceDetails;
      const replaced = (
        await review(v3.latest.id, 'approve')
          .send({ confirmSource: true, confirmPermissions: true, note: 'Checked.' })
          .expect(200)
      ).body as ResourceDetails;
      expect(replaced.versions.map((version) => version.status)).toEqual([
        'approved',
        'returned',
        'superseded',
      ]);

      await review(v3.latest.id, 'withdraw').send({}).expect(400);
      const withdrawn = (
        await review(v3.latest.id, 'withdraw')
          .send({ reason: 'Publisher asked us to remove it' })
          .expect(200)
      ).body as ResourceDetails;
      expect(withdrawn).toMatchObject({ approvedVersion: null, ragStatus: 'excluded' });
      expect(await lastAudit('resource.withdrawn', v1.id)).toMatchObject({
        reason: 'Publisher asked us to remove it',
      });
    });

    it('lists resources by the status of their latest version', async () => {
      const course = await newCourse();
      const pending = (await uploadPdf(course.id, `Pending ${course.code}`).expect(201))
        .body as ResourceDetails;
      const list = (
        await get(
          `/admin/resources?q=${encodeURIComponent(course.code)}&status=pending`,
          adminToken,
        ).expect(200)
      ).body as ResourceListResponse;
      expect(list.items.map((item) => item.id)).toEqual([pending.id]);
      const none = (
        await get(
          `/admin/resources?q=${encodeURIComponent(course.code)}&status=approved`,
          adminToken,
        ).expect(200)
      ).body as ResourceListResponse;
      expect(none.items).toEqual([]);
    });
  });

  describe('simultaneous submissions', () => {
    it('lets only one of two new versions sent at once wait for review', async () => {
      const course = await newCourse();
      const resource = (await uploadPdf(course.id).expect(201)).body as ResourceDetails;
      await post(
        `/admin/resources/${resource.id}/versions/${resource.latest.id}/return`,
        adminToken,
      )
        .send({ note: 'Add the sources.' })
        .expect(200);

      let pending: Promise<request.Response[]> | undefined;
      await sql.begin(async (tx) => {
        await tx`select id from resources where id = ${resource.id} for update`;
        pending = Promise.all([
          post(`/teacher/content/${course.id}/resources/${resource.id}/versions`).attach(
            'file',
            PDF,
            'a.pdf',
          ),
          post(`/teacher/content/${course.id}/resources/${resource.id}/versions`).attach(
            'file',
            PDF,
            'b.pdf',
          ),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      const statuses = (await (pending ?? Promise.resolve([]))).map((response) => response.status);

      expect(statuses.sort()).toEqual([201, 409]);
      const [row] = await sql`
        select count(*)::int as n from resource_versions where resource_id = ${resource.id}`;
      expect(row?.n).toBe(2);
    });
  });
});
