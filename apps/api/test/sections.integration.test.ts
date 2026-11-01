import type {
  Course,
  EnrollResult,
  SectionDetails,
  SectionSummary,
  StudentClass,
  Term,
} from '@lead/schema';
import { randomInt } from 'node:crypto';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { createUser, TEST_PASSWORD } from './test-users';

describe('sections and enrollment (integration)', () => {
  let testApp: TestApp;
  let sql: Sql;
  let adminToken: string;
  let course: Course;
  let term: Term;
  const server = () => testApp.server();

  async function tokenFor(email: string): Promise<string> {
    const response = await request(server())
      .post('/api/auth/sign-in')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  const call = (method: 'get' | 'post' | 'patch', path: string, token = adminToken) => {
    const url = `/api${path}`;
    const req =
      method === 'get'
        ? request(server()).get(url)
        : method === 'post'
          ? request(server()).post(url)
          : request(server()).patch(url);
    return req.set('Authorization', `Bearer ${token}`);
  };

  async function createSection(
    capacity = 40,
    name = `BSIS ${randomInt(1, 4)}-${randomInt(100, 999)}`,
  ) {
    const response = await call('post', '/admin/sections')
      .send({ courseCode: course.code.toLowerCase(), termId: term.id, name, capacity })
      .expect(201);
    return response.body as SectionSummary;
  }

  async function lastAudit(action: string, sectionId: string) {
    const [row] = await sql`
      select reason, before, after from audit_events
      where action = ${action} and target_id = ${sectionId}
      order by occurred_at desc limit 1`;
    return row;
  }

  beforeAll(async () => {
    testApp = await createTestApp();
    sql = testApp.app.get<Sql>(SQL_CLIENT);
    adminToken = await tokenFor(await createUser(sql, { role: 'admin' }));
    course = (
      await call('post', '/admin/courses')
        .send({
          code: `IS ${randomInt(100_000, 999_999)}`,
          title: 'Database Systems',
          units: 3,
          programId: null,
        })
        .expect(201)
    ).body as Course;
    const start = randomInt(2200, 9000);
    term = (
      await call('post', '/admin/terms')
        .send({
          schoolYear: `${start}-${start + 1}`,
          semester: 'first',
          startsOn: `${start}-08-10`,
          endsOn: `${start}-12-18`,
        })
        .expect(201)
    ).body as Term;
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('sections', () => {
    it('creates a section for a course and term, and refuses the same name twice', async () => {
      const section = await createSection(35, 'BSIS 3-A');

      expect(section).toMatchObject({
        name: 'BSIS 3-A',
        capacity: 35,
        enrolled: 0,
        course: { code: course.code },
        term: { id: term.id },
        teachers: [],
      });
      await call('post', '/admin/sections')
        .send({ courseCode: course.code, termId: term.id, name: 'bsis 3-a', capacity: 30 })
        .expect(409);
      expect(await lastAudit('section.created', section.id)).toBeTruthy();
    });

    it('refuses an unknown or archived course', async () => {
      await call('post', '/admin/sections')
        .send({ courseCode: 'ZZ 999999', termId: term.id, name: 'X', capacity: 10 })
        .expect(404);

      const archived = (
        await call('post', '/admin/courses')
          .send({
            code: `AR ${randomInt(100_000, 999_999)}`,
            title: 'Old course',
            units: 3,
            programId: null,
          })
          .expect(201)
      ).body as Course;
      await call('post', `/admin/courses/${archived.id}/archive`)
        .send({ reason: 'Phased out' })
        .expect(200);
      await call('post', '/admin/sections')
        .send({ courseCode: archived.code, termId: term.id, name: 'X', capacity: 10 })
        .expect(409);
    });

    it('is for administrators only, and lists a term', async () => {
      const section = await createSection();
      const teacherToken = await tokenFor(await createUser(sql, { role: 'teacher' }));
      await call('get', '/admin/sections', teacherToken).expect(403);

      const list = (
        await call(
          'get',
          `/admin/sections?term=${term.id}&q=${encodeURIComponent(section.name)}`,
        ).expect(200)
      ).body as { items: SectionSummary[]; termId: string };
      expect(list.termId).toBe(term.id);
      expect(list.items.map((item) => item.id)).toContain(section.id);
    });
  });

  describe('teachers', () => {
    it('assigns only active teacher accounts, once', async () => {
      const section = await createSection();
      const teacherEmail = await createUser(sql, { role: 'teacher' });
      const studentEmail = await createUser(sql, { role: 'student' });

      await call('post', `/admin/sections/${section.id}/teachers`)
        .send({ email: studentEmail })
        .expect(409);
      await call('post', `/admin/sections/${section.id}/teachers`)
        .send({ email: 'nobody@lead.test' })
        .expect(404);
      const assigned = (
        await call('post', `/admin/sections/${section.id}/teachers`)
          .send({ email: teacherEmail })
          .expect(200)
      ).body as SectionDetails;
      expect(assigned.teachers.map((teacher) => teacher.email)).toEqual([teacherEmail]);
      await call('post', `/admin/sections/${section.id}/teachers`)
        .send({ email: teacherEmail })
        .expect(409);
    });

    it("shows a teacher their own classes only, and hides everyone else's", async () => {
      const mine = await createSection();
      const other = await createSection();
      const teacherEmail = await createUser(sql, { role: 'teacher' });
      await call('post', `/admin/sections/${mine.id}/teachers`)
        .send({ email: teacherEmail })
        .expect(200);
      const teacherToken = await tokenFor(teacherEmail);

      const classes = (
        await call('get', `/teacher/classes?term=${term.id}`, teacherToken).expect(200)
      ).body as SectionSummary[];
      expect(classes.map((item) => item.id)).toEqual([mine.id]);
      await call('get', `/teacher/classes/${mine.id}`, teacherToken).expect(200);
      await call('get', `/teacher/classes/${other.id}`, teacherToken).expect(404);
      await call('get', '/admin/sections', teacherToken).expect(403);

      const [teacher] = await sql`select id from users where email = ${teacherEmail}`;
      await call(
        'post',
        `/admin/sections/${mine.id}/teachers/${teacher?.id as string}/remove`,
      ).expect(200);
      await call('get', `/teacher/classes/${mine.id}`, teacherToken).expect(404);
    });
  });

  describe('enrollment', () => {
    it('enrolls students in bulk and explains every skipped email', async () => {
      const section = await createSection(2);
      const [first, second, third] = [
        await createUser(sql),
        await createUser(sql),
        await createUser(sql),
      ];
      const pending = await createUser(sql, { status: 'pending' });
      const teacher = await createUser(sql, { role: 'teacher' });

      const result = (
        await call('post', `/admin/sections/${section.id}/enrollments`)
          .send({ emails: `${first}, ${second}\n${third}; ${pending} ${teacher} ghost@lead.test` })
          .expect(200)
      ).body as EnrollResult;

      expect(result.added).toEqual([first, second]);
      expect(result.skipped).toEqual([
        { email: third, reason: 'section_full' },
        { email: pending, reason: 'not_active' },
        { email: teacher, reason: 'not_a_student' },
        { email: 'ghost@lead.test', reason: 'not_found' },
      ]);

      const again = (
        await call('post', `/admin/sections/${section.id}/enrollments`)
          .send({ emails: first })
          .expect(200)
      ).body as EnrollResult;
      expect(again.skipped).toEqual([{ email: first, reason: 'already_enrolled' }]);
    });

    it('drops with a reason, keeps the history, and can enroll the student again', async () => {
      const section = await createSection(1);
      const student = await createUser(sql);
      await call('post', `/admin/sections/${section.id}/enrollments`)
        .send({ emails: student })
        .expect(200);
      const [row] = await sql`select id from users where email = ${student}`;
      const studentId = row?.id as string;

      await call('post', `/admin/sections/${section.id}/enrollments/${studentId}/drop`)
        .send({})
        .expect(400);
      const afterDrop = (
        await call('post', `/admin/sections/${section.id}/enrollments/${studentId}/drop`)
          .send({ reason: 'Transferred to BSIS 3-B' })
          .expect(200)
      ).body as SectionDetails;

      expect(afterDrop.enrolled).toBe(0);
      expect(afterDrop.roster).toEqual([
        expect.objectContaining({ email: student, status: 'dropped' }),
      ]);
      expect(await lastAudit('enrollment.dropped', section.id)).toMatchObject({
        reason: 'Transferred to BSIS 3-B',
      });

      // The freed seat can be used again, by the same student.
      const result = (
        await call('post', `/admin/sections/${section.id}/enrollments`)
          .send({ emails: student })
          .expect(200)
      ).body as EnrollResult;
      expect(result.added).toEqual([student]);
      expect(await lastAudit('enrollment.added', section.id)).toMatchObject({
        before: { studentId, status: 'dropped' },
        after: { studentId, status: 'enrolled' },
      });
    });

    it('shows teachers only the students enrolled now', async () => {
      const section = await createSection();
      const [staying, leaving] = [await createUser(sql), await createUser(sql)];
      const teacher = await createUser(sql, { role: 'teacher' });
      await call('post', `/admin/sections/${section.id}/teachers`)
        .send({ email: teacher })
        .expect(200);
      await call('post', `/admin/sections/${section.id}/enrollments`)
        .send({ emails: `${staying},${leaving}` })
        .expect(200);
      const [row] = await sql`select id from users where email = ${leaving}`;
      await call('post', `/admin/sections/${section.id}/enrollments/${row?.id as string}/drop`)
        .send({ reason: 'Shifted to BSTM' })
        .expect(200);

      const details = (
        await call('get', `/teacher/classes/${section.id}`, await tokenFor(teacher)).expect(200)
      ).body as SectionDetails;
      expect(details.roster.map((entry) => entry.email)).toEqual([staying]);
    });

    it('does not enroll a student whose account is being deactivated at the same time', async () => {
      const section = await createSection();
      const student = await createUser(sql);

      // Hold the account row as a deactivation would, change it, and only then let enrollment read it.
      let pending: Promise<request.Response> | undefined;
      await sql.begin(async (tx) => {
        await tx`select id from users where email = ${student} for no key update`;
        // Supertest sends on then(); start the request now so it runs while the row is held.
        pending = Promise.resolve(
          call('post', `/admin/sections/${section.id}/enrollments`).send({ emails: student }),
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        await tx`update users set status = 'deactivated' where email = ${student}`;
      });
      const result = (await pending)?.body as EnrollResult;

      expect(result.added).toEqual([]);
      expect(result.skipped).toEqual([{ email: student, reason: 'not_active' }]);
    });

    it('will not lower the capacity below the students already enrolled', async () => {
      const section = await createSection(3);
      const students = [await createUser(sql), await createUser(sql)];
      await call('post', `/admin/sections/${section.id}/enrollments`)
        .send({ emails: students.join(',') })
        .expect(200);

      await call('patch', `/admin/sections/${section.id}`).send({ capacity: 1 }).expect(409);
      const updated = (
        await call('patch', `/admin/sections/${section.id}`)
          .send({ capacity: 2, name: 'BSIS 3-Z' })
          .expect(200)
      ).body as SectionSummary;
      expect(updated).toMatchObject({ capacity: 2, name: 'BSIS 3-Z' });
    });

    it('never overfills a section when two enrollments arrive at once', async () => {
      const section = await createSection(1);
      const [first, second] = [await createUser(sql), await createUser(sql)];

      // Hold the section row so both requests are waiting on it, then release them together.
      let pending: Promise<request.Response[]> | undefined;
      await sql.begin(async (tx) => {
        await tx`select id from sections where id = ${section.id} for update`;
        pending = Promise.all([
          call('post', `/admin/sections/${section.id}/enrollments`).send({ emails: first }),
          call('post', `/admin/sections/${section.id}/enrollments`).send({ emails: second }),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      const results = (await (pending ?? Promise.resolve([]))).map(
        (response) => response.body as EnrollResult,
      );

      expect(results.flatMap((result) => result.added)).toHaveLength(1);
      expect(results.flatMap((result) => result.skipped.map((skip) => skip.reason))).toEqual([
        'section_full',
      ]);
      const [row] = await sql`
        select count(*)::int as n from enrollments where section_id = ${section.id} and status = 'enrolled'`;
      expect(row?.n).toBe(1);
    });

    it("shows a student their enrolled classes, with the class's teachers", async () => {
      const section = await createSection();
      const student = await createUser(sql);
      const teacher = await createUser(sql, { role: 'teacher' });
      await call('post', `/admin/sections/${section.id}/teachers`)
        .send({ email: teacher })
        .expect(200);
      await call('post', `/admin/sections/${section.id}/enrollments`)
        .send({ emails: student })
        .expect(200);
      const studentToken = await tokenFor(student);

      const classes = (await call('get', '/student/classes', studentToken).expect(200))
        .body as StudentClass[];

      expect(classes).toEqual([
        expect.objectContaining({
          id: section.id,
          course: expect.objectContaining({ code: course.code }) as unknown,
          teachers: [expect.objectContaining({ email: teacher })],
        }),
      ]);
      expect(classes[0]).not.toHaveProperty('capacity');

      // An older term's class comes after the newer one.
      const start = Number(term.schoolYear.slice(0, 4)) - 1;
      const older = (
        await call('post', '/admin/terms')
          .send({
            schoolYear: `${start}-${start + 1}`,
            semester: 'summer',
            startsOn: `${start + 1}-06-01`,
            endsOn: `${start + 1}-07-15`,
          })
          .expect(201)
      ).body as Term;
      const olderSection = (
        await call('post', '/admin/sections')
          .send({ courseCode: course.code, termId: older.id, name: 'BSIS 1-A', capacity: 40 })
          .expect(201)
      ).body as SectionSummary;
      await call('post', `/admin/sections/${olderSection.id}/enrollments`)
        .send({ emails: student })
        .expect(200);
      const both = (await call('get', '/student/classes', studentToken).expect(200))
        .body as StudentClass[];
      expect(both.map((item) => item.id)).toEqual([section.id, olderSection.id]);
      await call('get', '/teacher/classes', studentToken).expect(403);
    });
  });
});
