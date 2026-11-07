import { z } from 'zod';
import { roleSchema } from './roles';

export const AUDIT_OUTCOMES = ['success', 'denied', 'failure'] as const;

/**
 * Actions that change official records or access. They must carry a reason
 * (wireframes T15, T21, A03, A04, A11, A19, X05).
 */
export const REASON_REQUIRED_ACTIONS = [
  'grade.changed_after_release',
  'indicator_rule.changed',
  'indicator.dismissed',
  'pathway.overridden',
  'account.deactivated',
  'account.role_changed',
  'role.permissions_changed',
  'resource.withdrawn',
  'grading_policy.changed',
  'backup.restored',
  'account.rejected',
  'account.reactivated',
  'account.mfa_reset',
  'course.archived',
  'enrollment.dropped',
] as const;

/**
 * Every action the system may record. A closed list, so a misspelled action fails validation
 * instead of quietly skipping the reason rule. Add new actions here as features land.
 */
export const KNOWN_ACTIONS = [
  ...REASON_REQUIRED_ACTIONS,
  'auth.signed_in',
  'auth.sign_in_failed',
  'auth.locked_out',
  'auth.signed_out',
  'auth.session_revoked',
  'auth.refresh_reused',
  'auth.mfa_enabled',
  'auth.mfa_disabled',
  'auth.mfa_failed',
  'auth.recovery_code_used',
  'auth.registered',
  'auth.registration_repeated',
  'auth.email_verified',
  'auth.password_reset_requested',
  'auth.password_reset',
  'auth.password_reset_failed',
  'auth.password_changed',
  'account.approved',
  'account.profile_updated',
  'program.created',
  'program.updated',
  'term.created',
  'term.made_current',
  'course.created',
  'course.updated',
  'course.restored',
  'section.created',
  'section.updated',
  'teacher.assigned',
  'teacher.unassigned',
  'enrollment.added',
  'objective.created',
  'objective.updated',
  'module.created',
  'module.updated',
  'module.moved',
  'module.published',
  'module.unpublished',
  'lesson.created',
  'lesson.updated',
  'lesson.published',
  'lesson.unpublished',
  'term.dates_changed',
  'grading_periods.set',
  'calendar_event.created',
  'calendar_event.updated',
  'calendar_event.removed',
  'assessment.created',
  'assessment.updated',
  'assessment.published',
  'assessment.unpublished',
  'question.created',
  'question.updated',
  'question.moved',
  'question.removed',
  'rubric.saved',
  'attempt.started',
  'attempt.submitted',
  'submission.drafted',
  'submission.submitted',
  'grade.saved',
  'grade.released',
  'resource.submitted',
  'resource.approved',
  'resource.returned',
  'intervention.assigned',
  'backup.completed',
] as const;

export type AuditAction = (typeof KNOWN_ACTIONS)[number];

const reasonRequired: ReadonlySet<string> = new Set(REASON_REQUIRED_ACTIONS);

export function isReasonRequired(action: string): boolean {
  return reasonRequired.has(action);
}

export const auditEventInputSchema = z
  .object({
    actorId: z.uuid().nullable(),
    actorRole: roleSchema.nullable(),
    action: z.enum(KNOWN_ACTIONS),
    targetType: z.string().min(1).max(60).nullable(),
    targetId: z.string().min(1).max(100).nullable(),
    outcome: z.enum(AUDIT_OUTCOMES),
    reason: z.string().trim().min(3).max(1000).nullable(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
    ipAddress: z.string().max(64).nullable(),
    userAgent: z.string().max(512).nullable(),
  })
  // Only completed changes need a reason; denied or failed attempts must still be recorded.
  .refine(
    (event) =>
      event.outcome !== 'success' || !isReasonRequired(event.action) || event.reason !== null,
    { message: 'This action requires a reason', path: ['reason'] },
  );

export type AuditEventInput = z.infer<typeof auditEventInputSchema>;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
