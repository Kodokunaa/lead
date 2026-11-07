import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AuditAction,
  GradeInput,
  GradingQueue,
  GradingView,
  QueueItem,
  QueueStatus,
} from '@lead/schema';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { ClientInfo } from '../auth/auth.service';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import {
  academicTerms,
  assessments,
  classSections,
  courses,
  enrollments,
  gradeRubricScores,
  grades,
  submissions,
  teachingAssignments,
  users,
  type AssessmentRow,
  type GradeRow,
  type SubmissionRow,
  type UserRow,
} from '../database/schema';
import { ResourceStorage } from '../resources/resource-files';
import type { OpenedFile } from '../resources/resources.service';
import { loadRubric, rubricTotal, SUBMISSION_KINDS, toSubmissionFile } from './submissions.service';

export interface Grader {
  readonly teacher: UserRow;
  readonly client: ClientInfo;
}

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

    const assessmentIds = taught.map((row) => row.assessment.id);
    const sectionIds = [...new Set(taught.map((row) => row.assessment.sectionId))];
    const [students, submitted, gradeRows] = await Promise.all([
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
      this.db.select().from(grades).where(inArray(grades.assessmentId, assessmentIds)),
    ]);

    const now = new Date();
    const items: QueueItem[] = [];
    for (const { assessment, sectionName, courseCode } of taught) {
      for (const student of students.filter((row) => row.sectionId === assessment.sectionId)) {
        const latest = submitted.find(
          (row) => row.assessmentId === assessment.id && row.studentId === student.id,
        );
        const grade = gradeRows.find(
          (row) => row.assessmentId === assessment.id && row.studentId === student.id,
        );
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
  async view(teacher: UserRow, assessmentId: string, studentId: string): Promise<GradingView> {
    const taught = await this.taught(this.db, teacher, assessmentId);
    const student = await this.enrolledStudent(this.db, taught, studentId);
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
      // Sorted like gradeAudit's, so an unchanged grade compares equal.
      const levels = Object.fromEntries(
        [...chosen]
          .sort((a, b) => a.criterionId.localeCompare(b.criterionId))
          .map((item) => [item.criterionId, item.levelId]),
      );
      const before = existing ? await this.gradeAudit(tx, existing) : null;
      const after = {
        submissionNumber: latest.number,
        score,
        maxPoints,
        feedback: input.feedback,
        levels,
      };
      const now = new Date();

      let action: AuditAction;
      let reason: string | null = null;
      if (existing?.status === 'released') {
        if (JSON.stringify(before) === JSON.stringify(after))
          return this.describe(tx, taught, student);
        if (!input.reason) {
          throw new BadRequestException('Give a reason for changing a released grade.');
        }
        action = 'grade.changed_after_release';
        reason = input.reason;
      } else {
        action = input.release ? 'grade.released' : 'grade.saved';
      }
      const released = existing?.status === 'released' || input.release;
      const values = {
        submissionId: latest.id,
        score,
        maxPoints,
        feedback: input.feedback,
        status: released ? ('released' as const) : ('draft' as const),
        gradedBy: grader.teacher.id,
        gradedAt: now,
        releasedAt: released ? (existing?.releasedAt ?? now) : null,
      };
      let gradeId: string;
      if (existing) {
        await tx.update(grades).set(values).where(eq(grades.id, existing.id));
        gradeId = existing.id;
      } else {
        const [created] = await tx
          .insert(grades)
          .values({ assessmentId, studentId, ...values })
          .returning({ id: grades.id });
        if (!created) throw new ConflictException('The grade could not be saved.');
        gradeId = created.id;
      }
      await tx.delete(gradeRubricScores).where(eq(gradeRubricScores.gradeId, gradeId));
      if (chosen.length > 0) {
        await tx
          .insert(gradeRubricScores)
          .values(chosen.map(({ criterionId, levelId }) => ({ gradeId, criterionId, levelId })));
      }
      await this.audit.record(
        {
          actorId: grader.teacher.id,
          actorRole: grader.teacher.role,
          action,
          targetType: 'grade',
          targetId: gradeId,
          outcome: 'success',
          reason,
          before,
          after: { ...after, studentId, assessmentId, status: values.status },
          ipAddress: grader.client.ipAddress,
          userAgent: grader.client.userAgent,
        },
        tx,
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
      levels: Object.fromEntries(
        [...levels]
          .sort((a, b) => a.criterionId.localeCompare(b.criterionId))
          .map((row) => [row.criterionId, row.levelId]),
      ),
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
      grade: grade
        ? {
            status: grade.status,
            score: grade.score,
            feedback: grade.feedback,
            levels: Object.fromEntries(levels.map((row) => [row.criterionId, row.levelId])),
            submissionId: grade.submissionId,
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
      inArray(assessments.kind, [...SUBMISSION_KINDS]),
    );
  }
}

function queueStatus(
  latest: SubmissionRow | undefined,
  grade: GradeRow | undefined,
  assessment: AssessmentRow,
  now: Date,
): QueueStatus | null {
  if (!latest) return now >= assessment.dueAt! ? 'missing' : null;
  // A newer submission than the graded one needs another look.
  if (!grade || grade.submissionId !== latest.id) return 'needs_review';
  return grade.status === 'released' ? 'released' : 'draft_grade';
}
