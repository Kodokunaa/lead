import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AuditAction,
  ReleasedGrade,
  RubricCriterion,
  StudentAssignment,
  SubmissionFile,
} from '@lead/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { ClientInfo } from '../auth/auth.service';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import {
  assessmentObjectives,
  assessments,
  classSections,
  courses,
  enrollments,
  gradeRubricScores,
  grades,
  learningObjectives,
  rubricCriteria,
  rubricLevels,
  submissions,
  type AssessmentRow,
  type SubmissionRow,
  type UserRow,
} from '../database/schema';
import {
  checkUpload,
  ResourceStorage,
  type UploadedResourceFile,
} from '../resources/resource-files';
import type { OpenedFile } from '../resources/resources.service';
import { submissionBlockedReason } from './submission-rules';

export interface Submitter {
  readonly student: UserRow;
  readonly client: ClientInfo;
}

interface Visible {
  readonly assessment: AssessmentRow;
  readonly sectionName: string;
  readonly courseCode: string;
  readonly courseTitle: string;
}

const NOT_FOUND = 'No such assignment among your classes.';
const objectiveCode = (number: number): string => `O${number}`;

/** Published assignments and projects only. */
export const SUBMISSION_KINDS = ['assignment', 'project'] as const;

/**
 * Students' side of assignments and projects (wireframe S12). Only students enrolled (not
 * dropped) in the class see them; anything else is the same 404. Uploading and submitting lock
 * the student's enrollment row, so two tabs never make two drafts or skip a submission number.
 * Files are checked and stored before the transaction and removed again if it fails.
 */
