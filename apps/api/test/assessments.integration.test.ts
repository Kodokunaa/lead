import type {
  AssessmentDetails,
  AssessmentList,
  Course,
  CourseContent,
  SectionSummary,
} from '@lead/schema';
import { randomInt, randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { createTestTerm } from './test-terms';
import { auditCount, createUser, TEST_PASSWORD } from './test-users';

const messageOf = (response: request.Response): string =>
  (response.body as { message: string }).message;

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

interface TestClass {
  readonly course: Course;
  readonly section: SectionSummary;
  readonly objectives: CourseContent['objectives'];
}

describe('assessments, T08–T12 (integration)', () => {
  let testApp: TestApp;
  let sql: Sql;
  let adminToken: string;
  let teacherToken: string;
  let teacherEmail: string;
  let own: TestClass;
  const server = () => testApp.server();

  async function tokenFor(email: string): Promise<string> {
    const response = await request(server())
      .post('/api/auth/sign-in')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  const call = (method: 'get' | 'post' | 'patch' | 'put', path: string, token = teacherToken) =>
    request(server())[method](`/api${path}`).set('Authorization', `Bearer ${token}`);

  /** A fresh course this term with one section taught by the shared teacher, and two objectives. */
  async function newClass(): Promise<TestClass> {
    const course = (
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
          courseCode: course.code,
          termId: term?.id as string,
          name: 'BSIS 3-A',
          capacity: 40,
        })
        .expect(201)
    ).body as SectionSummary;
    await call('post', `/admin/sections/${section.id}/teachers`, adminToken)
      .send({ email: teacherEmail })
      .expect(200);
    for (const description of ['Explain dependencies', 'Apply normalization']) {
      await call('post', `/teacher/content/${course.id}/objectives`)
        .send({ description })
        .expect(201);
    }
    const content = (await call('get', `/teacher/content/${course.id}`).expect(200))
      .body as CourseContent;
    return { course, section, objectives: content.objectives };
  }

  async function create(kind: string, title = 'Quiz 3', at = own): Promise<AssessmentDetails> {
    return (
      await call('post', '/teacher/assessments')
        .send({ sectionId: at.section.id, kind, title })
        .expect(201)
    ).body as AssessmentDetails;
  }

  const ready = (at = own) => ({
    objectiveIds: [at.objectives[1]!.id],
    opensAt: inDays(1),
    dueAt: inDays(3),
  });

  const choiceQuestion = (
    objectiveId: string | null,
    prompt = 'Which change removes a partial dependency?',
  ) => ({
    kind: 'multiple_choice',
    prompt,
    points: 2,
    difficulty: 'moderate',
    objectiveId,
    choices: [
      { text: 'Separate attributes dependent on part of a key', correct: true },
      { text: 'Keep every attribute together', correct: false },
    ],
  });

  beforeAll(async () => {
    testApp = await createTestApp();
    sql = testApp.app.get<Sql>(SQL_CLIENT);
    adminToken = await tokenFor(await createUser(sql, { role: 'admin' }));
    teacherEmail = await createUser(sql, { role: 'teacher' });
    teacherToken = await tokenFor(teacherEmail);
    // A current term of its own; test files run one at a time, so nothing else moves it meanwhile.
    await createTestTerm(server(), adminToken, { current: true });
    own = await newClass();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('access', () => {
    it("lists the teacher's classes and assessments, and hides everyone else's", async () => {
      const quiz = await create('quiz');
      const list = (await call('get', `/teacher/assessments?section=${own.section.id}`).expect(200))
        .body as AssessmentList;
      expect(list.classes).toContainEqual(
        expect.objectContaining({ id: own.section.id, courseCode: own.course.code }),
      );
      expect(list.items.map((item) => item.id)).toContain(quiz.id);

      const outsider = await tokenFor(await createUser(sql, { role: 'teacher' }));
      await call('get', `/teacher/assessments/${quiz.id}`, outsider).expect(404);
      await call('patch', `/teacher/assessments/${quiz.id}`, outsider)
        .send({ title: 'Mine now' })
        .expect(404);
      await call('post', '/teacher/assessments', outsider)
        .send({ sectionId: own.section.id, kind: 'quiz', title: 'Sneaky' })
        .expect(404);
      const outsiderList = (await call('get', '/teacher/assessments', outsider).expect(200))
        .body as AssessmentList;
      expect(outsiderList.items).toEqual([]);

      const student = await tokenFor(await createUser(sql));
      await call('get', `/teacher/assessments/${quiz.id}`, student).expect(403);
      await call('get', `/teacher/assessments/${randomUUID()}`).expect(404);
      await call('get', '/teacher/assessments/not-a-uuid').expect(400);
      await call('get', '/teacher/assessments?section=nope').expect(400);
    });
  });

  describe('quiz', () => {
    it('is built, checked, published, locked and unpublished', async () => {
      const quiz = await create('quiz');
      expect(quiz).toMatchObject({ status: 'draft', points: 0, maxAttempts: 1, enrolled: 0 });
      expect(quiz.checklist.filter((item) => !item.ok).map((item) => item.fix)).toEqual([
        'settings',
        'questions',
        'settings',
      ]);
      await call('post', `/teacher/assessments/${quiz.id}/publish`)
        .expect(409)
        .expect((response) =>
          expect(messageOf(response)).toBe(
            'Map the assessment to at least one learning objective.',
          ),
        );

      await call('patch', `/teacher/assessments/${quiz.id}`)
        .send({ ...ready(), timeLimitMinutes: 20, maxAttempts: 2, instructions: 'Read carefully.' })
        .expect(200);
      const objective = own.objectives[1]!.id;
      await call('post', `/teacher/assessments/${quiz.id}/questions`)
        .send(choiceQuestion(objective))
        .expect(201);
      const withTwo = (
        await call('post', `/teacher/assessments/${quiz.id}/questions`)
          .send({ kind: 'written', prompt: 'Explain 2NF.', points: 5, objectiveId: objective })
          .expect(201)
      ).body as AssessmentDetails;
      expect(withTwo.points).toBe(7);
      expect(withTwo.questions.map((question) => question.kind)).toEqual([
        'multiple_choice',
        'written',
      ]);

      const moved = (
        await call(
          'post',
          `/teacher/assessments/${quiz.id}/questions/${withTwo.questions[1]!.id}/move`,
        )
          .send({ direction: 'up' })
          .expect(200)
      ).body as AssessmentDetails;
      expect(moved.questions.map((question) => question.kind)).toEqual([
        'written',
        'multiple_choice',
      ]);

      const published = (await call('post', `/teacher/assessments/${quiz.id}/publish`).expect(200))
        .body as AssessmentDetails;
      expect(published.status).toBe('published');
      expect(published.publishedAt).not.toBeNull();
      expect(published.objectiveCodes).toEqual(['O2']);
      expect(await auditCount(sql, 'assessment.published', teacherEmail)).toBeGreaterThan(0);

      // Published: read-only until unpublished.
      await call('patch', `/teacher/assessments/${quiz.id}`)
        .send({ title: 'Quiz 3b' })
        .expect(409)
        .expect((response) =>
          expect(messageOf(response)).toBe('Unpublish the assessment before changing it.'),
        );
      await call('post', `/teacher/assessments/${quiz.id}/questions`)
        .send(choiceQuestion(objective))
        .expect(409);

      await call('post', `/teacher/assessments/${quiz.id}/unpublish`).expect(200);
      const removed = (
        await call(
          'post',
          `/teacher/assessments/${quiz.id}/questions/${moved.questions[0]!.id}/remove`,
        ).expect(200)
      ).body as AssessmentDetails;
      expect(removed.status).toBe('draft');
      expect(removed.questions.map((question) => question.position)).toEqual([1]);
      expect(removed.points).toBe(2);
    });

    it('keeps questions and objectives consistent', async () => {
      const quiz = await create('quiz');
      const [first, second] = own.objectives;
      await call('post', `/teacher/assessments/${quiz.id}/questions`)
        .send(choiceQuestion(first!.id))
        .expect(409)
        .expect((response) =>
          expect(messageOf(response)).toBe("Choose one of this assessment's learning objectives."),
        );
      await call('patch', `/teacher/assessments/${quiz.id}`)
        .send({ objectiveIds: [second!.id] })
        .expect(200);
      const created = (
        await call('post', `/teacher/assessments/${quiz.id}/questions`)
          .send(choiceQuestion(second!.id))
          .expect(201)
      ).body as AssessmentDetails;
      await call('patch', `/teacher/assessments/${quiz.id}`)
        .send({ objectiveIds: [first!.id] })
        .expect(409)
        .expect((response) =>
          expect(messageOf(response)).toBe('Question 1 measures O2. Change that question first.'),
        );

      const other = await newClass();
      await call('patch', `/teacher/assessments/${quiz.id}`)
        .send({ objectiveIds: [other.objectives[0]!.id] })
        .expect(409);

      // A draft question may leave its objective open; publishing names it.
      await call('put', `/teacher/assessments/${quiz.id}/questions/${created.questions[0]!.id}`)
        .send(choiceQuestion(null))
        .expect(200);
      await call('patch', `/teacher/assessments/${quiz.id}`)
        .send({ opensAt: inDays(1), dueAt: inDays(2) })
        .expect(200);
      await call('post', `/teacher/assessments/${quiz.id}/publish`)
        .expect(409)
        .expect((response) =>
          expect(messageOf(response)).toBe('Question 1 needs a learning objective.'),
        );
    });

    it('explains invalid questions and settings', async () => {
      const quiz = await create('quiz');
      const objective = own.objectives[1]!.id;
      await call('patch', `/teacher/assessments/${quiz.id}`)
        .send({ objectiveIds: [objective] })
        .expect(200);
      const twoCorrect = {
        ...choiceQuestion(objective),
        choices: [
          { text: 'A', correct: true },
          { text: 'B', correct: true },
        ],
      };
      await call('post', `/teacher/assessments/${quiz.id}/questions`)
        .send(twoCorrect)
        .expect(400)
        .expect((response) =>
          expect(messageOf(response)).toBe('Mark exactly one choice as the correct answer.'),
        );
      await call('post', `/teacher/assessments/${quiz.id}/questions`)
        .send({ ...choiceQuestion(objective), prompt: '   ' })
        .expect(400)
        .expect((response) => expect(messageOf(response)).toBe('Write the question.'));

      await call('patch', `/teacher/assessments/${quiz.id}`)
        .send({ opensAt: inDays(3), dueAt: inDays(1) })
        .expect(400)
        .expect((response) =>
          expect(messageOf(response)).toBe('The due date must be after the opening date.'),
        );
      await call('patch', `/teacher/assessments/${quiz.id}`)
        .send({ dueAt: 'tomorrow' })
        .expect(400);
      await call('patch', `/teacher/assessments/${quiz.id}`)
        .send({ opensAt: inDays(-3), dueAt: inDays(-1) })
        .expect(200);
      await call('post', `/teacher/assessments/${quiz.id}/questions`)
        .send(choiceQuestion(objective))
        .expect(201);
      await call('post', `/teacher/assessments/${quiz.id}/publish`)
        .expect(409)
        .expect((response) =>
          expect(messageOf(response)).toBe('The due date has passed. Choose a later one.'),
        );
      await call('put', `/teacher/assessments/${quiz.id}/rubric`)
        .send({ criteria: [] })
        .expect(409);
    });

    it('numbers two questions added at once 1 and 2', async () => {
      const quiz = await create('quiz');
      const objective = own.objectives[1]!.id;
      await call('patch', `/teacher/assessments/${quiz.id}`)
        .send({ objectiveIds: [objective] })
        .expect(200);
      let pending: Promise<request.Response[]> | undefined;
      await sql.begin(async (tx) => {
        await tx`select id from assessments where id = ${quiz.id} for update`;
        pending = Promise.all([
          Promise.resolve(
            call('post', `/teacher/assessments/${quiz.id}/questions`).send(
              choiceQuestion(objective, 'First'),
            ),
          ),
          Promise.resolve(
            call('post', `/teacher/assessments/${quiz.id}/questions`).send(
              choiceQuestion(objective, 'Second'),
            ),
          ),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      const responses = await (pending ?? Promise.resolve([]));
      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      const details = (await call('get', `/teacher/assessments/${quiz.id}`).expect(200))
        .body as AssessmentDetails;
      expect(details.questions.map((question) => question.position)).toEqual([1, 2]);
    });
  });

  describe('assignment', () => {
    it('is scored with a rubric and published', async () => {
      const assignment = await create('assignment', 'Normalization exercise');
      await call('post', `/teacher/assessments/${assignment.id}/questions`)
        .send(choiceQuestion(own.objectives[1]!.id))
        .expect(409);
      await call('patch', `/teacher/assessments/${assignment.id}`)
        .send({ timeLimitMinutes: 30 })
        .expect(400);
      await call('put', `/teacher/assessments/${assignment.id}/rubric`)
        .send({
          criteria: [
            {
              name: 'Correctness',
              levels: [
                { label: 'Strong', points: 4, descriptor: 'All transformations correct' },
                { label: 'Needs work', points: 4 },
              ],
            },
          ],
        })
        .expect(400)
        .expect((response) =>
          expect(messageOf(response)).toBe('Give each level of a criterion different points.'),
        );

      const level = (label: string, points: number) => ({ label, points, descriptor: '' });
      const levels = [level('Strong', 4), level('Developing', 2), level('Needs work', 0)];
      const saved = (
        await call('put', `/teacher/assessments/${assignment.id}/rubric`)
          .send({
            criteria: [
              { name: 'Correctness', levels },
              { name: 'Explanation', levels },
              { name: 'Completeness', levels },
            ],
          })
          .expect(200)
      ).body as AssessmentDetails;
      expect(saved.points).toBe(12);
      expect(saved.rubric.map((criterion) => criterion.name)).toEqual([
        'Correctness',
        'Explanation',
        'Completeness',
      ]);
      expect(saved.checklist[1]).toMatchObject({ ok: true, detail: '3 criteria / 12 points' });

      await call('patch', `/teacher/assessments/${assignment.id}`).send(ready()).expect(200);
      await call('post', `/teacher/assessments/${assignment.id}/publish`).expect(200);
      const list = (await call('get', '/teacher/assessments').expect(200)).body as AssessmentList;
      expect(list.items.find((item) => item.id === assignment.id)).toMatchObject({
        status: 'published',
        points: 12,
        objectiveCodes: ['O2'],
      });
    });
  });

  it('answers 404, not a deadlock, when the teacher is removed while creating', async () => {
    const at = await newClass();
    const [teacher] = await sql`select id from users where email = ${teacherEmail}`;
    let pending: Promise<request.Response> | undefined;
    // As an administrator removing the teacher does: lock the section, then delete the assignment.
    await sql.begin(async (tx) => {
      await tx`select id from sections where id = ${at.section.id} for update`;
      pending = Promise.resolve(
        call('post', '/teacher/assessments').send({
          sectionId: at.section.id,
          kind: 'quiz',
          title: 'Racing',
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx`delete from teaching_assignments
               where section_id = ${at.section.id} and teacher_id = ${teacher?.id as string}`;
    });
    const response = await (pending ?? Promise.reject(new Error('not started')));
    expect(response.status).toBe(404);
  });

  it('refuses changes once the course is archived', async () => {
    const at = await newClass();
    const quiz = await create('quiz', 'Quiz 1', at);
    await call('post', `/admin/courses/${at.course.id}/archive`, adminToken)
      .send({ reason: 'Replaced by a new course' })
      .expect(200);
    await call('patch', `/teacher/assessments/${quiz.id}`).send({ title: 'Changed' }).expect(409);
    await call('post', '/teacher/assessments')
      .send({ sectionId: at.section.id, kind: 'quiz', title: 'New' })
      .expect(409);
    const list = (await call('get', '/teacher/assessments').expect(200)).body as AssessmentList;
    expect(list.classes.map((item) => item.id)).not.toContain(at.section.id);
  });
});
