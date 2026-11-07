import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  SAVE_GRACE_SECONDS,
  usesQuestions,
  type AnswerInput,
  type AssessmentKind,
  type AnswerSaved,
  type AttemptQuestion,
  type AttemptResult,
  type AttemptView,
  type AuditAction,
  type SavedAnswer,
  type StudentAssessmentDetails,
  type StudentAssessmentState,
  type StudentAssessmentSummary,
} from '@lead/schema';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { ClientInfo } from '../auth/auth.service';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import {
  assessmentObjectives,
  assessmentQuestions,
  assessments,
  attemptAnswers,
  attempts,
  classSections,
  courses,
  enrollments,
  gradeQuestionScores,
  grades,
  learningObjectives,
  questionChoices,
  submissions,
  users,
  type AssessmentRow,
  type AttemptRow,
  type UserRow,
} from '../database/schema';
import { submissionState } from '../submissions/submission-rules';
import { isAnswered, scoreAttempt, type ScoredQuestion } from './attempt-scoring';

/** The student taking an assessment, for the audit trail. */
export interface Taker {
  readonly student: UserRow;
  readonly client: ClientInfo;
  /** A teacher whose grading view closed an attempt whose time had run out. */
  readonly closedBy?: UserRow;
}

interface Visible {
  readonly assessment: AssessmentRow;
  readonly sectionName: string;
  readonly courseCode: string;
  readonly courseTitle: string;
}

const GRACE_MS = SAVE_GRACE_SECONDS * 1000;
const NOT_FOUND = 'No such assessment among your classes.';
const NO_ATTEMPT = 'No such attempt.';
const objectiveCode = (number: number): string => `O${number}`;
const TIME = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Past its deadline (with the grace for answers still on their way). */
const expired = (attempt: AttemptRow, now: Date): boolean =>
  attempt.status === 'in_progress' && now.getTime() > attempt.deadlineAt.getTime() + GRACE_MS;

/**
 * Students' side of quizzes and examinations (wireframes S07–S11). Students see the published
 * ones of classes they are enrolled in (not dropped); anything else is the same 404. Starting
 * locks the student's enrollment row, saving and submitting lock the attempt row, so a double
 * click or two tabs never make two attempts or score a half-saved one. An attempt left open
 * past its deadline is submitted, with the answers saved by then, the next time it is touched.
 */
