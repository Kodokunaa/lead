import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  recoveryCodeSchema,
  registerRequestSchema,
  signInRequestSchema,
  totpCodeSchema,
} from './auth';

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

describe('second-factor codes', () => {
  it('accepts a spaced 6-digit code and rejects anything else', () => {
    expect(totpCodeSchema.parse('123 456')).toBe('123456');
    expect(totpCodeSchema.safeParse('12345').success).toBe(false);
    expect(totpCodeSchema.safeParse('abcdef').success).toBe(false);
  });

  it('normalizes recovery codes', () => {
    expect(recoveryCodeSchema.parse('ab12c-de34f')).toBe('AB12CDE34F');
    expect(recoveryCodeSchema.safeParse('short').success).toBe(false);
  });
});

describe('registerRequestSchema', () => {
  const valid = {
    email: 'learner@ccc.test',
    displayName: 'Learner',
    role: 'student',
  };

  it('accepts a student or teacher request', () => {
    expect(registerRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses administrator self-registration', () => {
    expect(registerRequestSchema.safeParse({ ...valid, role: 'admin' }).success).toBe(false);
  });
});
