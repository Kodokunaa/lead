import type { ClassCalendar, Course, SectionSummary, TermCalendar } from '@lead/schema';
import { randomInt } from 'node:crypto';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { createTestTerm, type TestTerm } from './test-terms';
import { createUser, TEST_PASSWORD } from './test-users';

describe('academic calendar (integration)', () => {
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

  const call = (method: 'get' | 'post' | 'patch' | 'put', path: string, token = adminToken) => {
    const url = `/api${path}`;
    const req =
      method === 'get'
        ? request(server()).get(url)
        : method === 'post'
          ? request(server()).post(url)
          : method === 'patch'
            ? request(server()).patch(url)
            : request(server()).put(url);
    return req.set('Authorization', `Bearer ${token}`);
  };

  /** A fresh term from Aug 10 to Dec 18 of an unused year, so tests never share one. */
  function newTerm(): Promise<TestTerm> {
    return createTestTerm(server(), adminToken);
  }

  async function newCourse(): Promise<Course> {
    return (
      await call('post', '/admin/courses')
        .send({
          code: `IS ${randomInt(100_000, 999_999)}`,
          title: 'Database Systems',
          units: 3,
          programId: null,
        })
        .expect(201)
    ).body as Course;
  }

  async function newSection(course: Course, termId: string): Promise<SectionSummary> {
    return (
      await call('post', '/admin/sections')
        .send({ courseCode: course.code, termId, name: 'BSIS 3-A', capacity: 40 })
        .expect(201)
    ).body as SectionSummary;
  }

  async function lastAudit(action: string, targetId: string) {
    const [row] = await sql`
      select before, after from audit_events
      where action = ${action} and target_id = ${targetId}
      order by occurred_at desc limit 1`;
    return row;
  }

  beforeAll(async () => {
    testApp = await createTestApp();
    sql = testApp.app.get<Sql>(SQL_CLIENT);
    adminToken = await tokenFor(await createUser(sql, { role: 'admin' }));
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('grading periods', () => {
    it('sets the periods in date order, within the term, and replaces them as a whole', async () => {
      const term = await newTerm();
      const y = term.year;
      const calendar = (
        await call('put', `/admin/terms/${term.id}/grading-periods`)
          .send({
            periods: [
              { name: 'Finals', startsOn: `${y}-11-16`, endsOn: `${y}-12-18` },
              { name: 'Prelim', startsOn: `${y}-08-10`, endsOn: `${y}-09-25` },
              { name: 'Midterm', startsOn: `${y}-09-28`, endsOn: `${y}-11-13` },
            ],
          })
          .expect(200)
      ).body as TermCalendar;
      expect(calendar.gradingPeriods.map((period) => [period.position, period.name])).toEqual([
        [1, 'Prelim'],
        [2, 'Midterm'],
        [3, 'Finals'],
      ]);

      await call('put', `/admin/terms/${term.id}/grading-periods`)
        .send({ periods: [{ name: 'Prelim', startsOn: `${y}-08-01`, endsOn: `${y}-09-25` }] })
        .expect(409);
      await call('put', `/admin/terms/${term.id}/grading-periods`)
        .send({
          periods: [
            { name: 'Prelim', startsOn: `${y}-08-10`, endsOn: `${y}-10-01` },
            { name: 'Midterm', startsOn: `${y}-09-28`, endsOn: `${y}-11-13` },
          ],
        })
        .expect(400);

      const replaced = (
        await call('put', `/admin/terms/${term.id}/grading-periods`)
          .send({
            periods: [
              { name: 'Midterm', startsOn: `${y}-08-10`, endsOn: `${y}-10-15` },
              { name: 'Finals', startsOn: `${y}-10-16`, endsOn: `${y}-12-18` },
            ],
          })
          .expect(200)
      ).body as TermCalendar;
      expect(replaced.gradingPeriods.map((period) => period.name)).toEqual(['Midterm', 'Finals']);
      expect(await lastAudit('grading_periods.set', term.id)).toMatchObject({
        before: { periods: [{ name: 'Prelim' }, { name: 'Midterm' }, { name: 'Finals' }] },
      });
    });
  });

  describe('events', () => {
    it('adds, edits and removes events, limited to courses offered this term', async () => {
      const term = await newTerm();
      const y = term.year;
      const offered = await newCourse();
      const notOffered = await newCourse();
      await newSection(offered, term.id);

      await call('post', `/admin/terms/${term.id}/events`)
        .send({
          title: 'Quiz week',
          kind: 'class_event',
          startsOn: `${y}-09-01`,
          courseIds: [notOffered.id],
        })
        .expect(409);
      await call('post', `/admin/terms/${term.id}/events`)
        .send({ title: 'Too late', kind: 'grade_release', startsOn: `${y}-12-19` })
        .expect(409);
      await call('post', `/admin/terms/${term.id}/events`)
        .send({ title: 'Typo', kind: 'grade_release', startsOn: '0000-01-01' })
        .expect(400);

      const created = (
        await call('post', `/admin/terms/${term.id}/events`)
          .send({
            title: 'Midterm examinations',
            kind: 'assessment_period',
            startsOn: `${y}-10-12`,
            endsOn: `${y}-10-16`,
            courseIds: [offered.id],
          })
          .expect(201)
      ).body as TermCalendar;
      expect(created.offerings).toEqual([
        expect.objectContaining({ id: offered.id, code: offered.code, sections: 1 }),
      ]);
      const event = created.events[0]!;
      expect(event).toMatchObject({
        title: 'Midterm examinations',
        courses: [{ id: offered.id, code: offered.code }],
      });

      const edited = (
        await call('put', `/admin/terms/${term.id}/events/${event.id}`)
          .send({
            title: 'Midterm examinations',
            kind: 'assessment_period',
            startsOn: `${y}-10-19`,
            endsOn: `${y}-10-23`,
            courseIds: [],
          })
          .expect(200)
      ).body as TermCalendar;
      expect(edited.events[0]).toMatchObject({ startsOn: `${y}-10-19`, courses: [] });
      expect(await lastAudit('calendar_event.updated', event.id)).toMatchObject({
        before: { startsOn: `${y}-10-12`, courseIds: [offered.id] },
      });

      const removed = (
        await call('post', `/admin/terms/${term.id}/events/${event.id}/remove`).expect(200)
      ).body as TermCalendar;
      expect(removed.events).toEqual([]);
      await call('post', `/admin/terms/${term.id}/events/${event.id}/remove`).expect(404);
    });

    it('is for administrators only', async () => {
      const term = await newTerm();
      const teacher = await tokenFor(await createUser(sql, { role: 'teacher' }));
      await call('get', `/admin/terms/${term.id}/calendar`, teacher).expect(403);
      await call('post', `/admin/terms/${term.id}/events`, teacher)
        .send({ title: 'Foundation day', kind: 'holiday', startsOn: `${term.year}-09-01` })
        .expect(403);
    });
  });

  describe('term dates', () => {
    it('moves the term only while everything still fits inside it', async () => {
      const term = await newTerm();
      const y = term.year;
      await call('post', `/admin/terms/${term.id}/events`)
        .send({ title: 'Grade release', kind: 'grade_release', startsOn: `${y}-12-18` })
        .expect(201);

      const refused = await call('patch', `/admin/terms/${term.id}`)
        .send({ startsOn: `${y}-08-10`, endsOn: `${y}-12-11` })
        .expect(409);
      expect((refused.body as { message: string }).message).toContain('Grade release');

      const moved = (
        await call('patch', `/admin/terms/${term.id}`)
          .send({ startsOn: `${y}-08-03`, endsOn: `${y}-12-23` })
          .expect(200)
      ).body as TermCalendar;
      expect(moved.term).toMatchObject({ startsOn: `${y}-08-03`, endsOn: `${y}-12-23` });
      expect(await lastAudit('term.dates_changed', term.id)).toMatchObject({
        before: { endsOn: `${y}-12-18` },
        after: { endsOn: `${y}-12-23` },
      });
    });

    it('never leaves an event outside the term when both change at once', async () => {
      const term = await newTerm();
      const y = term.year;

      // Hold the term row so both requests wait, then release them together. One of them must be
      // refused: either the event no longer fits, or the new dates would leave it outside.
      let pending: Promise<request.Response[]> | undefined;
      await sql.begin(async (tx) => {
        await tx`select id from academic_terms where id = ${term.id} for update`;
        pending = Promise.all([
          call('patch', `/admin/terms/${term.id}`).send({
            startsOn: `${y}-08-10`,
            endsOn: `${y}-12-01`,
          }),
          call('post', `/admin/terms/${term.id}/events`).send({
            title: 'Grade release',
            kind: 'grade_release',
            startsOn: `${y}-12-15`,
          }),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      const statuses = (await (pending ?? Promise.resolve([]))).map((response) => response.status);

      expect(statuses.filter((status) => status === 409)).toHaveLength(1);
      const [outside] = await sql`
        select count(*)::int as n from calendar_events e
        join academic_terms t on t.id = e.term_id
        where t.id = ${term.id} and e.starts_on > t.ends_on`;
      expect(outside?.n).toBe(0);
    });
  });

  describe('class calendar (T03)', () => {
    it("shows a teacher their class's term-wide and own-course events only", async () => {
      const term = await newTerm();
      const y = term.year;
      const mine = await newCourse();
      const other = await newCourse();
      const section = await newSection(mine, term.id);
      await newSection(other, term.id);
      const teacherEmail = await createUser(sql, { role: 'teacher' });
      await call('post', `/admin/sections/${section.id}/teachers`)
        .send({ email: teacherEmail })
        .expect(200);
      const teacher = await tokenFor(teacherEmail);

      for (const event of [
        { title: 'Foundation day', kind: 'holiday', startsOn: `${y}-09-01`, courseIds: [] },
        { title: 'My quiz', kind: 'class_event', startsOn: `${y}-09-10`, courseIds: [mine.id] },
        { title: 'Their quiz', kind: 'class_event', startsOn: `${y}-09-11`, courseIds: [other.id] },
      ]) {
        await call('post', `/admin/terms/${term.id}/events`).send(event).expect(201);
      }

      const calendar = (
        await call('get', `/teacher/classes/${section.id}/calendar`, teacher).expect(200)
      ).body as ClassCalendar;
      expect(calendar.term.id).toBe(term.id);
      expect(calendar.events.map((event) => event.title)).toEqual(['Foundation day', 'My quiz']);

      // An event shared with another course shows only this class's course.
      const shared = (
        await call('post', `/admin/terms/${term.id}/events`)
          .send({
            title: 'Joint quiz',
            kind: 'class_event',
            startsOn: `${y}-09-20`,
            courseIds: [mine.id, other.id],
          })
          .expect(201)
      ).body as TermCalendar;
      expect(shared.events.find((event) => event.title === 'Joint quiz')?.courses).toHaveLength(2);
      const seen = (
        await call('get', `/teacher/classes/${section.id}/calendar`, teacher).expect(200)
      ).body as ClassCalendar;
      expect(seen.events.find((event) => event.title === 'Joint quiz')?.courses).toEqual([
        { id: mine.id, code: mine.code },
      ]);

      const outsider = await tokenFor(await createUser(sql, { role: 'teacher' }));
      await call('get', `/teacher/classes/${section.id}/calendar`, outsider).expect(404);
    });
  });
});
