import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_LENGTH, signInRequestSchema } from './auth';

describe('signInRequestSchema', () => {
  it('normalizes the email to trimmed lowercase', () => {
    const result = signInRequestSchema.parse({ email: '  Learner01@CCC.Test ', password: 'x' });

    expect(result.email).toBe('learner01@ccc.test');
  });

  it('rejects a malformed email or empty password', () => {
    expect(signInRequestSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(
      false,
    );
    expect(signInRequestSchema.safeParse({ email: 'a@ccc.test', password: '' }).success).toBe(
      false,
    );
  });

  it('rejects an oversized password', () => {
    const password = 'x'.repeat(PASSWORD_MAX_LENGTH + 1);

    expect(signInRequestSchema.safeParse({ email: 'a@ccc.test', password }).success).toBe(false);
  });
});
