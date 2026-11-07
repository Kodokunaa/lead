import type {
  AssessmentDetails,
  AttemptResult,
  AttemptView,
  Course,
  CourseContent,
  GradingQueue,
  GradingView,
  SectionSummary,
} from '@lead/schema';
import { randomInt } from 'node:crypto';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { createTestTerm } from './test-terms';
import { createUser, TEST_PASSWORD } from './test-users';

const HOUR = 60 * 60 * 1000;
const at = (offset: number) => new Date(Date.now() + offset).toISOString();
const messageOf = (response: request.Response): string =>
  (response.body as { message: string }).message;

interface Quiz {
  readonly id: string;
  readonly sectionId: string;
}

describe('grading written quiz answers, T13–T14 and S11 (integration)', () => {
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

  const call = (method: 'get' | 'post' | 'patch' | 'put', path: string, token: string) =>
    request(server())[method](`/api${path}`).set('Authorization', `Bearer ${token}`);

  /** A published quiz: two multiple-choice questions (2 and 3 points) and, unless `noWritten`, one written (5). */
  async function quiz(studentEmails: string[], noWritten = false): Promise<Quiz> {
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
    await call('post', `/admin/sections/${section.id}/enrollments`, adminToken)
      .send({ emails: studentEmails.join(', ') })
      .expect(200);
    await call('post', `/teacher/content/${course.id}/objectives`, teacherToken)
      .send({ description: 'Apply normalization' })
      .expect(201);
    const { objectives } = (
      await call('get', `/teacher/content/${course.id}`, teacherToken).expect(200)
    ).body as CourseContent;
    const objectiveId = objectives[0]!.id;
    const created = (
      await call('post', '/teacher/assessments', teacherToken)
        .send({ sectionId: section.id, kind: 'quiz', title: 'Quiz 3' })
        .expect(201)
    ).body as AssessmentDetails;
    const base = `/teacher/assessments/${created.id}`;
    await call('patch', base, teacherToken)
      .send({
        objectiveIds: [objectiveId],
        opensAt: at(-HOUR),
        dueAt: at(72 * HOUR),
        maxAttempts: 2,
      })
      .expect(200);
    for (const [prompt, points] of [
      ['First', 2],
      ['Second', 3],
    ] as const) {
      await call('post', `${base}/questions`, teacherToken)
        .send({
          kind: 'multiple_choice',
          prompt,
          points,
          objectiveId,
          choices: [
            { text: 'Right', correct: true },
            { text: 'Wrong', correct: false },
          ],
        })
        .expect(201);
    }
    if (!noWritten) {
      await call('post', `${base}/questions`, teacherToken)
        .send({ kind: 'written', prompt: 'Explain 2NF.', points: 5, objectiveId })
        .expect(201);
    }
    await call('post', `${base}/publish`, teacherToken).expect(200);
    return { id: created.id, sectionId: section.id };
  }

  /** Answers question 1 right, question 2 wrong, and the written one; returns the attempt. */
  async function takeQuiz(id: string, student: string, submit = true): Promise<AttemptView> {
    const view = (await call('post', `/student/assessments/${id}/attempts`, student).expect(200))
      .body as AttemptView;
    const choose = (index: number, text: string) =>
      call('put', `/student/attempts/${view.id}/answers/${view.questions[index]!.id}`, student)
        .send({ choiceId: view.questions[index]!.choices.find((item) => item.text === text)!.id })
        .expect(200);
    await choose(0, 'Right');
    await choose(1, 'Wrong');
    if (view.questions[2]) {
      await call('put', `/student/attempts/${view.id}/answers/${view.questions[2].id}`, student)
        .send({ text: 'No partial dependencies.' })
        .expect(200);
    }
    if (submit) await call('post', `/student/attempts/${view.id}/submit`, student).expect(200);
    return view;
  }

  beforeAll(async () => {
    testApp = await createTestApp();
    sql = testApp.app.get<Sql>(SQL_CLIENT);
    adminToken = await tokenFor(await createUser(sql, { role: 'admin' }));
    teacherEmail = await createUser(sql, { role: 'teacher' });
    teacherToken = await tokenFor(teacherEmail);
    await createTestTerm(server(), adminToken, { current: true });
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('grades written answers, releases the quiz result and changes it with a reason', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const [user] = await sql`select id from users where email = ${email}`;
    const studentId = user?.id as string;
    const work = await quiz([email]);
    const choiceOnly = await quiz([email], true);
    const attempt = await takeQuiz(work.id, student);
    await takeQuiz(choiceOnly.id, student);

    const queue = (await call('get', '/teacher/grading', teacherToken).expect(200))
      .body as GradingQueue;
    expect(queue.items.filter((item) => item.studentId === studentId)).toEqual([
      expect.objectContaining({ assessmentId: work.id, kind: 'quiz', status: 'needs_review' }),
    ]);

    // Multiple choice only: scored automatically, nothing for a teacher to grade.
    await call('get', `/teacher/grading/${choiceOnly.id}/students/${studentId}`, teacherToken)
      .expect(409)
      .expect((response) =>
        expect(messageOf(response)).toBe(
          'This assessment has no written questions: multiple choice is scored automatically.',
        ),
      );

    const path = `/teacher/grading/${work.id}/students/${studentId}`;
    const view = (await call('get', path, teacherToken).expect(200)).body as GradingView;
    expect(view.attempt).toMatchObject({ id: attempt.id, number: 1, score: 2, scoredPoints: 5 });
    expect(view.points).toBe(10);
    expect(view.attempt?.questions.map((question) => [question.answer, question.correct])).toEqual([
      ['Right', true],
      ['Wrong', false],
      ['No partial dependencies.', null],
    ]);
    const written = view.attempt!.questions[2]!.id;

    const grade = (body: object) => call('put', path, teacherToken).send(body);
    await grade({ questionPoints: {}, feedback: '' })
      .expect(400)
      .expect((response) => expect(messageOf(response)).toBe('Give points for question 3.'));
    await grade({ questionPoints: { [written]: 6 }, feedback: '' })
      .expect(400)
      .expect((response) =>
        expect(messageOf(response)).toBe('Question 3 is worth at most 5 points.'),
      );
    const draft = (
      await grade({ questionPoints: { [written]: 4 }, feedback: 'Good start.' }).expect(200)
    ).body as GradingView;
    expect(draft.grade).toMatchObject({ status: 'draft', score: 6, attemptId: attempt.id });
    const before = (
      await call('get', `/student/attempts/${attempt.id}/result`, student).expect(200)
    ).body as AttemptResult;
    expect(before.grade).toBeNull();

    await grade({
      questionPoints: { [written]: 4 },
      feedback: 'Good start.',
      release: true,
    }).expect(200);
    const released = (
      await call('get', `/student/attempts/${attempt.id}/result`, student).expect(200)
    ).body as AttemptResult;
    expect(released.grade).toMatchObject({
      score: 6,
      maxPoints: 10,
      feedback: 'Good start.',
      written: [{ position: 3, points: 4, maxPoints: 5 }],
    });

    await grade({ questionPoints: { [written]: 5 }, feedback: 'Good start.' })
      .expect(400)
      .expect((response) =>
        expect(messageOf(response)).toBe('Give a reason for changing a released grade.'),
      );
    await grade({
      questionPoints: { [written]: 5 },
      feedback: 'Good start.',
      reason: 'Answer was complete on second reading',
    }).expect(200);
    const [changed] = await sql`
      select reason, after from audit_events
      where action = 'grade.changed_after_release' and target_id in (
        select id::text from grades where attempt_id = ${attempt.id})
      order by occurred_at desc limit 1`;
    expect(changed?.reason).toBe('Answer was complete on second reading');
    expect((changed?.after as { score: number }).score).toBe(7);

    // A new attempt needs another look.
    await takeQuiz(work.id, student);
    const again = (
      await call('get', `/teacher/grading?section=${work.sectionId}`, teacherToken).expect(200)
    ).body as GradingQueue;
    expect(again.items[0]?.status).toBe('needs_review');
  });

  it('grades an attempt the student left open past its deadline', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const [user] = await sql`select id from users where email = ${email}`;
    const work = await quiz([email]);
    const attempt = await takeQuiz(work.id, student, false);
    await sql`update attempts set deadline_at = now() - interval '1 minute' where id = ${attempt.id}`;

    const queue = (
      await call('get', `/teacher/grading?section=${work.sectionId}`, teacherToken).expect(200)
    ).body as GradingQueue;
    expect(queue.items[0]?.status).toBe('needs_review');
    const view = (
      await call(
        'get',
        `/teacher/grading/${work.id}/students/${user?.id as string}`,
        teacherToken,
      ).expect(200)
    ).body as GradingView;
    expect(view.attempt).toMatchObject({ id: attempt.id, autoSubmitted: true, score: 2 });
    const [closed] = await sql`
      select after from audit_events
      where action = 'attempt.submitted' and target_id = ${attempt.id}`;
    const [teacher] = await sql`select id from users where email = ${teacherEmail}`;
    expect((closed?.after as { closedByTeacher: string }).closedByTeacher).toBe(teacher?.id);
  });

  it('keeps one grade when two saves arrive at once', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const [user] = await sql`select id from users where email = ${email}`;
    const work = await quiz([email]);
    const attempt = await takeQuiz(work.id, student);
    const path = `/teacher/grading/${work.id}/students/${user?.id as string}`;
    const view = (await call('get', path, teacherToken).expect(200)).body as GradingView;
    const written = view.attempt!.questions[2]!.id;
    const [teacher] = await sql`select id from users where email = ${teacherEmail}`;
    let pending: Promise<request.Response[]> | undefined;
    await sql.begin(async (tx) => {
      // Both saves wait on the teacher's assignment row, then run at the same moment.
      await tx`select section_id from teaching_assignments
               where section_id = ${work.sectionId} and teacher_id = ${teacher?.id as string}
               for update`;
      pending = Promise.all(
        [3, 4].map((points) =>
          Promise.resolve(
            call('put', path, teacherToken).send({
              questionPoints: { [written]: points },
              feedback: '',
            }),
          ),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const responses = await (pending ?? Promise.resolve([]));
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const [count] =
      await sql`select count(*)::int as n from grades where attempt_id = ${attempt.id}`;
    expect(count?.n).toBe(1);
  });

  it('keeps quiz grading to the class', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const [user] = await sql`select id from users where email = ${email}`;
    const work = await quiz([email]);
    const path = `/teacher/grading/${work.id}/students/${user?.id as string}`;
    await call('put', path, teacherToken)
      .send({ questionPoints: {}, feedback: '' })
      .expect(409)
      .expect((response) =>
        expect(messageOf(response)).toBe('There is no submitted attempt to grade yet.'),
      );
    await takeQuiz(work.id, student);
    const otherTeacher = await tokenFor(await createUser(sql, { role: 'teacher' }));
    await call('get', path, otherTeacher).expect(404);
    await call('put', path, otherTeacher).send({ questionPoints: {}, feedback: '' }).expect(404);
    await call('get', path, student).expect(403);
  });
});
