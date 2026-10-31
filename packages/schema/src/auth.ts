import { z } from 'zod';
import { roleSchema } from './roles';

export const ACCOUNT_STATUSES = ['pending', 'active', 'deactivated'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Emails are compared case-insensitively, so they are trimmed and lowercased everywhere. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Argon2 hashes whatever it is given; the cap only stops oversized request bodies. */
export const PASSWORD_MAX_LENGTH = 256;

export const signInRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type SignInRequest = z.infer<typeof signInRequestSchema>;

export const currentUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  role: roleSchema,
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

/** Returned by sign-in and refresh. The refresh token travels only in an httpOnly cookie. */
export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: currentUserSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
