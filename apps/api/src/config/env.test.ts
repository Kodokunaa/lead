import { describe, expect, it } from 'vitest';
import { loadEnv, loadMigrationEnv } from './env';

const valid = {
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgres://lead_app:secret@127.0.0.1:5432/lead',
  JWT_SECRET: 'x'.repeat(32),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url'),
};

describe('loadEnv', () => {
  it('applies defaults for optional values', () => {
    const env = loadEnv(valid);
    expect(env.API_PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('normalizes the web origin', () => {
    expect(loadEnv({ ...valid, WEB_ORIGIN: 'http://localhost:5173/' }).WEB_ORIGIN).toBe(
      'http://localhost:5173',
    );
  });

  it('coerces the port from a string', () => {
    expect(loadEnv({ ...valid, API_PORT: '4100' }).API_PORT).toBe(4100);
  });

  it('lists every invalid variable in one error', () => {
    expect(() => loadEnv({ API_PORT: 'abc' })).toThrow(
      /API_PORT.*WEB_ORIGIN.*DATABASE_URL.*JWT_SECRET/s,
    );
  });

  it('rejects a non-Postgres database URL', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://x@localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a short JWT secret', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });
});

describe('loadMigrationEnv', () => {
  it('requires both the owner and runtime database URLs', () => {
    expect(() => loadMigrationEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrow(
      /MIGRATION_DATABASE_URL/,
    );
  });
});
