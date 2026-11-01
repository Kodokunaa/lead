import type { Course, CourseListResponse, Program, Term } from '@lead/schema';
import { randomInt } from 'node:crypto';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CURRENT_TERM_LOCK } from '../src/catalog/catalog.service';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { createUser, TEST_PASSWORD } from './test-users';

/** A course code no earlier test run has used (the test database keeps rows between runs). */
function uniqueCode(prefix = 'T'): string {
  return `${prefix}${randomInt(100_000, 999_999)}`;
}

/** A school year far in the future, so runs never collide on (year, semester). */
function uniqueSchoolYear(): string {
  const start = randomInt(2200, 9000);
  return `${start}-${start + 1}`;
}

describe('course catalog (integration)', () => {
  let testApp: TestApp;
  let sql: Sql;
  let adminToken: string;
  let bsis: Program;
  const server = () => testApp.server();

  async function tokenFor(email: string): Promise<string> {
    const response = await request(server())
      .post('/api/auth/sign-in')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  const admin = (method: 'get' | 'post' | 'patch', path: string, token = adminToken) => {
    const url = `/api/admin${path}`;
    const call =
      method === 'get'
        ? request(server()).get(url)
        : method === 'post'
          ? request(server()).post(url)
          : request(server()).patch(url);
    return call.set('Authorization', `Bearer ${token}`);
  };

  async function createCourse(overrides: Record<string, unknown> = {}): Promise<Course> {
    const response = await admin('post', '/courses')
      .send({
        code: uniqueCode(),
        title: 'Database Systems',
        units: 3,
        programId: bsis.id,
        ...overrides,
      })
      .expect(201);
    return response.body as Course;
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
    const programs = (await admin('get', '/programs').expect(200)).body as Program[];
    const found = programs.find((program) => program.code === 'BSIS');
    if (!found) throw new Error('BSIS was not seeded');
    bsis = found;
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('programs', () => {
    it("lists CCC's seeded programs", async () => {
      const programs = (await admin('get', '/programs').expect(200)).body as Program[];
      const codes = programs.map((program) => program.code);
      for (const code of ['BPA', 'BSED Math', 'BSED Science', 'BSHM', 'BSIS', 'BSNED', 'BSTM']) {
        expect(codes).toContain(code);
      }
    });

    it('is for administrators only', async () => {
      const teacher = await tokenFor(await createUser(sql, { role: 'teacher' }));
      await admin('get', '/programs', teacher).expect(403);
      await request(server()).get('/api/admin/courses').expect(401);
    });

    it('refuses a duplicate code regardless of case', async () => {
      const response = await admin('post', '/programs')
        .send({ code: 'bsis', name: 'Duplicate of BSIS' })
        .expect(409);
      expect(response.body).toMatchObject({ message: 'A program with this code already exists.' });
    });

    it('creates and deactivates a program, and audits both', async () => {
      const code = `P${randomInt(10_000, 99_999)}`;
      const created = (
        await admin('post', '/programs').send({ code, name: 'Test Program' }).expect(201)
      ).body as Program;
      const updated = (
        await admin('patch', `/programs/${created.id}`).send({ active: false }).expect(200)
      ).body as Program;

      expect(updated).toMatchObject({ code, active: false });
      expect(await lastAudit('program.updated', created.id)).toMatchObject({
        before: { active: true },
        after: { active: false },
      });

      // A course cannot go under a program that is no longer offered.
      await admin('post', '/courses')
        .send({ code: uniqueCode(), title: 'Orphan', units: 3, programId: created.id })
        .expect(409);
    });
  });

  describe('terms', () => {
    it('creates a term and refuses the same semester twice', async () => {
      const schoolYear = uniqueSchoolYear();
      const startYear = schoolYear.slice(0, 4);
      const body = {
        schoolYear,
        semester: 'first',
        startsOn: `${startYear}-08-10`,
        endsOn: `${startYear}-12-18`,
      };

      const created = (await admin('post', '/terms').send(body).expect(201)).body as Term;
      expect(created).toMatchObject({ ...body, current: false });
      await admin('post', '/terms').send(body).expect(409);
      await admin('post', '/terms')
        .send({ ...body, endsOn: `${startYear}-01-01` })
        .expect(400);
    });

    it('keeps exactly one current term, even when two are chosen at once', async () => {
      const make = async (semester: 'first' | 'second') => {
        const year = uniqueSchoolYear();
        const start = year.slice(0, 4);
        return (
          await admin('post', '/terms')
            .send({
              schoolYear: year,
              semester,
              startsOn: `${start}-08-01`,
              endsOn: `${start}-12-01`,
            })
            .expect(201)
        ).body as Term;
      };
      const [first, second] = [await make('first'), await make('second')];

      // Hold the lock so both requests wait at the same point, then let them run.
      let pending: Promise<request.Response[]> | undefined;
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(${CURRENT_TERM_LOCK})`;
        pending = Promise.all([
          admin('post', `/terms/${first.id}/make-current`),
          admin('post', `/terms/${second.id}/make-current`),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      const responses = await (pending ?? Promise.resolve([]));

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const [currentCount] = await sql`select count(*)::int as n from academic_terms where current`;
      expect(currentCount?.n).toBe(1);
    });
  });

  describe('courses', () => {
    it('creates a course with a normalized code and its program', async () => {
      const code = uniqueCode('is ');
      const course = await createCourse({ code, description: 'Relational design and SQL.' });

      expect(course).toMatchObject({
        code: code.toUpperCase(),
        programId: bsis.id,
        programCode: 'BSIS',
        units: 3,
        archived: false,
      });
      expect(await lastAudit('course.created', course.id)).toBeTruthy();
    });

    it('refuses a duplicate code with a clear message', async () => {
      const course = await createCourse();
      const response = await admin('post', '/courses')
        .send({ code: course.code.toLowerCase(), title: 'Again', units: 3, programId: null })
        .expect(409);
      expect((response.body as { message: string }).message).toContain(course.code);
    });

    it('supports general education courses without a program', async () => {
      const course = await createCourse({ programId: null, title: 'Understanding the Self' });
      expect(course).toMatchObject({ programId: null, programCode: null });

      const general = (await admin('get', `/courses?program=general&q=${course.code}`).expect(200))
        .body as CourseListResponse;
      expect(general.items.map((item) => item.id)).toEqual([course.id]);
    });

    it('edits a course and records what changed', async () => {
      const course = await createCourse();
      const updated = (
        await admin('patch', `/courses/${course.id}`)
          .send({ title: 'Advanced Database Systems', units: 4 })
          .expect(200)
      ).body as Course;

      expect(updated).toMatchObject({ title: 'Advanced Database Systems', units: 4 });
      expect(await lastAudit('course.updated', course.id)).toMatchObject({
        before: { title: 'Database Systems', units: 3 },
        after: { title: 'Advanced Database Systems', units: 4 },
      });
    });

    it('changes only the fields sent: a title edit keeps the description', async () => {
      const course = await createCourse({ description: 'Relational design and SQL.' });

      const updated = (
        await admin('patch', `/courses/${course.id}`).send({ title: 'Databases I' }).expect(200)
      ).body as Course;

      expect(updated).toMatchObject({
        title: 'Databases I',
        description: 'Relational design and SQL.',
      });
      expect(await lastAudit('course.updated', course.id)).toMatchObject({
        before: { title: 'Database Systems' },
        after: { title: 'Databases I' },
      });
    });

    it('refuses an empty edit and records nothing for an edit that changes nothing', async () => {
      const course = await createCourse();

      await admin('patch', `/courses/${course.id}`).send({}).expect(400);
      await admin('patch', `/courses/${course.id}`).send({ title: course.title }).expect(200);
      await admin('patch', `/programs/${bsis.id}`).send({}).expect(400);

      const [row] = await sql`
        select count(*)::int as n from audit_events
        where action = 'course.updated' and target_id = ${course.id}`;
      expect(row?.n).toBe(0);
    });

    it('archives only with a reason, hides archived courses by default, and restores', async () => {
      const course = await createCourse();

      await admin('post', `/courses/${course.id}/archive`).send({}).expect(400);
      await admin('post', `/courses/${course.id}/archive`)
        .send({ reason: 'Replaced by the new curriculum' })
        .expect(200);
      await admin('post', `/courses/${course.id}/archive`).send({ reason: 'Again' }).expect(409);

      const active = (await admin('get', `/courses?q=${course.code}`).expect(200))
        .body as CourseListResponse;
      expect(active.items).toEqual([]);
      const archived = (await admin('get', `/courses?q=${course.code}&archived=true`).expect(200))
        .body as CourseListResponse;
      expect(archived.items.map((item) => item.archived)).toEqual([true]);
      expect(await lastAudit('course.archived', course.id)).toMatchObject({
        reason: 'Replaced by the new curriculum',
      });

      await admin('post', `/courses/${course.id}/restore`).expect(200);
    });

    it('treats search wildcards as plain text', async () => {
      const response = await admin('get', `/courses?q=${encodeURIComponent('%')}`).expect(200);
      expect((response.body as CourseListResponse).items).toEqual([]);
    });
  });
});
