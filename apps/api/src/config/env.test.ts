import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const valid = {
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgres://lead:secret@127.0.0.1:5432/lead',
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
    expect(() => loadEnv({ API_PORT: 'abc' })).toThrow(/API_PORT.*WEB_ORIGIN.*DATABASE_URL/s);
  });

  it('rejects a non-Postgres database URL', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://x@localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
