import { describe, expect, it } from 'vitest';
import { auditEventInputSchema, isReasonRequired, type AuditEventInput } from './audit';

const baseEvent: AuditEventInput = {
  actorId: '7f9c2d1e-3b4a-4c5d-8e6f-0a1b2c3d4e5f',
  actorRole: 'teacher',
  action: 'intervention.assigned',
  targetType: 'intervention',
  targetId: 'plan-001',
  outcome: 'success',
  reason: null,
  before: null,
  after: { status: 'planned' },
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

describe('auditEventInputSchema', () => {
  it('accepts an ordinary event without a reason', () => {
    expect(auditEventInputSchema.safeParse(baseEvent).success).toBe(true);
  });

  it('rejects a grade change after release when no reason is given', () => {
    const result = auditEventInputSchema.safeParse({
      ...baseEvent,
      action: 'grade.changed_after_release',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['reason']);
  });

  it('accepts a grade change after release when a reason is given', () => {
    const result = auditEventInputSchema.safeParse({
      ...baseEvent,
      action: 'grade.changed_after_release',
      reason: 'Rubric correction',
      before: { score: 8 },
      after: { score: 10 },
    });

    expect(result.success).toBe(true);
  });

  it('records a denied attempt at a consequential action without a reason', () => {
    const result = auditEventInputSchema.safeParse({
      ...baseEvent,
      action: 'grade.changed_after_release',
      outcome: 'denied',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a whitespace-only reason', () => {
    const result = auditEventInputSchema.safeParse({
      ...baseEvent,
      action: 'resource.withdrawn',
      reason: '   ',
    });

    expect(result.success).toBe(false);
  });

  it('rejects actions that are not in module.verb form', () => {
    for (const action of ['Grade.Changed', 'grade', 'grade changed', '.changed']) {
      expect(auditEventInputSchema.safeParse({ ...baseEvent, action }).success).toBe(false);
    }
  });

  it('allows system events with no actor', () => {
    const result = auditEventInputSchema.safeParse({
      ...baseEvent,
      actorId: null,
      actorRole: null,
      action: 'backup.completed',
    });

    expect(result.success).toBe(true);
  });
});

describe('isReasonRequired', () => {
  it('is true for consequential actions and false for routine ones', () => {
    expect(isReasonRequired('account.deactivated')).toBe(true);
    expect(isReasonRequired('user.signed_in')).toBe(false);
  });
});
