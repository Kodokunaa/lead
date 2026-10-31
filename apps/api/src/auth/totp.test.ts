import { recoveryCodeSchema } from '@lead/schema';
import { Secret, TOTP } from 'otpauth';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './secret-box';
import {
  hashRecoveryCode,
  matchTotp,
  newRecoveryCodes,
  newTotpSecret,
  RECOVERY_CODE_COUNT,
  totpUri,
} from './totp';

function codeAt(secret: string, timestamp: number): string {
  return new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp });
}

describe('TOTP', () => {
  const secret = newTotpSecret();
  const now = Date.UTC(2026, 10, 1, 8, 0, 0);

  it('matches the current code and returns its time step', () => {
    expect(matchTotp(secret, codeAt(secret, now), now)).toBe(Math.floor(now / 30_000));
  });

  it('tolerates one step of clock drift but not two', () => {
    expect(matchTotp(secret, codeAt(secret, now - 30_000), now)).toBe(Math.floor(now / 30_000) - 1);
    expect(matchTotp(secret, codeAt(secret, now - 90_000), now)).toBeNull();
  });

  it('rejects a code from another secret', () => {
    expect(matchTotp(newTotpSecret(), codeAt(secret, now), now)).toBeNull();
  });

  it('builds an otpauth URI naming the college and the account', () => {
    const uri = totpUri(secret, 'learner01@lead.test');

    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(decodeURIComponent(uri)).toContain('learner01@lead.test');
    expect(decodeURIComponent(uri)).toContain('City College of Calapan');
  });
});

describe('recovery codes', () => {
  it('creates distinct codes that the shared schema accepts', () => {
    const codes = newRecoveryCodes();

    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      expect(recoveryCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it('hashes the normalized form', () => {
    const normalized = recoveryCodeSchema.parse('abcde-fghjk');

    expect(hashRecoveryCode(normalized)).toBe(hashRecoveryCode('ABCDEFGHJK'));
  });
});

describe('secret box', () => {
  const key = Buffer.alloc(32, 3);
  const userId = 'user-a';

  it('round-trips a secret', () => {
    const sealed = encryptSecret('JBSWY3DPEHPK3PXP', key, userId);

    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(sealed, key, userId)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('refuses a tampered value, the wrong key, or another user', () => {
    const sealed = encryptSecret('JBSWY3DPEHPK3PXP', key, userId);
    const parts = sealed.split('.');
    const tampered = [...parts.slice(0, 3), Buffer.from('nope').toString('base64url')].join('.');
    const shortTag = [parts[0], parts[1], Buffer.alloc(4).toString('base64url'), parts[3]].join(
      '.',
    );

    expect(() => decryptSecret(tampered, key, userId)).toThrow();
    expect(() => decryptSecret(sealed, Buffer.alloc(32, 4), userId)).toThrow();
    expect(() => decryptSecret(sealed, key, 'user-b')).toThrow();
    expect(() => decryptSecret(shortTag, key, userId)).toThrow(/tag length/);
  });
});
