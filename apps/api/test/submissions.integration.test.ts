import type {
  AssessmentDetails,
  Course,
  CourseContent,
  GradingQueue,
  GradingView,
  SectionSummary,
  StudentAssessmentSummary,
  StudentAssignment,
} from '@lead/schema';
import { randomInt } from 'node:crypto';
import type { Sql } from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQL_CLIENT } from '../src/database/database.module';
import { createTestApp, type TestApp } from './test-app';
import { createTestTerm } from './test-terms';
import { auditCount, createUser, TEST_PASSWORD } from './test-users';

const HOUR = 60 * 60 * 1000;
const at = (offset: number) => new Date(Date.now() + offset).toISOString();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n%%EOF\n');
const messageOf = (response: request.Response): string =>
  (response.body as { message: string }).message;

interface Assignment {
  readonly id: string;
  readonly sectionId: string;
  readonly rubric: AssessmentDetails['rubric'];
}

describe('assignment submissions and grading, S12 and T13–T14 (integration)', () => {
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

  /** A published assignment with a two-criterion rubric (4/2/0 each), in a fresh class. */
  async function assignment(
    studentEmails: string[],
    settings: Record<string, unknown> = {},
  ): Promise<Assignment> {
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
    await call('post', `/teacher/content/${course.id}/objectives`, teacherToken)
      .send({ description: 'Apply normalization' })
      .expect(201);
    const { objectives } = (
      await call('get', `/teacher/content/${course.id}`, teacherToken).expect(200)
    ).body as CourseContent;
    const created = (
      await call('post', '/teacher/assessments', teacherToken)
        .send({ sectionId: section.id, kind: 'assignment', title: 'Normalization exercise' })
        .expect(201)
    ).body as AssessmentDetails;
    const base = `/teacher/assessments/${created.id}`;
    await call('patch', base, teacherToken)
      .send({
        objectiveIds: [objectives[0]!.id],
        opensAt: at(-HOUR),
        dueAt: at(72 * HOUR),
        maxAttempts: 2,
        ...settings,
      })
      .expect(200);
    const levels = [
      { label: 'Strong', points: 4 },
      { label: 'Developing', points: 2 },
      { label: 'Needs work', points: 0 },
    ];
    await call('put', `${base}/rubric`, teacherToken)
      .send({
        criteria: [
          { name: 'Correctness', levels },
          { name: 'Explanation', levels },
        ],
      })
      .expect(200);
    const published = (await call('post', `${base}/publish`, teacherToken).expect(200))
      .body as AssessmentDetails;
    return { id: created.id, sectionId: section.id, rubric: published.rubric };
  }

  const upload = (id: string, token: string, name = 'exercise.pdf', body = PDF) =>
    call('post', `/student/assignments/${id}/draft`, token)
      .field('note', 'My normalization steps')
      .attach('file', body, name);

  /** { criterionId: levelId } choosing the level with these points for every criterion. */
  const levelsFor = (work: Assignment, ...points: number[]) =>
    Object.fromEntries(
      work.rubric.map((criterion, index) => [
        criterion.id,
        criterion.levels.find((level) => level.points === points[index])!.id,
      ]),
    );

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

  it('submits a file, grades it with the rubric, releases it and changes it with a reason', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const work = await assignment([email]);
    const [user] = await sql`select id from users where email = ${email}`;
    const studentId = user?.id as string;

    const list = (await call('get', '/student/assessments', student).expect(200))
      .body as StudentAssessmentSummary[];
    expect(list.find((item) => item.id === work.id)).toMatchObject({
      kind: 'assignment',
      state: 'available',
    });
    const fresh = (await call('get', `/student/assignments/${work.id}`, student).expect(200))
      .body as StudentAssignment;
    expect(fresh).toMatchObject({ points: 8, maxSubmissions: 2, blockedReason: null, grade: null });

    await call('post', `/student/assignments/${work.id}/submit`, student)
      .send({ confirmFile: true })
      .expect(409)
      .expect((response) => expect(messageOf(response)).toBe('Upload a file before submitting.'));
    await upload(work.id, student, 'draft-1.pdf').expect(200);
    const drafted = (await upload(work.id, student, 'exercise.pdf').expect(200))
      .body as StudentAssignment;
    expect(drafted.submissions).toEqual([
      expect.objectContaining({ status: 'draft', fileName: 'exercise.pdf', number: 0 }),
    ]);
    await call('post', `/student/assignments/${work.id}/submit`, student)
      .send({})
      .expect(400)
      .expect((response) =>
        expect(messageOf(response)).toBe('Confirm that this is the file you intend to submit.'),
      );
    const submitted = (
      await call('post', `/student/assignments/${work.id}/submit`, student)
        .send({ confirmFile: true })
        .expect(200)
    ).body as StudentAssignment;
    expect(submitted.submissions[0]).toMatchObject({ status: 'submitted', number: 1, late: false });
    expect(await auditCount(sql, 'submission.submitted', email)).toBe(1);
    const own = await call(
      'get',
      `/student/submissions/${submitted.submissions[0]!.id}/file`,
      student,
    ).expect(200);
    expect(Buffer.from(own.body as Buffer).equals(PDF)).toBe(true);

    const queue = (
      await call('get', `/teacher/grading?section=${work.sectionId}`, teacherToken).expect(200)
    ).body as GradingQueue;
    expect(queue.items).toEqual([
      expect.objectContaining({ assessmentId: work.id, studentId, status: 'needs_review' }),
    ]);
    const file = await call(
      'get',
      `/teacher/grading/${work.id}/submissions/${submitted.submissions[0]!.id}/file`,
      teacherToken,
    ).expect(200);
    expect(file.headers['content-disposition']).toContain('attachment');

    const grade = (body: object) =>
      call('put', `/teacher/grading/${work.id}/students/${studentId}`, teacherToken).send(body);
    const draft = (
      await grade({ levels: levelsFor(work, 4, 2), feedback: 'Clarify step 2.' }).expect(200)
    ).body as GradingView;
    expect(draft.grade).toMatchObject({ status: 'draft', score: 6, releasedAt: null });
    expect(
      (
        (await call('get', `/student/assignments/${work.id}`, student).expect(200))
          .body as StudentAssignment
      ).grade,
    ).toBeNull();

    await grade({
      levels: levelsFor(work, 4, 2),
      feedback: 'Clarify step 2.',
      release: true,
    }).expect(200);
    const seen = (await call('get', `/student/assignments/${work.id}`, student).expect(200))
      .body as StudentAssignment;
    expect(seen.grade).toMatchObject({
      score: 6,
      maxPoints: 8,
      feedback: 'Clarify step 2.',
      submissionNumber: 1,
      levels: [
        { criterion: 'Correctness', level: 'Strong', points: 4 },
        { criterion: 'Explanation', level: 'Developing', points: 2 },
      ],
    });

    // X05: a released grade changes only with a reason.
    await grade({ levels: levelsFor(work, 4, 4), feedback: 'Clarify step 2.' })
      .expect(400)
      .expect((response) =>
        expect(messageOf(response)).toBe('Give a reason for changing a released grade.'),
      );
    await grade({ levels: levelsFor(work, 4, 2), feedback: 'Clarify step 2.' }).expect(200);
    await grade({
      levels: levelsFor(work, 4, 4),
      feedback: 'Clarify step 2.',
      reason: 'Re-read the explanation section',
    }).expect(200);
    const [changed] = await sql`
      select reason, before, after from audit_events
      where action = 'grade.changed_after_release' order by occurred_at desc limit 1`;
    expect(changed?.reason).toBe('Re-read the explanation section');
    expect((changed?.before as { score: number }).score).toBe(6);
    expect((changed?.after as { score: number }).score).toBe(8);

    const after = (
      await call('get', `/teacher/grading?section=${work.sectionId}`, teacherToken).expect(200)
    ).body as GradingQueue;
    expect(after.items[0]?.status).toBe('released');
    await call('post', `/teacher/assessments/${work.id}/unpublish`, teacherToken).expect(409);

    // A second submission needs another look.
    await upload(work.id, student).expect(200);
    await call('post', `/student/assignments/${work.id}/submit`, student)
      .send({ confirmFile: true })
      .expect(200);
    const again = (
      await call('get', `/teacher/grading?section=${work.sectionId}`, teacherToken).expect(200)
    ).body as GradingQueue;
    expect(again.items[0]?.status).toBe('needs_review');
    await upload(work.id, student)
      .expect(409)
      .expect((response) =>
        expect(messageOf(response)).toBe('You have used all your submissions.'),
      );
  });

  it('checks files and rubric levels', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const work = await assignment([email]);
    const [user] = await sql`select id from users where email = ${email}`;
    const grade = (body: object) =>
      call('put', `/teacher/grading/${work.id}/students/${user?.id as string}`, teacherToken).send(
        body,
      );

    await grade({ levels: levelsFor(work, 4, 4), feedback: '' })
      .expect(409)
      .expect((response) =>
        expect(messageOf(response)).toBe('There is no submission to grade yet.'),
      );
    await upload(work.id, student, 'exercise.pdf', Buffer.from('MZ not a pdf')).expect(400);
    await call('post', `/student/assignments/${work.id}/draft`, student)
      .field('note', 'x')
      .expect(400);
    await upload(work.id, student).expect(200);
    await call('post', `/student/assignments/${work.id}/submit`, student)
      .send({ confirmFile: true })
      .expect(200);

    const [correctness, explanation] = work.rubric;
    await grade({ levels: { [correctness!.id]: correctness!.levels[0]!.id }, feedback: '' })
      .expect(400)
      .expect((response) => expect(messageOf(response)).toBe('Choose a level for "Explanation".'));
    await grade({
      levels: {
        [correctness!.id]: explanation!.levels[0]!.id,
        [explanation!.id]: explanation!.levels[0]!.id,
      },
      feedback: '',
    })
      .expect(400)
      .expect((response) => expect(messageOf(response)).toBe('Choose a level for "Correctness".'));
  });

  it('keeps work to the class: other teachers and students get nothing', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const work = await assignment([email]);
    const [user] = await sql`select id from users where email = ${email}`;
    const draft = (await upload(work.id, student).expect(200)).body as StudentAssignment;
    const draftId = draft.submissions[0]!.id;

    // A draft stays private to its student.
    await call(
      'get',
      `/teacher/grading/${work.id}/submissions/${draftId}/file`,
      teacherToken,
    ).expect(404);
    const outsider = await tokenFor(await createUser(sql));
    await call('get', `/student/assignments/${work.id}`, outsider).expect(404);
    await call('get', `/student/submissions/${draftId}/file`, outsider).expect(404);
    await upload(work.id, outsider).expect(404);
    const otherTeacher = await tokenFor(await createUser(sql, { role: 'teacher' }));
    await call(
      'get',
      `/teacher/grading/${work.id}/students/${user?.id as string}`,
      otherTeacher,
    ).expect(404);
    const empty = (await call('get', '/teacher/grading', otherTeacher).expect(200))
      .body as GradingQueue;
    expect(empty.items).toEqual([]);
    await call('get', '/teacher/grading', student).expect(403);
    // Quizzes are not submitted as files.
    await call('get', `/student/assignments/${work.id}`, teacherToken).expect(403);
    // A draft nobody handed in does not stop the teacher from unpublishing.
    await call('post', `/teacher/assessments/${work.id}/unpublish`, teacherToken).expect(200);
  });

  it('accepts late work only when the teacher allows it, and lists missing work', async () => {
    const [onTime, late] = [await createUser(sql), await createUser(sql)];
    const closed = await assignment([onTime, late]);
    const open = await assignment([late], { acceptLate: true });
    await sql`update assessments set due_at = now() - interval '1 hour'
              where id in (${closed.id}, ${open.id})`;

    const lateToken = await tokenFor(late);
    await upload(closed.id, lateToken)
      .expect(409)
      .expect((response) => expect(messageOf(response)).toBe('This assignment is closed.'));
    await upload(open.id, lateToken).expect(200);
    const submitted = (
      await call('post', `/student/assignments/${open.id}/submit`, lateToken)
        .send({ confirmFile: true })
        .expect(200)
    ).body as StudentAssignment;
    expect(submitted.submissions[0]?.late).toBe(true);

    const missing = (
      await call(
        'get',
        `/teacher/grading?section=${closed.sectionId}&status=missing`,
        teacherToken,
      ).expect(200)
    ).body as GradingQueue;
    expect(missing.items.map((item) => item.status)).toEqual(['missing', 'missing']);
    const list = (await call('get', '/student/assessments', lateToken).expect(200))
      .body as StudentAssessmentSummary[];
    expect(list.find((item) => item.id === closed.id)?.state).toBe('missed');
    expect(list.find((item) => item.id === open.id)?.state).toBe('submitted');
  });

  it('keeps one draft when a student uploads twice at once', async () => {
    const email = await createUser(sql);
    const student = await tokenFor(email);
    const work = await assignment([email]);
    let pending: Promise<request.Response[]> | undefined;
    await sql.begin(async (tx) => {
      // Both uploads wait on the assessment row, then run at the same moment.
      await tx`select id from assessments where id = ${work.id} for update`;
      pending = Promise.all([
        Promise.resolve(upload(work.id, student, 'one.pdf')),
        Promise.resolve(upload(work.id, student, 'two.pdf')),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const responses = await (pending ?? Promise.resolve([]));
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const [count] = await sql`
      select count(*)::int as n from submissions where assessment_id = ${work.id}`;
    expect(count?.n).toBe(1);
  });
});
