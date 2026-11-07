import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type { GradeInput, GradedAttempt, GradedQuestion, GradingView } from '@lead/schema';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { AttemptsService } from '../attempts/attempts.service';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import {
  assessmentQuestions,
  attemptAnswers,
  attempts,
  gradeQuestionScores,
  grades,
  questionChoices,
  type AttemptRow,
  type GradeRow,
} from '../database/schema';
import { sortedRecord, writeGrade, type Grader } from './grade-writer';

export interface GradedStudent {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface QuizContext {
  readonly assessmentId: string;
  readonly title: string;
  readonly kind: GradingView['kind'];
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly sectionName: string;
  readonly dueAt: string;
}

/**
 * Grading of quizzes and examinations with written questions (T13, T14, X05). Multiple choice
 * was scored when the attempt was submitted; the teacher gives points to each written answer
 * of the student's latest attempt. The grade is the multiple-choice score plus those points.
 * Callers have checked the teacher teaches the class and the student is enrolled.
 */
@Injectable()
export class QuizGradingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly attempts: AttemptsService,
  ) {}

  async view(quiz: QuizContext, student: GradedStudent, grader: Grader): Promise<GradingView> {
    return this.db.transaction(async (tx) => {
      await this.requireWritten(tx, quiz);
      // An attempt left open past its deadline is submitted first, so it can be graded.
      await this.attempts.closeExpired(tx, student.id, quiz.assessmentId, {
        user: grader.teacher,
        client: grader.client,
      });
      return this.describe(tx, quiz, student);
    });
  }

  async save(
    tx: DbExecutor,
    quiz: QuizContext,
    student: GradedStudent,
    input: GradeInput,
    grader: Grader,
  ): Promise<GradingView> {
    await this.requireWritten(tx, quiz);
    await this.attempts.closeExpired(tx, student.id, quiz.assessmentId, {
      user: grader.teacher,
      client: grader.client,
    });
    const [latest] = await tx
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.assessmentId, quiz.assessmentId),
          eq(attempts.studentId, student.id),
          eq(attempts.status, 'submitted'),
        ),
      )
      .orderBy(desc(attempts.number))
      .limit(1)
      .for('update');
    if (!latest) throw new ConflictException('There is no submitted attempt to grade yet.');

    const questions = await tx
      .select()
      .from(assessmentQuestions)
      .where(eq(assessmentQuestions.assessmentId, quiz.assessmentId))
      .orderBy(asc(assessmentQuestions.position));
    const written = questions.filter((question) => question.kind === 'written');
    const given = written.map((question) => {
      const points = input.questionPoints[question.id];
      if (points === undefined) {
        throw new BadRequestException(`Give points for question ${question.position}.`);
      }
      if (points > question.points) {
        throw new BadRequestException(
          `Question ${question.position} is worth at most ${question.points} points.`,
        );
      }
      return { questionId: question.id, points };
    });
    if (Object.keys(input.questionPoints).length !== written.length) {
      throw new BadRequestException('Give points for this assessment’s written questions only.');
    }
    const score = (latest.score ?? 0) + given.reduce((total, item) => total + item.points, 0);
    const maxPoints = questions.reduce((total, question) => total + question.points, 0);

    const [existing] = await tx
      .select()
      .from(grades)
      .where(and(eq(grades.assessmentId, quiz.assessmentId), eq(grades.studentId, student.id)))
      .for('update');
    await writeGrade(
      tx,
      this.audit,
      grader,
      {
        assessmentId: quiz.assessmentId,
        studentId: student.id,
        existing,
        target: { attemptId: latest.id },
        score,
        maxPoints,
        feedback: input.feedback,
        release: input.release,
        reason: input.reason,
        before: existing ? await this.gradeAudit(tx, existing) : null,
        after: {
          attemptNumber: latest.number,
          score,
          maxPoints,
          feedback: input.feedback,
          questionPoints: sortedRecord(
            given.map((item) => [item.questionId, item.points] as const),
          ),
        },
      },
      async (gradeId) => {
        await tx.delete(gradeQuestionScores).where(eq(gradeQuestionScores.gradeId, gradeId));
        if (given.length === 0) return;
        await tx.insert(gradeQuestionScores).values(given.map((item) => ({ gradeId, ...item })));
      },
    );
    return this.describe(tx, quiz, student);
  }

  /** Quizzes with only multiple choice are scored automatically; there is nothing to grade. */
  private async requireWritten(tx: DbExecutor, quiz: QuizContext): Promise<void> {
    const [written] = await tx
      .select({ id: assessmentQuestions.id })
      .from(assessmentQuestions)
      .where(
        and(
          eq(assessmentQuestions.assessmentId, quiz.assessmentId),
          eq(assessmentQuestions.kind, 'written'),
        ),
      )
      .limit(1);
    if (!written) {
      throw new ConflictException(
        'This assessment has no written questions: multiple choice is scored automatically.',
      );
    }
  }

  private async gradeAudit(tx: DbExecutor, grade: GradeRow): Promise<Record<string, unknown>> {
    const [scores, graded] = await Promise.all([
      tx
        .select({ questionId: gradeQuestionScores.questionId, points: gradeQuestionScores.points })
        .from(gradeQuestionScores)
        .where(eq(gradeQuestionScores.gradeId, grade.id)),
      grade.attemptId
        ? tx
            .select({ number: attempts.number })
            .from(attempts)
            .where(eq(attempts.id, grade.attemptId))
        : Promise.resolve([]),
    ]);
    return {
      attemptNumber: graded[0]?.number ?? null,
      score: grade.score,
      maxPoints: grade.maxPoints,
      feedback: grade.feedback,
      questionPoints: sortedRecord(scores.map((row) => [row.questionId, row.points] as const)),
    };
  }

  private async describe(
    executor: DbExecutor,
    quiz: QuizContext,
    student: GradedStudent,
  ): Promise<GradingView> {
    const [[latest], [grade]] = await Promise.all([
      executor
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.assessmentId, quiz.assessmentId),
            eq(attempts.studentId, student.id),
            eq(attempts.status, 'submitted'),
          ),
        )
        .orderBy(desc(attempts.number))
        .limit(1),
      executor
        .select()
        .from(grades)
        .where(and(eq(grades.assessmentId, quiz.assessmentId), eq(grades.studentId, student.id))),
    ]);
    const [attempt, questionPoints] = await Promise.all([
      latest ? this.gradedAttempt(executor, latest) : Promise.resolve(null),
      grade
        ? executor
            .select({
              questionId: gradeQuestionScores.questionId,
              points: gradeQuestionScores.points,
            })
            .from(gradeQuestionScores)
            .where(eq(gradeQuestionScores.gradeId, grade.id))
        : Promise.resolve([]),
    ]);
    const points = (attempt?.questions ?? []).reduce(
      (total, question) => total + question.points,
      0,
    );
    return {
      ...quiz,
      student,
      rubric: [],
      points,
      submissions: [],
      attempt,
      grade: grade
        ? {
            status: grade.status,
            score: grade.score,
            feedback: grade.feedback,
            levels: {},
            questionPoints: Object.fromEntries(
              questionPoints.map((row) => [row.questionId, row.points]),
            ),
            submissionId: null,
            attemptId: grade.attemptId,
            gradedAt: grade.gradedAt.toISOString(),
            releasedAt: grade.releasedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  private async gradedAttempt(executor: DbExecutor, attempt: AttemptRow): Promise<GradedAttempt> {
    const [questions, answers] = await Promise.all([
      executor
        .select()
        .from(assessmentQuestions)
        .where(eq(assessmentQuestions.assessmentId, attempt.assessmentId))
        .orderBy(asc(assessmentQuestions.position)),
      executor.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, attempt.id)),
    ]);
    const choiceIds = answers.flatMap((answer) => (answer.choiceId ? [answer.choiceId] : []));
    const choices =
      choiceIds.length === 0
        ? []
        : await executor
            .select()
            .from(questionChoices)
            .where(inArray(questionChoices.id, choiceIds));
    const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
    const graded: GradedQuestion[] = questions.map((question) => {
      const answer = byQuestion.get(question.id);
      const choice = choices.find((item) => item.id === answer?.choiceId);
      return {
        id: question.id,
        position: question.position,
        kind: question.kind,
        prompt: question.prompt,
        points: question.points,
        answer:
          question.kind === 'written'
            ? answer && answer.text.trim() !== ''
              ? answer.text
              : null
            : (choice?.text ?? null),
        correct: question.kind === 'multiple_choice' ? (choice?.correct ?? false) : null,
        awarded: question.kind === 'multiple_choice' ? (answer?.pointsAwarded ?? 0) : null,
      };
    });
    return {
      id: attempt.id,
      number: attempt.number,
      submittedAt: attempt.submittedAt!.toISOString(),
      autoSubmitted: attempt.autoSubmitted,
      score: attempt.score ?? 0,
      scoredPoints: attempt.scoredPoints ?? 0,
      questions: graded,
    };
  }
}
