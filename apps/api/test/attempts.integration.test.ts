import type {
  AssessmentDetails,
  AttemptResult,
  AttemptView,
  Course,
  CourseContent,
  SectionSummary,
  StudentAssessmentDetails,
  StudentAssessmentSummary,
} from '@lead/schema';
import { randomInt, randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { createTestTerm } from './test-terms';
import { auditCount, createUser, TEST_PASSWORD } from './test-users';

const HOUR = 60 * 60 * 1000;
const at = (offset: number) => new Date(Date.now() + offset).toISOString();
const messageOf = (response: request.Response): string =>
  (response.body as { message: string }).message;

interface Quiz {
  readonly id: string;
  readonly sectionId: string;
  readonly details: AssessmentDetails;
}

describe('quiz attempts, S07–S11 (integration)', () => {
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

  /**
   * A published quiz in a fresh class with the given students enrolled: two multiple-choice
   * questions (2 and 3 points, O1) and one written question (5 points, O2).
   */
  async function quiz(
    studentEmails: string[],
    settings: Record<string, unknown> = {},
  ): Promise<Quiz> {
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
    if (studentEmails.length > 0) {
      await call('post', `/admin/sections/${section.id}/enrollments`, adminToken)
        .send({ emails: studentEmails.join(', ') })
        .expect(200);
    }
    for (const description of ['Explain dependencies', 'Apply normalization']) {
      await call('post', `/teacher/content/${course.id}/objectives`, teacherToken)
        .send({ description })
        .expect(201);
    }
    const { objectives } = (
      await call('get', `/teacher/content/${course.id}`, teacherToken).expect(200)
    ).body as CourseContent;
    const [o1, o2] = [objectives[0]!.id, objectives[1]!.id];
    const created = (
      await call('post', '/teacher/assessments', teacherToken)
        .send({ sectionId: section.id, kind: 'quiz', title: 'Quiz 3' })
        .expect(201)
    ).body as AssessmentDetails;
    const base = `/teacher/assessments/${created.id}`;
    await call('patch', base, teacherToken)
      .send({
        objectiveIds: [o1, o2],
        opensAt: at(-HOUR),
        dueAt: at(72 * HOUR),
        maxAttempts: 2,
        ...settings,
      })
      .expect(200);
    const choice = (prompt: string, points: number) => ({
      kind: 'multiple_choice',
      prompt,
      points,
      objectiveId: o1,
      choices: [
        { text: 'Right', correct: true },
        { text: 'Wrong', correct: false },
      ],
    });
    await call('post', `${base}/questions`, teacherToken).send(choice('First', 2)).expect(201);
    await call('post', `${base}/questions`, teacherToken).send(choice('Second', 3)).expect(201);
    await call('post', `${base}/questions`, teacherToken)
      .send({ kind: 'written', prompt: 'Explain 2NF.', points: 5, objectiveId: o2 })
      .expect(201);
    const details = (await call('post', `${base}/publish`, teacherToken).expect(200))
      .body as AssessmentDetails;
    return { id: created.id, sectionId: section.id, details };
  }

  const choiceId = (view: AttemptView, position: number, text: string) =>
    view.questions[position - 1]!.choices.find((choice) => choice.text === text)!.id;

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

  it('takes a quiz: answers are saved, multiple choice is scored, written waits', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const { id } = await quiz([email]);

    const list = (await call('get', '/student/assessments', student).expect(200))
      .body as StudentAssessmentSummary[];
    expect(list.find((item) => item.id === id)).toMatchObject({
      state: 'available',
      attemptsUsed: 0,
      maxAttempts: 2,
      objectiveCodes: ['O1', 'O2'],
    });
    const details = (await call('get', `/student/assessments/${id}`, student).expect(200))
      .body as StudentAssessmentDetails;
    expect(details).toMatchObject({ questionCount: 3, points: 10, blockedReason: null });

    const view = (await call('post', `/student/assessments/${id}/attempts`, student).expect(200))
      .body as AttemptView;
    expect(view).toMatchObject({ number: 1, status: 'in_progress', answers: [] });
    // The answer key never leaves the server.
    expect(JSON.stringify(view)).not.toContain('correct');
    const again = (await call('post', `/student/assessments/${id}/attempts`, student).expect(200))
      .body as AttemptView;
    expect(again.id).toBe(view.id);

    const answer = (questionPosition: number, body: object) =>
      call(
        'put',
        `/student/attempts/${view.id}/answers/${view.questions[questionPosition - 1]!.id}`,
        student,
      ).send(body);
    await answer(1, { choiceId: choiceId(view, 1, 'Wrong') }).expect(200);
    await answer(1, { choiceId: choiceId(view, 1, 'Right') }).expect(200);
    await answer(2, { choiceId: choiceId(view, 2, 'Wrong') }).expect(200);
    await answer(3, { text: 'A relation is in 2NF when…' }).expect(200);
    await answer(1, { choiceId: choiceId(view, 2, 'Right') }).expect(404);
    await answer(3, { text: 'x'.repeat(10_001) })
      .expect(400)
      .expect((response) =>
        expect(messageOf(response)).toBe('Keep the answer under 10,000 characters.'),
      );
    const reopened = (await call('get', `/student/attempts/${view.id}`, student).expect(200))
      .body as AttemptView;
    expect(reopened.answers).toHaveLength(3);
    await call('get', `/student/attempts/${view.id}/result`, student).expect(409);

    const result = (await call('post', `/student/attempts/${view.id}/submit`, student).expect(200))
      .body as AttemptResult;
    expect(result).toMatchObject({
      number: 1,
      autoSubmitted: false,
      answered: 3,
      questionCount: 3,
      score: 2,
      scoredPoints: 5,
      pendingPoints: 5,
      attemptsUsed: 1,
      canRetake: true,
      objectives: [
        { code: 'O1', correct: 1, scored: 2, pending: 0 },
        { code: 'O2', correct: 0, scored: 0, pending: 1 },
      ],
    });
    expect(await auditCount(sql, 'attempt.submitted', email)).toBe(1);
    await answer(1, { choiceId: null })
      .expect(409)
      .expect((response) =>
        expect(messageOf(response)).toBe('This attempt was already submitted.'),
      );
    // Submitting twice returns the same result.
    await call('post', `/student/attempts/${view.id}/submit`, student).expect(200);

    const second = (await call('post', `/student/assessments/${id}/attempts`, student).expect(200))
      .body as AttemptView;
    expect(second).toMatchObject({ number: 2, answers: [] });
    await call('post', `/student/attempts/${second.id}/submit`, student).expect(200);
    await call('post', `/student/assessments/${id}/attempts`, student)
      .expect(409)
      .expect((response) => expect(messageOf(response)).toBe('You have used all your attempts.'));
    const after = (await call('get', '/student/assessments', student).expect(200))
      .body as StudentAssessmentSummary[];
    expect(after.find((item) => item.id === id)?.state).toBe('submitted');
  });

  it('shows students only published quizzes of classes they are enrolled in', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const { id, sectionId } = await quiz([email]);
    const view = (await call('post', `/student/assessments/${id}/attempts`, student).expect(200))
      .body as AttemptView;

    const outsider = await tokenFor(await createUser(sql));
    await call('get', `/student/assessments/${id}`, outsider).expect(404);
    await call('post', `/student/assessments/${id}/attempts`, outsider).expect(404);
    await call('get', `/student/attempts/${view.id}`, outsider).expect(404);
    await call('put', `/student/attempts/${view.id}/answers/${view.questions[0]!.id}`, outsider)
      .send({ choiceId: null })
      .expect(404);
    await call('get', `/student/assessments/${id}`, teacherToken).expect(403);
    await call('get', `/student/attempts/${randomUUID()}`, student).expect(404);
    await call('put', `/student/attempts/${view.id}/answers/${randomUUID()}`, student)
      .send({ text: 'x' })
      .expect(404);

    const [user] = await sql`select id from users where email = ${email}`;
    await call(
      'post',
      `/admin/sections/${sectionId}/enrollments/${user?.id as string}/drop`,
      adminToken,
    )
      .send({ reason: 'Transferred to another section' })
      .expect(200);
    await call('get', `/student/assessments/${id}`, student).expect(404);
    await call('get', `/student/attempts/${view.id}`, student).expect(404);
    const list = (await call('get', '/student/assessments', student).expect(200))
      .body as StudentAssessmentSummary[];
    expect(list.map((item) => item.id)).not.toContain(id);
  });

  it('waits for the opening date', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const { id } = await quiz([email], { opensAt: at(24 * HOUR) });
    const details = (await call('get', `/student/assessments/${id}`, student).expect(200))
      .body as StudentAssessmentDetails;
    expect(details.state).toBe('scheduled');
    expect(details.blockedReason).toMatch(/^It opens on /);
    await call('post', `/student/assessments/${id}/attempts`, student).expect(409);
  });

  it('ends the attempt at the time limit and submits what was saved', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const { id } = await quiz([email], { timeLimitMinutes: 20 });
    const view = (await call('post', `/student/assessments/${id}/attempts`, student).expect(200))
      .body as AttemptView;
    const minutes = (new Date(view.deadlineAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(19);
    expect(minutes).toBeLessThanOrEqual(20);

    await call('put', `/student/attempts/${view.id}/answers/${view.questions[0]!.id}`, student)
      .send({ choiceId: choiceId(view, 1, 'Right') })
      .expect(200);
    await sql`update attempts set deadline_at = now() - interval '1 minute' where id = ${view.id}`;
    await call('put', `/student/attempts/${view.id}/answers/${view.questions[1]!.id}`, student)
      .send({ choiceId: choiceId(view, 2, 'Right') })
      .expect(409)
      .expect((response) =>
        expect(messageOf(response)).toBe('Time is up. Your saved answers were submitted.'),
      );
    const result = (await call('get', `/student/attempts/${view.id}/result`, student).expect(200))
      .body as AttemptResult;
    expect(result).toMatchObject({ autoSubmitted: true, score: 2, answered: 1 });
  });

  it('cannot be unpublished once a student has started', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const { id } = await quiz([email]);
    await call('post', `/student/assessments/${id}/attempts`, student).expect(200);
    await call('post', `/teacher/assessments/${id}/unpublish`, teacherToken)
      .expect(409)
      .expect((response) =>
        expect(messageOf(response)).toBe(
          'Students have already started this assessment, so it cannot be unpublished.',
        ),
      );
  });

  it('refuses to start when the student is dropped while starting', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const { id, sectionId } = await quiz([email]);
    const [user] = await sql`select id from users where email = ${email}`;
    let pending: Promise<request.Response> | undefined;
    // The start passes its first check, then waits on the enrollment row while the drop commits.
    await sql.begin(async (tx) => {
      await tx`select status from enrollments
               where section_id = ${sectionId} and student_id = ${user?.id as string} for update`;
      pending = Promise.resolve(call('post', `/student/assessments/${id}/attempts`, student));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx`update enrollments set status = 'dropped', dropped_at = now()
               where section_id = ${sectionId} and student_id = ${user?.id as string}`;
    });
    const response = await (pending ?? Promise.reject(new Error('not started')));
    expect(response.status).toBe(404);
    const [count] = await sql`select count(*)::int as n from attempts where assessment_id = ${id}`;
    expect(count?.n).toBe(0);
  });

  it('opens one attempt when a student starts twice at once', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const { id } = await quiz([email]);
    let pending: Promise<request.Response[]> | undefined;
    await sql.begin(async (tx) => {
      // Both requests wait on the assessment row, then run at the same moment.
      await tx`select id from assessments where id = ${id} for update`;
      pending = Promise.all([
        Promise.resolve(call('post', `/student/assessments/${id}/attempts`, student)),
        Promise.resolve(call('post', `/student/assessments/${id}/attempts`, student)),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const responses = await (pending ?? Promise.resolve([]));
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const ids = responses.map((response) => (response.body as AttemptView).id);
    expect(ids[0]).toBe(ids[1]);
    const [count] = await sql`select count(*)::int as n from attempts where assessment_id = ${id}`;
    expect(count?.n).toBe(1);
  });
});