@Injectable()
export class AttemptsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ---------- S07, S08

  /** S07: quizzes and examinations, and assignments and projects (submitted through S12). */
  async list(student: UserRow, sectionId?: string): Promise<StudentAssessmentSummary[]> {
    const rows = await this.visibleQuery(this.db, student)
      .where(
        and(
          this.visibleWhere(student, ALL_KINDS),
          sectionId === undefined ? undefined : eq(assessments.sectionId, sectionId),
        ),
      )
      .orderBy(asc(assessments.dueAt), asc(assessments.title));
    const ids = rows.map((row) => row.assessment.id);
    const [codes, mine, handedIn] = await Promise.all([
      this.objectiveCodes(ids),
      ids.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(attempts)
            .where(and(eq(attempts.studentId, student.id), inArray(attempts.assessmentId, ids))),
      ids.length === 0
        ? Promise.resolve([])
        : this.db
            .select({ assessmentId: submissions.assessmentId })
            .from(submissions)
            .where(
              and(
                eq(submissions.studentId, student.id),
                eq(submissions.status, 'submitted'),
                inArray(submissions.assessmentId, ids),
              ),
            ),
    ]);
    const now = new Date();
    return rows.map((row) => {
      const objectiveCodes = codes.get(row.assessment.id) ?? [];
      if (usesQuestions(row.assessment.kind)) {
        return toSummary(
          row,
          objectiveCodes,
          mine.filter((attempt) => attempt.assessmentId === row.assessment.id),
          now,
        );
      }
      const submitted = handedIn.filter((item) => item.assessmentId === row.assessment.id).length;
      const { assessment } = row;
      return {
        ...toSummary(row, objectiveCodes, [], now),
        state: submissionState(
          {
            opensAt: assessment.opensAt!,
            dueAt: assessment.dueAt!,
            maxAttempts: assessment.maxAttempts,
            acceptLate: assessment.acceptLate,
          },
          submitted,
          now,
        ),
        attemptsUsed: submitted,
      };
    });
  }

  async details(student: UserRow, assessmentId: string): Promise<StudentAssessmentDetails> {
    return this.db.transaction(async (tx) => {
      const visible = await this.visible(tx, student, assessmentId);
      const mine = await this.finalizeExpired(tx, student, visible.assessment);
      const [codes, objectives, questions] = await Promise.all([
        this.objectiveCodes([assessmentId], tx),
        tx
          .select({
            number: learningObjectives.number,
            description: learningObjectives.description,
          })
          .from(assessmentObjectives)
          .innerJoin(
            learningObjectives,
            eq(learningObjectives.id, assessmentObjectives.objectiveId),
          )
          .where(eq(assessmentObjectives.assessmentId, assessmentId))
          .orderBy(asc(learningObjectives.number)),
        tx
          .select({ points: assessmentQuestions.points })
          .from(assessmentQuestions)
          .where(eq(assessmentQuestions.assessmentId, assessmentId)),
      ]);
      const now = new Date();
      const summary = toSummary(visible, codes.get(assessmentId) ?? [], mine, now);
      return {
        ...summary,
        instructions: visible.assessment.instructions,
        timeLimitMinutes: visible.assessment.timeLimitMinutes,
        questionCount: questions.length,
        points: questions.reduce((total, question) => total + question.points, 0),
        objectives: objectives.map((row) => ({
          code: objectiveCode(row.number),
          description: row.description,
        })),
        attempts: mine.map((attempt) => ({
          id: attempt.id,
          number: attempt.number,
          status: attempt.status,
          startedAt: attempt.startedAt.toISOString(),
          submittedAt: attempt.submittedAt?.toISOString() ?? null,
        })),
        blockedReason: blockedReason(visible.assessment, mine, now),
      };
    });
  }

  // ---------- S09, S10

  /** Begins a new attempt, or returns the one already in progress. */
  async start(assessmentId: string, taker: Taker): Promise<AttemptView> {
    return this.db.transaction(async (tx) => {
      // Shares the assessment row, so a teacher cannot unpublish it while this commits.
      const visible = await this.visible(tx, taker.student, assessmentId, true);
      // One start at a time per student (two tabs, a double click). Read again under the lock:
      // a drop that committed meanwhile shows here.
      const [enrollment] = await tx
        .select({ status: enrollments.status })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.sectionId, visible.assessment.sectionId),
            eq(enrollments.studentId, taker.student.id),
          ),
        )
        .for('update');
      if (enrollment?.status !== 'enrolled') throw new NotFoundException(NOT_FOUND);
      const mine = await this.finalizeExpired(tx, taker.student, visible.assessment, taker);
      const open = mine.find((attempt) => attempt.status === 'in_progress');
      if (open) return this.view(tx, open, visible);

      const now = new Date();
      const reason = blockedReason(visible.assessment, mine, now);
      if (reason) throw new ConflictException(reason);
      const { assessment } = visible;
      const limit = assessment.timeLimitMinutes;
      const dueAt = assessment.dueAt!;
      const deadlineAt =
        limit === null
          ? dueAt
          : new Date(Math.min(now.getTime() + limit * 60_000, dueAt.getTime()));
      const [created] = await tx
        .insert(attempts)
        .values({
          assessmentId,
          studentId: taker.student.id,
          number: mine.length + 1,
          startedAt: now,
          deadlineAt,
        })
        .returning();
      if (!created) throw new ConflictException('The attempt could not be started.');
      await this.record(tx, taker, 'attempt.started', created.id, {
        assessmentId,
        number: created.number,
        deadlineAt: deadlineAt.toISOString(),
      });
      return this.view(tx, created, visible);
    });
  }

  async attempt(student: UserRow, attemptId: string): Promise<AttemptView> {
    return this.db.transaction(async (tx) => {
      const { attempt, visible } = await this.ownAttempt(tx, student, attemptId, true);
      const current = expired(attempt, new Date())
        ? await this.submit(tx, attempt, { student, client: NO_CLIENT }, true)
        : attempt;
      return this.view(tx, current, visible);
    });
  }

  async saveAnswer(
    attemptId: string,
    questionId: string,
    input: AnswerInput,
    taker: Taker,
  ): Promise<AnswerSaved> {
    const outcome = await this.db.transaction(async (tx) => {
      const { attempt } = await this.ownAttempt(tx, taker.student, attemptId, true);
      if (attempt.status === 'submitted') {
        throw new ConflictException('This attempt was already submitted.');
      }
      if (expired(attempt, new Date())) {
        await this.submit(tx, attempt, taker, true);
        return 'expired' as const;
      }
      const [question] = await tx
        .select()
        .from(assessmentQuestions)
        .where(
          and(
            eq(assessmentQuestions.id, questionId),
            eq(assessmentQuestions.assessmentId, attempt.assessmentId),
          ),
        );
      if (!question) throw new NotFoundException('No such question in this attempt.');
      if (question.kind === 'multiple_choice' && input.choiceId !== null) {
        const [choice] = await tx
          .select({ id: questionChoices.id })
          .from(questionChoices)
          .where(
            and(
              eq(questionChoices.id, input.choiceId),
              eq(questionChoices.questionId, question.id),
            ),
          );
        if (!choice) throw new NotFoundException('No such answer choice for this question.');
      }
      const values =
        question.kind === 'multiple_choice'
          ? { choiceId: input.choiceId, text: '' }
          : { choiceId: null, text: input.text };
      const savedAt = new Date();
      await tx
        .insert(attemptAnswers)
        .values({ attemptId, questionId, ...values, savedAt })
        .onConflictDoUpdate({
          target: [attemptAnswers.attemptId, attemptAnswers.questionId],
          set: { ...values, savedAt },
        });
      return { questionId, savedAt: savedAt.toISOString() };
    });
    // Thrown after the transaction, so the automatic submission is kept.
    if (outcome === 'expired') {
      throw new ConflictException('Time is up. Your saved answers were submitted.');
    }
    return outcome;
  }

  /** Submits the attempt (again: returns its result). */
  async submitAttempt(attemptId: string, taker: Taker): Promise<AttemptResult> {
    return this.db.transaction(async (tx) => {
      const { attempt, visible } = await this.ownAttempt(tx, taker.student, attemptId, true);
      const done =
        attempt.status === 'submitted'
          ? attempt
          : await this.submit(tx, attempt, taker, expired(attempt, new Date()));
      return this.result(tx, done, visible);
    });
  }

  // ---------- S11

  async attemptResult(student: UserRow, attemptId: string): Promise<AttemptResult> {
    return this.db.transaction(async (tx) => {
      const { attempt, visible } = await this.ownAttempt(tx, student, attemptId, true);
      if (attempt.status === 'in_progress' && !expired(attempt, new Date())) {
        throw new ConflictException('This attempt is still in progress.');
      }
      const done =
        attempt.status === 'submitted'
          ? attempt
          : await this.submit(tx, attempt, { student, client: NO_CLIENT }, true);
      return this.result(tx, done, visible);
    });
  }

  // ---------- Helpers

  /** Scores and closes an attempt; `auto` when time ran out (submitted as of its deadline). */
  private async submit(
    tx: DbExecutor,
    attempt: AttemptRow,
    taker: Taker,
    auto: boolean,
  ): Promise<AttemptRow> {
    const [questions, answers] = await Promise.all([
      this.scoredQuestions(tx, attempt.assessmentId),
      tx.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, attempt.id)),
    ]);
    const scoring = scoreAttempt(questions, answers);
    for (const [questionId, points] of scoring.awarded) {
      await tx
        .update(attemptAnswers)
        .set({ pointsAwarded: points })
        .where(
          and(eq(attemptAnswers.attemptId, attempt.id), eq(attemptAnswers.questionId, questionId)),
        );
    }
    const now = new Date();
    const submittedAt = auto && now > attempt.deadlineAt ? attempt.deadlineAt : now;
    const [done] = await tx
      .update(attempts)
      .set({
        status: 'submitted',
        submittedAt,
        autoSubmitted: auto,
        score: scoring.score,
        scoredPoints: scoring.scoredPoints,
      })
      .where(and(eq(attempts.id, attempt.id), eq(attempts.status, 'in_progress')))
      .returning();
    if (!done) throw new ConflictException('This attempt was already submitted.');
    await this.record(tx, taker, 'attempt.submitted', attempt.id, {
      ...(taker.closedBy ? { closedByTeacher: taker.closedBy.id } : {}),
      assessmentId: attempt.assessmentId,
      number: attempt.number,
      score: scoring.score,
      scoredPoints: scoring.scoredPoints,
      autoSubmitted: auto,
    });
    return done;
  }

  /** The student's attempts at an assessment, submitting any whose time has run out. */
  /**
   * Submits a student's attempts whose time ran out, as the student's own reads do. For a
   * teacher opening an attempt to grade it before the student has come back.
   */
  async closeExpired(
    tx: DbExecutor,
    studentId: string,
    assessmentId: string,
    teacher: { readonly user: UserRow; readonly client: ClientInfo },
  ): Promise<void> {
    const [[student], [assessment]] = await Promise.all([
      tx.select().from(users).where(eq(users.id, studentId)),
      tx.select().from(assessments).where(eq(assessments.id, assessmentId)),
    ]);
    if (!student || !assessment) return;
    // Audited as the student's attempt, naming the teacher whose view closed it.
    await this.finalizeExpired(tx, student, assessment, {
      student,
      client: teacher.client,
      closedBy: teacher.user,
    });
  }

  private async finalizeExpired(
    tx: DbExecutor,
    student: UserRow,
    assessment: AssessmentRow,
    taker: Taker = { student, client: NO_CLIENT },
  ): Promise<AttemptRow[]> {
    const mine = await tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.assessmentId, assessment.id), eq(attempts.studentId, student.id)))
      .orderBy(asc(attempts.number))
      .for('update');
    const now = new Date();
    const result: AttemptRow[] = [];
    for (const attempt of mine) {
      result.push(expired(attempt, now) ? await this.submit(tx, attempt, taker, true) : attempt);
    }
    return result;
  }

  private async ownAttempt(
    tx: DbExecutor,
    student: UserRow,
    attemptId: string,
    lock = false,
  ): Promise<{ attempt: AttemptRow; visible: Visible }> {
    const query = tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, attemptId), eq(attempts.studentId, student.id)));
    const [attempt] = lock ? await query.for('update') : await query;
    if (!attempt) throw new NotFoundException(NO_ATTEMPT);
    const visible = await this.visible(tx, student, attempt.assessmentId).catch(
      (error: unknown) => {
        // Dropped, or unpublished: the attempt is not theirs to see any more.
        if (error instanceof NotFoundException) throw new NotFoundException(NO_ATTEMPT);
        throw error;
      },
    );
    return { attempt, visible };
  }

  private async view(tx: DbExecutor, attempt: AttemptRow, visible: Visible): Promise<AttemptView> {
    const [questionRows, answerRows] = await Promise.all([
      tx
        .select()
        .from(assessmentQuestions)
        .where(eq(assessmentQuestions.assessmentId, attempt.assessmentId))
        .orderBy(asc(assessmentQuestions.position)),
      tx.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, attempt.id)),
    ]);
    const choiceRows =
      questionRows.length === 0
        ? []
        : await tx
            .select({
              id: questionChoices.id,
              questionId: questionChoices.questionId,
              text: questionChoices.text,
            })
            .from(questionChoices)
            .where(
              inArray(
                questionChoices.questionId,
                questionRows.map((row) => row.id),
              ),
            )
            .orderBy(asc(questionChoices.position));
    const questions: AttemptQuestion[] = questionRows.map((row) => ({
      id: row.id,
      position: row.position,
      kind: row.kind,
      prompt: row.prompt,
      points: row.points,
      // Without `correct`: the answer key stays on the server.
      choices: choiceRows
        .filter((choice) => choice.questionId === row.id)
        .map(({ id, text }) => ({ id, text })),
    }));
    const answers: SavedAnswer[] = answerRows.map((row) => ({
      questionId: row.questionId,
      choiceId: row.choiceId,
      text: row.text,
      savedAt: row.savedAt.toISOString(),
    }));
    return {
      id: attempt.id,
      number: attempt.number,
      status: attempt.status,
      assessmentId: attempt.assessmentId,
      sectionId: visible.assessment.sectionId,
      title: visible.assessment.title,
      kind: visible.assessment.kind,
      courseCode: visible.courseCode,
      sectionName: visible.sectionName,
      maxAttempts: visible.assessment.maxAttempts,
      deadlineAt: attempt.deadlineAt.toISOString(),
      serverNow: new Date().toISOString(),
      questions,
      answers,
    };
  }

  private async result(
    tx: DbExecutor,
    attempt: AttemptRow,
    visible: Visible,
  ): Promise<AttemptResult> {
    const [questions, answers, objectiveRows, attemptsUsed] = await Promise.all([
      this.scoredQuestions(tx, attempt.assessmentId),
      tx.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, attempt.id)),
      tx
        .select({
          id: learningObjectives.id,
          number: learningObjectives.number,
          description: learningObjectives.description,
        })
        .from(assessmentObjectives)
        .innerJoin(learningObjectives, eq(learningObjectives.id, assessmentObjectives.objectiveId))
        .where(eq(assessmentObjectives.assessmentId, attempt.assessmentId))
        .orderBy(asc(learningObjectives.number)),
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(attempts)
        .where(
          and(
            eq(attempts.assessmentId, attempt.assessmentId),
            eq(attempts.studentId, attempt.studentId),
          ),
        ),
    ]);
    const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
    const objectives = objectiveRows.map((objective) => {
      const mapped = questions.filter((question) => question.objectiveId === objective.id);
      const choice = mapped.filter((question) => question.kind === 'multiple_choice');
      return {
        code: objectiveCode(objective.number),
        description: objective.description,
        correct: choice.filter((question) => {
          const answer = byQuestion.get(question.id);
          return (answer?.pointsAwarded ?? 0) > 0;
        }).length,
        scored: choice.length,
        pending: mapped.length - choice.length,
      };
    });
    const used = attemptsUsed[0]?.total ?? 0;
    const { assessment } = visible;
    return {
      id: attempt.id,
      number: attempt.number,
      assessmentId: attempt.assessmentId,
      sectionId: visible.assessment.sectionId,
      title: assessment.title,
      courseCode: visible.courseCode,
      sectionName: visible.sectionName,
      submittedAt: attempt.submittedAt!.toISOString(),
      autoSubmitted: attempt.autoSubmitted,
      answered: questions.filter((question) => isAnswered(byQuestion.get(question.id))).length,
      questionCount: questions.length,
      score: attempt.score ?? 0,
      scoredPoints: attempt.scoredPoints ?? 0,
      pendingPoints: questions
        .filter((question) => question.kind === 'written')
        .reduce((total, question) => total + question.points, 0),
      objectives,
      attemptsUsed: used,
      maxAttempts: assessment.maxAttempts,
      canRetake: used < assessment.maxAttempts && new Date() < assessment.dueAt!,
      grade: await this.releasedGrade(tx, attempt),
    };
  }

  /** The teacher's grade of this attempt, once released (written answers included). */
  private async releasedGrade(
    tx: DbExecutor,
    attempt: AttemptRow,
  ): Promise<AttemptResult['grade']> {
    const [grade] = await tx
      .select()
      .from(grades)
      .where(
        and(
          eq(grades.attemptId, attempt.id),
          eq(grades.studentId, attempt.studentId),
          eq(grades.status, 'released'),
        ),
      );
    if (!grade) return null;
    const written = await tx
      .select({
        position: assessmentQuestions.position,
        points: gradeQuestionScores.points,
        maxPoints: assessmentQuestions.points,
      })
      .from(gradeQuestionScores)
      .innerJoin(assessmentQuestions, eq(assessmentQuestions.id, gradeQuestionScores.questionId))
      .where(eq(gradeQuestionScores.gradeId, grade.id))
      .orderBy(asc(assessmentQuestions.position));
    return {
      score: grade.score,
      maxPoints: grade.maxPoints,
      feedback: grade.feedback,
      releasedAt: grade.releasedAt!.toISOString(),
      written,
    };
  }

  private async scoredQuestions(tx: DbExecutor, assessmentId: string): Promise<ScoredQuestion[]> {
    const rows = await tx
      .select({
        id: assessmentQuestions.id,
        kind: assessmentQuestions.kind,
        points: assessmentQuestions.points,
        objectiveId: assessmentQuestions.objectiveId,
        correctChoiceId: questionChoices.id,
      })
      .from(assessmentQuestions)
      .leftJoin(
        questionChoices,
        and(
          eq(questionChoices.questionId, assessmentQuestions.id),
          eq(questionChoices.correct, true),
        ),
      )
      .where(eq(assessmentQuestions.assessmentId, assessmentId))
      .orderBy(asc(assessmentQuestions.position));
    return rows;
  }

  /** A published quiz or examination of a class the student is enrolled in. */
  private async visible(
    executor: DbExecutor,
    student: UserRow,
    assessmentId: string,
    lock = false,
  ): Promise<Visible> {
    const query = this.visibleQuery(executor, student)
      .where(and(this.visibleWhere(student), eq(assessments.id, assessmentId)))
      .limit(1);
    const [row] = lock ? await query.for('share', { of: assessments }) : await query;
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private visibleQuery(executor: DbExecutor, student: UserRow) {
    return executor
      .select({
        assessment: assessments,
        sectionName: classSections.name,
        courseCode: courses.code,
        courseTitle: courses.title,
      })
      .from(assessments)
      .innerJoin(classSections, eq(classSections.id, assessments.sectionId))
      .innerJoin(courses, eq(courses.id, classSections.courseId))
      .innerJoin(
        enrollments,
        and(
          eq(enrollments.sectionId, assessments.sectionId),
          eq(enrollments.studentId, student.id),
        ),
      )
      .$dynamic();
  }

  private visibleWhere(student: UserRow, kinds: readonly AssessmentKind[] = QUESTION_KINDS) {
    return and(
      eq(enrollments.studentId, student.id),
      eq(enrollments.status, 'enrolled'),
      eq(assessments.status, 'published'),
      inArray(assessments.kind, [...kinds]),
    );
  }

  private async objectiveCodes(
    assessmentIds: readonly string[],
    executor: DbExecutor = this.db,
  ): Promise<Map<string, string[]>> {
    const codes = new Map<string, string[]>();
    if (assessmentIds.length === 0) return codes;
    const rows = await executor
      .select({
        assessmentId: assessmentObjectives.assessmentId,
        number: learningObjectives.number,
      })
      .from(assessmentObjectives)
      .innerJoin(learningObjectives, eq(learningObjectives.id, assessmentObjectives.objectiveId))
      .where(inArray(assessmentObjectives.assessmentId, [...assessmentIds]))
      .orderBy(asc(learningObjectives.number));
    for (const row of rows) {
      codes.set(row.assessmentId, [
        ...(codes.get(row.assessmentId) ?? []),
        objectiveCode(row.number),
      ]);
    }
    return codes;
  }

  private async record(
    tx: DbExecutor,
    taker: Taker,
    action: AuditAction,
    attemptId: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(
      {
        actorId: taker.student.id,
        actorRole: taker.student.role,
        action,
        targetType: 'attempt',
        targetId: attemptId,
        outcome: 'success',
        reason: null,
        before: null,
        after,
        ipAddress: taker.client.ipAddress,
        userAgent: taker.client.userAgent,
      },
      tx,
    );
  }
}

