import { createHash, randomInt } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';

const ISSUER = 'LEAD (City College of Calapan)';
const PERIOD_SECONDS = 30;
/** Accept the previous and next 30-second code too, for clock drift. */
const WINDOW = 1;

export const RECOVERY_CODE_COUNT = 10;
/** No 0/O or 1/I, so codes are easy to copy from paper. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpUri(secret: string, email: string): string {
  return totp(secret, email).toString();
}

/**
 * Returns the time step of the matching code, or null. Callers store the step and refuse
 * steps at or below it, so an observed code cannot be replayed.
 */
export function matchTotp(secret: string, code: string, now = Date.now()): number | null {
  const delta = totp(secret).validate({ token: code, timestamp: now, window: WINDOW });
  if (delta === null) return null;
  return Math.floor(now / 1000 / PERIOD_SECONDS) + delta;
}

/** Ten codes formatted XXXXX-XXXXX (about 50 bits each). */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const chars = Array.from(
      { length: 10 },
      () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
    ).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** Hash of a normalized code (no dash, uppercase; see recoveryCodeSchema). */
export function hashRecoveryCode(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}

function totp(secret: string, label = 'account'): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secret),
  });
}
