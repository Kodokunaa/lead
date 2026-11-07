import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SAVE_GRACE_SECONDS,
  usesQuestions,
  type GradeInput,
  type GradingQueue,
  type GradingView,
  type QueueItem,
  type QueueStatus,
} from '@lead/schema';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import {
  academicTerms,
  assessmentQuestions,
  assessments,
  attempts,
  classSections,
  courses,
  enrollments,
  gradeRubricScores,
  grades,
  submissions,
  teachingAssignments,
  users,
  type AssessmentRow,
  type AttemptRow,
  type GradeRow,
  type SubmissionRow,
  type UserRow,
} from '../database/schema';
import { ResourceStorage } from '../resources/resource-files';
import type { OpenedFile } from '../resources/resources.service';
import { sortedRecord, writeGrade, type Grader } from './grade-writer';
import { QuizGradingService, type QuizContext } from './quiz-grading.service';
import { loadRubric, rubricTotal, toSubmissionFile } from './submissions.service';

export type { Grader } from './grade-writer';

interface Taught {
  readonly assessment: AssessmentRow;
  readonly sectionName: string;
  readonly courseCode: string;
  readonly courseTitle: string;
}

const NOT_FOUND = 'No such assessment among your classes this term.';
const QUEUE_ORDER: Record<QueueStatus, number> = {
  needs_review: 0,
  draft_grade: 1,
  missing: 2,
  released: 3,
};

/**
 * Teachers' grading of assignments and projects (wireframes T13, T14, X05). Only teachers of
 * the class this term; students must still be enrolled. Saving a grade locks the graded
 * submission and the grade row, so two teachers of a class never overwrite each other unseen.
 * A released grade changes only with a reason, recorded in the audit trail.
 */
