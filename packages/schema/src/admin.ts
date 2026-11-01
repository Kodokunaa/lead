import { z } from 'zod';
import { ACCOUNT_STATUSES, newPasswordSchema, PASSWORD_MAX_LENGTH } from './auth';
import { roleSchema } from './roles';

/** Why an administrator made a consequential change; stored in the audit trail. */
export const reasonSchema = z
  .string()
  .trim()
  .min(3, 'Give a reason of at least 3 characters.')
  .max(1000);

export const USER_PAGE_SIZE = 25;

export const userListQuerySchema = z.object({
  status: z.enum(ACCOUNT_STATUSES).optional(),
  role: roleSchema.optional(),
  /** Matches name or email, case-insensitively. */
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const userSummarySchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  role: roleSchema,
  status: z.enum(ACCOUNT_STATUSES),
  emailVerified: z.boolean(),
  mfaEnabled: z.boolean(),
  createdAt: z.string(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const userListResponseSchema = z.object({
  items: z.array(userSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Accounts that confirmed their email and wait for approval (A16 queue size). */
  awaitingApproval: z.number().int(),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;

export const userActivitySchema = z.object({
  id: z.uuid(),
  occurredAt: z.string(),
  action: z.string(),
  outcome: z.string(),
  reason: z.string().nullable(),
  actorName: z.string().nullable(),
});
export type UserActivity = z.infer<typeof userActivitySchema>;

export const userDetailsSchema = userSummarySchema.extend({
  lockedUntil: z.string().nullable(),
  activeSessions: z.number().int(),
  lastSignInAt: z.string().nullable(),
  activity: z.array(userActivitySchema),
});
export type UserDetails = z.infer<typeof userDetailsSchema>;

export const reasonRequestSchema = z.object({ reason: reasonSchema });
export type ReasonRequest = z.infer<typeof reasonRequestSchema>;

/** Resetting someone's MFA also needs the administrator's password, so a stolen token is not enough. */
export const mfaResetRequestSchema = z.object({
  reason: reasonSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type MfaResetRequest = z.infer<typeof mfaResetRequestSchema>;

export const roleChangeRequestSchema = z.object({ role: roleSchema, reason: reasonSchema });
export type RoleChangeRequest = z.infer<typeof roleChangeRequestSchema>;

/** One signed-in device, for the sessions list on the security page (H08). */
export const sessionSummarySchema = z.object({
  id: z.uuid(),
  startedAt: z.string(),
  lastActiveAt: z.string(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(2, 'Use at least 2 characters.').max(120),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: newPasswordSchema,
});
export type PasswordChange = z.infer<typeof passwordChangeSchema>;