@Injectable()
export class SubmissionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly storage: ResourceStorage,
  ) {}

  async assignment(student: UserRow, assessmentId: string): Promise<StudentAssignment> {
    const visible = await this.visible(this.db, student, assessmentId);
    return this.describe(this.db, student, visible);
  }

  /** Uploads a file as the draft, replacing the previous draft. */
  async saveDraft(
    assessmentId: string,
    file: UploadedResourceFile | undefined,
    note: string,
    submitter: Submitter,
  ): Promise<StudentAssignment> {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    const checked = checkUpload(file);
    const storedName = await this.storage.save(checked.buffer);
    // The draft file this upload replaces, removed once the new one is committed.
    const replaced: { storedName: string | null } = { storedName: null };
    let result: StudentAssignment;
    try {
      result = await this.db.transaction(async (tx) => {
        const visible = await this.lockForStudent(tx, submitter.student, assessmentId);
        const mine = await this.mine(tx, submitter.student, assessmentId);
        const reason = this.blocked(visible.assessment, mine);
        if (reason) throw new ConflictException(reason);
        const values = {
          fileName: checked.fileName,
          storedName,
          contentType: checked.contentType,
          sizeBytes: checked.sizeBytes,
          sha256: checked.sha256,
          note,
          savedAt: new Date(),
        };
        const draft = mine.find((row) => row.status === 'draft');
        let draftId: string;
        if (draft) {
          replaced.storedName = draft.storedName;
          await tx.update(submissions).set(values).where(eq(submissions.id, draft.id));
          draftId = draft.id;
        } else {
          const [created] = await tx
            .insert(submissions)
            .values({ assessmentId, studentId: submitter.student.id, ...values })
            .returning({ id: submissions.id });
          if (!created) throw new ConflictException('The file could not be saved.');
          draftId = created.id;
        }
        await this.record(tx, submitter, 'submission.drafted', draftId, {
          assessmentId,
          fileName: checked.fileName,
          sizeBytes: checked.sizeBytes,
          sha256: checked.sha256,
        });
        return this.describe(tx, submitter.student, visible);
      });
    } catch (error) {
      // Not committed: the new file goes. A failed cleanup must not hide the real error.
      await this.storage.remove(storedName).catch(() => undefined);
      throw error;
    }
    // Committed: the replaced draft's file goes; if that fails it is only an orphan on disk.
    if (replaced.storedName) await this.storage.remove(replaced.storedName).catch(() => undefined);
    return result;
  }

  /** Confirms the draft as the next numbered submission. */
  async submit(assessmentId: string, submitter: Submitter): Promise<StudentAssignment> {
    return this.db.transaction(async (tx) => {
      const visible = await this.lockForStudent(tx, submitter.student, assessmentId);
      const mine = await this.mine(tx, submitter.student, assessmentId);
      const draft = mine.find((row) => row.status === 'draft');
      if (!draft) throw new ConflictException('Upload a file before submitting.');
      const now = new Date();
      const reason = this.blocked(visible.assessment, mine, now);
      if (reason) throw new ConflictException(reason);
      const number = mine.filter((row) => row.status === 'submitted').length + 1;
      const late = now >= visible.assessment.dueAt!;
      await tx
        .update(submissions)
        .set({ status: 'submitted', number, submittedAt: now, late })
        .where(eq(submissions.id, draft.id));
      await this.record(tx, submitter, 'submission.submitted', draft.id, {
        assessmentId,
        number,
        late,
        fileName: draft.fileName,
        sha256: draft.sha256,
      });
      return this.describe(tx, submitter.student, visible);
    });
  }

  /** The student's own file, draft or submitted. */
  async file(student: UserRow, submissionId: string): Promise<OpenedFile> {
    const [row] = await this.db
      .select()
      .from(submissions)
      .where(and(eq(submissions.id, submissionId), eq(submissions.studentId, student.id)));
    if (!row) throw new NotFoundException('No such submission.');
    await this.visible(this.db, student, row.assessmentId).catch((error: unknown) => {
      if (error instanceof NotFoundException) throw new NotFoundException('No such submission.');
      throw error;
    });
    return {
      stream: await this.storage.open(row.storedName),
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
    };
  }

  // ---------- Helpers

  private blocked(
    assessment: AssessmentRow,
    mine: readonly SubmissionRow[],
    now: Date = new Date(),
  ): string | null {
    return submissionBlockedReason(
      {
        opensAt: assessment.opensAt!,
        dueAt: assessment.dueAt!,
        maxAttempts: assessment.maxAttempts,
        acceptLate: assessment.acceptLate,
      },
      mine.filter((row) => row.status === 'submitted').length,
      now,
    );
  }

  /**
   * Shares the assessment row (a teacher cannot unpublish it meanwhile), then locks the
   * student's enrollment row and checks it again, so a drop that committed meanwhile shows.
   */
  private async lockForStudent(
    tx: DbExecutor,
    student: UserRow,
    assessmentId: string,
  ): Promise<Visible> {
    const visible = await this.visible(tx, student, assessmentId, true);
    const [enrollment] = await tx
      .select({ status: enrollments.status })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.sectionId, visible.assessment.sectionId),
          eq(enrollments.studentId, student.id),
        ),
      )
      .for('update');
    if (enrollment?.status !== 'enrolled') throw new NotFoundException(NOT_FOUND);
    return visible;
  }

  private mine(tx: DbExecutor, student: UserRow, assessmentId: string): Promise<SubmissionRow[]> {
    return tx
      .select()
      .from(submissions)
      .where(and(eq(submissions.assessmentId, assessmentId), eq(submissions.studentId, student.id)))
      .orderBy(asc(submissions.number));
  }

  private async describe(
    executor: DbExecutor,
    student: UserRow,
    visible: Visible,
  ): Promise<StudentAssignment> {
    const { assessment } = visible;
    const [objectives, rubric, mine, grade] = await Promise.all([
      executor
        .select({ number: learningObjectives.number, description: learningObjectives.description })
        .from(assessmentObjectives)
        .innerJoin(learningObjectives, eq(learningObjectives.id, assessmentObjectives.objectiveId))
        .where(eq(assessmentObjectives.assessmentId, assessment.id))
        .orderBy(asc(learningObjectives.number)),
      loadRubric(executor, assessment.id),
      this.mine(executor, student, assessment.id),
      this.releasedGrade(executor, student, assessment.id),
    ]);
    return {
      id: assessment.id,
      sectionId: assessment.sectionId,
      sectionName: visible.sectionName,
      courseCode: visible.courseCode,
      courseTitle: visible.courseTitle,
      kind: assessment.kind,
      title: assessment.title,
      instructions: assessment.instructions,
      objectives: objectives.map((row) => ({
        code: objectiveCode(row.number),
        description: row.description,
      })),
      opensAt: assessment.opensAt!.toISOString(),
      dueAt: assessment.dueAt!.toISOString(),
      acceptLate: assessment.acceptLate,
      maxSubmissions: assessment.maxAttempts,
      rubric,
      points: rubricTotal(rubric),
      // Newest first: the draft, then the latest submission.
      submissions: [...mine].reverse().map(toSubmissionFile),
      blockedReason: this.blocked(assessment, mine),
      grade,
    };
  }

  /** The grade, once the teacher has released it. */
  private async releasedGrade(
    executor: DbExecutor,
    student: UserRow,
    assessmentId: string,
  ): Promise<ReleasedGrade | null> {
    const [row] = await executor
      .select({ grade: grades, number: submissions.number })
      .from(grades)
      .leftJoin(submissions, eq(submissions.id, grades.submissionId))
      .where(
        and(
          eq(grades.assessmentId, assessmentId),
          eq(grades.studentId, student.id),
          eq(grades.status, 'released'),
        ),
      );
    if (!row) return null;
    const levels = await executor
      .select({
        criterion: rubricCriteria.name,
        level: rubricLevels.label,
        points: rubricLevels.points,
      })
      .from(gradeRubricScores)
      .innerJoin(rubricCriteria, eq(rubricCriteria.id, gradeRubricScores.criterionId))
      .innerJoin(rubricLevels, eq(rubricLevels.id, gradeRubricScores.levelId))
      .where(eq(gradeRubricScores.gradeId, row.grade.id))
      .orderBy(asc(rubricCriteria.position));
    return {
      score: row.grade.score,
      maxPoints: row.grade.maxPoints,
      feedback: row.grade.feedback,
      releasedAt: row.grade.releasedAt!.toISOString(),
      submissionNumber: row.number,
      levels,
    };
  }

  /** A published assignment or project of a class the student is enrolled in. */
  private async visible(
    executor: DbExecutor,
    student: UserRow,
    assessmentId: string,
    lock = false,
  ): Promise<Visible> {
    const query = executor
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
      .where(
        and(
          eq(assessments.id, assessmentId),
          eq(enrollments.status, 'enrolled'),
          eq(assessments.status, 'published'),
          inArray(assessments.kind, [...SUBMISSION_KINDS]),
        ),
      )
      .limit(1);
    const [row] = lock ? await query.for('share', { of: assessments }) : await query;
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private async record(
    tx: DbExecutor,
    submitter: Submitter,
    action: AuditAction,
    submissionId: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(
      {
        actorId: submitter.student.id,
        actorRole: submitter.student.role,
        action,
        targetType: 'submission',
        targetId: submissionId,
        outcome: 'success',
        reason: null,
        before: null,
        after,
        ipAddress: submitter.client.ipAddress,
        userAgent: submitter.client.userAgent,
      },
      tx,
    );
  }
}

