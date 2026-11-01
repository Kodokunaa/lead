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
  /** Whether two-step verification is on, for the security page. */
  mfaEnabled: z.boolean(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

/** Returned by sign-in and refresh. The refresh token travels only in an httpOnly cookie. */
export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: currentUserSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** NIST SP 800-63B: length matters more than character rules, so only a minimum is enforced. */
export const PASSWORD_MIN_LENGTH = 12;

/** A password a user chooses (registration, reset). Sign-in accepts any stored password. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH);

/** Six-digit code from an authenticator app. Spaces are allowed, as apps often show them. */
export const totpCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'));

/** One-time recovery code, shown as XXXXX-XXXXX; case and dashes are ignored. */
export const recoveryCodeSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{10}$/, 'Enter a recovery code.'));

/** Sign-in answer when the password is right but a second factor is still needed. */
export const mfaChallengeResponseSchema = z.object({
  mfaRequired: z.literal(true),
  challengeToken: z.string(),
});
export type MfaChallengeResponse = z.infer<typeof mfaChallengeResponseSchema>;

export type SignInResponse = SessionResponse | MfaChallengeResponse;

export const mfaVerifyRequestSchema = z.union([
  z.object({ challengeToken: z.string().min(1).max(2048), code: totpCodeSchema }),
  z.object({ challengeToken: z.string().min(1).max(2048), recoveryCode: recoveryCodeSchema }),
]);
export type MfaVerifyRequest = z.infer<typeof mfaVerifyRequestSchema>;

export const mfaSetupResponseSchema = z.object({
  /** otpauth:// URI for the QR code. */
  otpauthUri: z.string(),
  /** The same secret in base32, for typing in by hand. */
  secret: z.string(),
});
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;

/** The password too, so a stolen access token alone cannot enrol an attacker's phone. */
export const mfaEnableRequestSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  code: totpCodeSchema,
});

export const mfaEnableResponseSchema = z.object({
  /** Shown once; only hashes are stored. */
  recoveryCodes: z.array(z.string()),
});
export type MfaEnableResponse = z.infer<typeof mfaEnableResponseSchema>;

export const mfaDisableRequestSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  code: totpCodeSchema,
});

/** Roles a person may ask for when registering; administrators are only appointed. */
export const REGISTRABLE_ROLES = ['student', 'teacher'] as const;

/**
 * No password here: it is chosen from the link emailed to the address, so only the person who
 * owns the email can complete the account (and an administrator then approves it).
 */
export const registerRequestSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(2).max(120),
  role: z.enum(REGISTRABLE_ROLES),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const forgotPasswordRequestSchema = z.object({ email: emailSchema });

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(20).max(200),
  password: newPasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/** Same shape as a reset: the emailed token plus the password the user chooses. */
export const verifyEmailRequestSchema = resetPasswordRequestSchema;
export type VerifyEmailRequest = ResetPasswordRequest;
