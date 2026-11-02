import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';
import type { ClientInfo } from './auth.service';

/**
 * Per IP. Generous because a whole classroom may share one campus IP; per-account lockout is
 * what stops password guessing. This only blunts floods from a single address.
 */
export const SIGN_IN_LIMIT_PER_MINUTE = 60;
export const SIGN_IN_LIMIT = { default: { limit: SIGN_IN_LIMIT_PER_MINUTE, ttl: 60_000 } };
/** Each signed-in user refreshes about every 15 minutes; this only stops floods. */
export const REFRESH_LIMIT = { default: { limit: 300, ttl: 60_000 } };
/** Registration and reset emails: enough for a class enrolling at once, not for spamming. */
export const ACCOUNT_REQUEST_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/** Validates a request body, answering 400 with a message fit to show the user. */
export function parseBody<T extends z.ZodType>(
  schema: T,
  body: unknown,
  message: string,
): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(message);
  return result.data;
}

/**
 * Like parseBody, but answers with the schema's own message for the first problem when the
 * schema wrote one for the user (custom checks such as "Mark exactly one choice as correct").
 * Zod's built-in messages are technical, so those fall back to `message`.
 */
export function parseBodyExplained<T extends z.ZodType>(
  schema: T,
  body: unknown,
  message: string,
): z.output<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const explained = issue && (issue.code === 'custom' || /^[A-Z].*\.$/.test(issue.message));
  throw new BadRequestException(explained ? issue.message : message);
}

export function clientInfo(request: Request): ClientInfo {
  const userAgent = request.headers['user-agent'];
  return {
    ipAddress: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
  };
}