@Injectable()
export class GradingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly storage: ResourceStorage,
    private readonly quizzes: QuizGradingService,
  ) {}

  /** T13: every enrolled student's latest submission, or a missing one past the due date. */
  async queue(teacher: UserRow, sectionId?: string, status?: QueueStatus): Promise<GradingQueue> {
    const taught = await this.taughtQuery(this.db, teacher)
      .where(
        and(
          this.taughtWhere(teacher),
          sectionId === undefined ? undefined : eq(assessments.sectionId, sectionId),
        ),
      )
      .orderBy(asc(assessments.dueAt));
    const classes = await this.db
      .selectDistinct({ id: classSections.id, name: classSections.name, courseCode: courses.code })
      .from(teachingAssignments)
      .innerJoin(classSections, eq(classSections.id, teachingAssignments.sectionId))
      .innerJoin(academicTerms, eq(academicTerms.id, classSections.termId))
      .innerJoin(courses, eq(courses.id, classSections.courseId))
      .where(and(eq(teachingAssignments.teacherId, teacher.id), eq(academicTerms.current, true)))
      .orderBy(asc(courses.code), asc(classSections.name));
    if (taught.length === 0) return { classes, items: [] };

    // Quizzes need a teacher only when they have written questions.
    const quizIds = taught
      .filter((row) => usesQuestions(row.assessment.kind))
      .map((row) => row.assessment.id);
    const withWritten = new Set(
      quizIds.length === 0
        ? []
        : (
            await this.db
              .selectDistinct({ id: assessmentQuestions.assessmentId })
              .from(assessmentQuestions)
              .where(
                and(
                  inArray(assessmentQuestions.assessmentId, quizIds),
                  eq(assessmentQuestions.kind, 'written'),
                ),
              )
          ).map((row) => row.id),
    );
    const graded = taught.filter(
      (row) => !usesQuestions(row.assessment.kind) || withWritten.has(row.assessment.id),
    );
    if (graded.length === 0) return { classes, items: [] };
    const assessmentIds = graded.map((row) => row.assessment.id);
    const sectionIds = [...new Set(graded.map((row) => row.assessment.sectionId))];
    const [students, submitted, attemptRows, gradeRows] = await Promise.all([
      this.db
        .select({ sectionId: enrollments.sectionId, id: users.id, name: users.displayName })
        .from(enrollments)
        .innerJoin(users, eq(users.id, enrollments.studentId))
        .where(and(inArray(enrollments.sectionId, sectionIds), eq(enrollments.status, 'enrolled')))
        .orderBy(asc(users.displayName)),
      this.db
        .select()
        .from(submissions)
        .where(
          and(
            inArray(submissions.assessmentId, assessmentIds),
            eq(submissions.status, 'submitted'),
          ),
        )
        .orderBy(desc(submissions.number)),
      this.db
        .select()
        .from(attempts)
        .where(inArray(attempts.assessmentId, assessmentIds))
        .orderBy(desc(attempts.number)),
      this.db.select().from(grades).where(inArray(grades.assessmentId, assessmentIds)),
    ]);

    const now = new Date();
    const items: QueueItem[] = [];
    for (const { assessment, sectionName, courseCode } of graded) {
      for (const student of students.filter((row) => row.sectionId === assessment.sectionId)) {
        const mine = (row: { assessmentId: string; studentId: string }) =>
          row.assessmentId === assessment.id && row.studentId === student.id;
        const latest = usesQuestions(assessment.kind)
          ? latestAttempt(attemptRows.filter(mine), now)
          : latestSubmission(submitted.find(mine));
        const grade = gradeRows.find(mine);
        const itemStatus = queueStatus(latest, grade, assessment, now);
        if (!itemStatus || (status && itemStatus !== status)) continue;
        items.push({
          assessmentId: assessment.id,
          title: assessment.title,
          kind: assessment.kind,
          sectionId: assessment.sectionId,
          sectionName,
          courseCode,
          studentId: student.id,
          studentName: student.name,
          submittedAt: latest?.submittedAt?.toISOString() ?? null,
          late: latest?.late ?? false,
          status: itemStatus,
        });
      }
    }
    items.sort(
      (a, b) =>
        QUEUE_ORDER[a.status] - QUEUE_ORDER[b.status] ||
        (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''),
    );
    return { classes, items };
  }

  /** T14: one student's submissions and grade. */
  async view(grader: Grader, assessmentId: string, studentId: string): Promise<GradingView> {
    const taught = await this.taught(this.db, grader.teacher, assessmentId);
    const student = await this.enrolledStudent(this.db, taught, studentId);
    if (usesQuestions(taught.assessment.kind)) {
      return this.quizzes.view(quizContext(taught), student, grader);
    }
    return this.describe(this.db, taught, student);
  }

  async file(teacher: UserRow, assessmentId: string, submissionId: string): Promise<OpenedFile> {
    // Drafts stay private to the student.
    const taught = await this.taught(this.db, teacher, assessmentId);
    const [found] = await this.db
      .select({ submission: submissions })
      .from(submissions)
      .innerJoin(
        enrollments,
        and(
          eq(enrollments.studentId, submissions.studentId),
          eq(enrollments.sectionId, taught.assessment.sectionId),
          eq(enrollments.status, 'enrolled'),
        ),
      )
      .where(
        and(
          eq(submissions.id, submissionId),
          eq(submissions.assessmentId, assessmentId),
          eq(submissions.status, 'submitted'),
        ),
      );
    if (!found) throw new NotFoundException('No such submission.');
    const row = found.submission;
    return {
      stream: await this.storage.open(row.storedName),
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
    };
  }

  /** Saves the grade of the student's latest submission; releases it on request. */
  async saveGrade(
    assessmentId: string,
    studentId: string,
    input: GradeInput,
    grader: Grader,
  ): Promise<GradingView> {
    return this.db.transaction(async (tx) => {
      const taught = await this.taught(tx, grader.teacher, assessmentId, true);
      const student = await this.enrolledStudent(tx, taught, studentId);
      if (usesQuestions(taught.assessment.kind)) {
        return this.quizzes.save(tx, quizContext(taught), student, input, grader);
      }
      const [latest] = await tx
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.assessmentId, assessmentId),
            eq(submissions.studentId, studentId),
            eq(submissions.status, 'submitted'),
          ),
        )
        .orderBy(desc(submissions.number))
        .limit(1)
        .for('update');
      if (!latest) throw new ConflictException('There is no submission to grade yet.');

      const rubric = await loadRubric(tx, assessmentId);
      const chosen = rubric.map((criterion) => {
        const level = criterion.levels.find((item) => item.id === input.levels[criterion.id]);
        if (!level) throw new BadRequestException(`Choose a level for "${criterion.name}".`);
        return { criterionId: criterion.id, levelId: level.id, points: level.points };
      });
      if (Object.keys(input.levels).length !== rubric.length) {
        throw new BadRequestException('Choose levels for this rubric’s criteria only.');
      }
      const score = chosen.reduce((total, item) => total + item.points, 0);
      const maxPoints = rubricTotal(rubric);

      const [existing] = await tx
        .select()
        .from(grades)
        .where(and(eq(grades.assessmentId, assessmentId), eq(grades.studentId, studentId)))
        .for('update');
      await writeGrade(
        tx,
        this.audit,
        grader,
        {
          assessmentId,
          studentId,
          existing,
          target: { submissionId: latest.id },
          score,
          maxPoints,
          feedback: input.feedback,
          release: input.release,
          reason: input.reason,
          before: existing ? await this.gradeAudit(tx, existing) : null,
          after: {
            submissionNumber: latest.number,
            score,
            maxPoints,
            feedback: input.feedback,
            levels: sortedRecord(chosen.map((item) => [item.criterionId, item.levelId] as const)),
          },
        },
        async (gradeId) => {
          await tx.delete(gradeRubricScores).where(eq(gradeRubricScores.gradeId, gradeId));
          if (chosen.length === 0) return;
          await tx
            .insert(gradeRubricScores)
            .values(chosen.map(({ criterionId, levelId }) => ({ gradeId, criterionId, levelId })));
        },
      );
      return this.describe(tx, taught, student);
    });
  }

  // ---------- Helpers

  private async gradeAudit(tx: DbExecutor, grade: GradeRow): Promise<Record<string, unknown>> {
    const [levels, graded] = await Promise.all([
      tx
        .select({ criterionId: gradeRubricScores.criterionId, levelId: gradeRubricScores.levelId })
        .from(gradeRubricScores)
        .where(eq(gradeRubricScores.gradeId, grade.id)),
      grade.submissionId
        ? tx
            .select({ number: submissions.number })
            .from(submissions)
            .where(eq(submissions.id, grade.submissionId))
        : Promise.resolve([]),
    ]);
    return {
      submissionNumber: graded[0]?.number ?? null,
      score: grade.score,
      maxPoints: grade.maxPoints,
      feedback: grade.feedback,
      levels: sortedRecord(levels.map((row) => [row.criterionId, row.levelId] as const)),
    };
  }

  private async describe(
    executor: DbExecutor,
    taught: Taught,
    student: { id: string; name: string; email: string },
  ): Promise<GradingView> {
    const { assessment } = taught;
    const [rubric, mine, [grade]] = await Promise.all([
      loadRubric(executor, assessment.id),
      executor
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.assessmentId, assessment.id),
            eq(submissions.studentId, student.id),
            eq(submissions.status, 'submitted'),
            isNotNull(submissions.number),
          ),
        )
        .orderBy(desc(submissions.number)),
      executor
        .select()
        .from(grades)
        .where(and(eq(grades.assessmentId, assessment.id), eq(grades.studentId, student.id))),
    ]);
    const levels = grade
      ? await executor
          .select({
            criterionId: gradeRubricScores.criterionId,
            levelId: gradeRubricScores.levelId,
          })
          .from(gradeRubricScores)
          .where(eq(gradeRubricScores.gradeId, grade.id))
      : [];
    return {
      assessmentId: assessment.id,
      title: assessment.title,
      kind: assessment.kind,
      courseCode: taught.courseCode,
      courseTitle: taught.courseTitle,
      sectionName: taught.sectionName,
      dueAt: assessment.dueAt!.toISOString(),
      student,
      rubric,
      points: rubricTotal(rubric),
      submissions: mine.map(toSubmissionFile),
      attempt: null,
      grade: grade
        ? {
            status: grade.status,
            score: grade.score,
            feedback: grade.feedback,
            levels: Object.fromEntries(levels.map((row) => [row.criterionId, row.levelId])),
            questionPoints: {},
            submissionId: grade.submissionId,
            attemptId: null,
            gradedAt: grade.gradedAt.toISOString(),
            releasedAt: grade.releasedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  private async enrolledStudent(
    executor: DbExecutor,
    taught: Taught,
    studentId: string,
  ): Promise<{ id: string; name: string; email: string }> {
    const [row] = await executor
      .select({ id: users.id, name: users.displayName, email: users.email })
      .from(enrollments)
      .innerJoin(users, eq(users.id, enrollments.studentId))
      .where(
        and(
          eq(enrollments.sectionId, taught.assessment.sectionId),
          eq(enrollments.studentId, studentId),
          eq(enrollments.status, 'enrolled'),
        ),
      );
    if (!row) throw new NotFoundException('No such student in this class.');
    return row;
  }

  /** A published assignment or project of a class the teacher teaches this term. */
  private async taught(
    executor: DbExecutor,
    teacher: UserRow,
    assessmentId: string,
    lock = false,
  ): Promise<Taught> {
    const query = this.taughtQuery(executor, teacher)
      .where(and(this.taughtWhere(teacher), eq(assessments.id, assessmentId)))
      .limit(1);
    // The teacher's assignment row is shared, so it cannot be removed while a grade is saved.
    const [row] = lock ? await query.for('share', { of: teachingAssignments }) : await query;
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private taughtQuery(executor: DbExecutor, teacher: UserRow) {
    return executor
      .select({
        assessment: assessments,
        sectionName: classSections.name,
        courseCode: courses.code,
        courseTitle: courses.title,
      })
      .from(assessments)
      .innerJoin(classSections, eq(classSections.id, assessments.sectionId))
      .innerJoin(academicTerms, eq(academicTerms.id, classSections.termId))
      .innerJoin(courses, eq(courses.id, classSections.courseId))
      .innerJoin(
        teachingAssignments,
        and(
          eq(teachingAssignments.sectionId, assessments.sectionId),
          eq(teachingAssignments.teacherId, teacher.id),
        ),
      )
      .$dynamic();
  }

  private taughtWhere(teacher: UserRow) {
    return and(
      eq(teachingAssignments.teacherId, teacher.id),
      eq(academicTerms.current, true),
      eq(assessments.status, 'published'),
      // Quizzes too: those with written questions are graded here (QuizGradingService).
    );
  }
}

/** The work a queue row is about: a submission or a quiz attempt. */
interface LatestWork {
  readonly id: string;
  readonly submittedAt: Date;
  readonly late: boolean;
}

function latestSubmission(row: SubmissionRow | undefined): LatestWork | undefined {
  return row ? { id: row.id, submittedAt: row.submittedAt!, late: row.late } : undefined;
}

/** The newest finished attempt; one left open past its deadline counts as finished. */
function latestAttempt(rows: readonly AttemptRow[], now: Date): LatestWork | undefined {
  const graceMs = SAVE_GRACE_SECONDS * 1000;
  const done = rows.find(
    (row) => row.status === 'submitted' || now.getTime() > row.deadlineAt.getTime() + graceMs,
  );
  return done
    ? { id: done.id, submittedAt: done.submittedAt ?? done.deadlineAt, late: false }
    : undefined;
}

function queueStatus(
  latest: LatestWork | undefined,
  grade: GradeRow | undefined,
  assessment: AssessmentRow,
  now: Date,
): QueueStatus | null {
  if (!latest) return now >= assessment.dueAt! ? 'missing' : null;
  // Newer work than the graded one needs another look.
  if (!grade || (grade.submissionId ?? grade.attemptId) !== latest.id) return 'needs_review';
  return grade.status === 'released' ? 'released' : 'draft_grade';
}

function quizContext(taught: Taught): QuizContext {
  return {
    assessmentId: taught.assessment.id,
    title: taught.assessment.title,
    kind: taught.assessment.kind,
    courseCode: taught.courseCode,
    courseTitle: taught.courseTitle,
    sectionName: taught.sectionName,
    dueAt: taught.assessment.dueAt!.toISOString(),
  };
}
