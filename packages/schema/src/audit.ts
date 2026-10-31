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
] as const;

const reasonRequired: ReadonlySet<string> = new Set(REASON_REQUIRED_ACTIONS);

export function isReasonRequired(action: string): boolean {
  return reasonRequired.has(action);
}

/** `module.verb` or `module.verb_detail`, lowercase, e.g. `grade.changed_after_release`. */
const actionSchema = z
  .string()
  .regex(/^[a-z][a-z_]*\.[a-z][a-z_]*$/, 'Action must look like "module.verb"')
  .max(100);

export const auditEventInputSchema = z
  .object({
    actorId: z.uuid().nullable(),
    actorRole: roleSchema.nullable(),
    action: actionSchema,
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