/** Attempts are for quizzes and examinations; the list (S07) shows every kind. */
const QUESTION_KINDS: readonly AssessmentKind[] = ['quiz', 'exam'];
const ALL_KINDS: readonly AssessmentKind[] = ['quiz', 'exam', 'assignment', 'project'];

/** Read requests that submit an expired attempt record no client details. */
const NO_CLIENT: ClientInfo = { ipAddress: null, userAgent: null };

function state(
  assessment: AssessmentRow,
  mine: readonly AttemptRow[],
  now: Date,
): StudentAssessmentState {
  if (mine.some((attempt) => attempt.status === 'in_progress' && !expired(attempt, now))) {
    return 'in_progress';
  }
  if (now < assessment.opensAt!) return 'scheduled';
  if (now >= assessment.dueAt! || mine.length >= assessment.maxAttempts) {
    return mine.length > 0 ? 'submitted' : 'missed';
  }
  return 'available';
}

/** Why no new attempt may begin, or null. */
function blockedReason(
  assessment: AssessmentRow,
  mine: readonly AttemptRow[],
  now: Date,
): string | null {
  if (now < assessment.opensAt!) return `It opens on ${TIME.format(assessment.opensAt!)}.`;
  if (now >= assessment.dueAt!) return 'This assessment is closed.';
  if (mine.length >= assessment.maxAttempts) return 'You have used all your attempts.';
  return null;
}

function toSummary(
  visible: Visible,
  objectiveCodes: readonly string[],
  mine: readonly AttemptRow[],
  now: Date,
): StudentAssessmentSummary {
  const { assessment } = visible;
  return {
    id: assessment.id,
    sectionId: assessment.sectionId,
    sectionName: visible.sectionName,
    courseCode: visible.courseCode,
    courseTitle: visible.courseTitle,
    kind: assessment.kind,
    title: assessment.title,
    objectiveCodes,
    opensAt: assessment.opensAt!.toISOString(),
    dueAt: assessment.dueAt!.toISOString(),
    state: state(assessment, mine, now),
    attemptsUsed: mine.length,
    maxAttempts: assessment.maxAttempts,
  };
}