export function toSubmissionFile(row: SubmissionRow): SubmissionFile {
  return {
    id: row.id,
    number: row.number ?? 0,
    status: row.status,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    note: row.note,
    savedAt: row.savedAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    late: row.late,
  };
}

/** An assessment's rubric, criteria and levels in order. */
export async function loadRubric(
  executor: DbExecutor,
  assessmentId: string,
): Promise<RubricCriterion[]> {
  const rows = await executor
    .select({ criterion: rubricCriteria, level: rubricLevels })
    .from(rubricCriteria)
    .innerJoin(rubricLevels, eq(rubricLevels.criterionId, rubricCriteria.id))
    .where(eq(rubricCriteria.assessmentId, assessmentId))
    .orderBy(asc(rubricCriteria.position), asc(rubricLevels.position));
  const byCriterion = new Map<string, RubricCriterion>();
  for (const { criterion, level } of rows) {
    const existing = byCriterion.get(criterion.id);
    byCriterion.set(criterion.id, {
      id: criterion.id,
      name: criterion.name,
      levels: [
        ...(existing?.levels ?? []),
        { id: level.id, label: level.label, points: level.points, descriptor: level.descriptor },
      ],
    });
  }
  return [...byCriterion.values()];
}

/** A rubric is worth the best level of every criterion. */
export function rubricTotal(rubric: readonly RubricCriterion[]): number {
  return rubric.reduce(
    (total, criterion) => total + Math.max(0, ...criterion.levels.map((level) => level.points)),
    0,
  );
}
