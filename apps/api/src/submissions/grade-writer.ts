import { BadRequestException, ConflictException } from '@nestjs/common';
import type { AuditAction } from '@lead/schema';
import { eq } from 'drizzle-orm';
import type { AuditService } from '../audit/audit.service';
import type { ClientInfo } from '../auth/auth.service';
import type { DbExecutor } from '../database/database.module';
import { grades, type GradeRow, type UserRow } from '../database/schema';

export interface Grader {
  readonly teacher: UserRow;
  readonly client: ClientInfo;
}

export interface GradeChange {
  readonly assessmentId: string;
  readonly studentId: string;
  /** The grade as it stands, locked by the caller. */
  readonly existing: GradeRow | undefined;
  /** What is graded: a submission (assignments) or an attempt (quizzes). */
  readonly target: { readonly submissionId: string } | { readonly attemptId: string };
  readonly score: number;
  readonly maxPoints: number;
  readonly feedback: string;
  readonly release: boolean;
  readonly reason: string | undefined;
  /**
   * The grade's details before and after, in the same shape and key order, so an unchanged
   * released grade compares equal and needs no reason.
   */
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown>;
}

/**
 * Saves a grade the same way for every kind of work (T14, X05): a draft until released; once
 * released it stays released, and changes only with a reason, recorded in the audit trail.
 * `writeScores` stores the per-criterion or per-question scores for the grade's id.
 * Returns false when a released grade was sent back unchanged (nothing is written).
 */
export async function writeGrade(
  tx: DbExecutor,
  audit: AuditService,
  grader: Grader,
  change: GradeChange,
  writeScores: (gradeId: string) => Promise<void>,
): Promise<boolean> {
  const { existing } = change;
  let action: AuditAction;
  let reason: string | null = null;
  if (existing?.status === 'released') {
    if (JSON.stringify(change.before) === JSON.stringify(change.after)) return false;
    if (!change.reason) {
      throw new BadRequestException('Give a reason for changing a released grade.');
    }
    action = 'grade.changed_after_release';
    reason = change.reason;
  } else {
    action = change.release ? 'grade.released' : 'grade.saved';
  }
  const released = existing?.status === 'released' || change.release;
  const now = new Date();
  const values = {
    submissionId: 'submissionId' in change.target ? change.target.submissionId : null,
    attemptId: 'attemptId' in change.target ? change.target.attemptId : null,
    score: change.score,
    maxPoints: change.maxPoints,
    feedback: change.feedback,
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
      .values({ assessmentId: change.assessmentId, studentId: change.studentId, ...values })
      .returning({ id: grades.id });
    if (!created) throw new ConflictException('The grade could not be saved.');
    gradeId = created.id;
  }
  await writeScores(gradeId);
  await audit.record(
    {
      actorId: grader.teacher.id,
      actorRole: grader.teacher.role,
      action,
      targetType: 'grade',
      targetId: gradeId,
      outcome: 'success',
      reason,
      before: change.before,
      after: {
        ...change.after,
        studentId: change.studentId,
        assessmentId: change.assessmentId,
        status: values.status,
      },
      ipAddress: grader.client.ipAddress,
      userAgent: grader.client.userAgent,
    },
    tx,
  );
  return true;
}

/** `{ id: value }` sorted by id, so the same choices always serialize the same way. */
export function sortedRecord<T>(entries: readonly (readonly [string, T])[]): Record<string, T> {
  return Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b)));
}
