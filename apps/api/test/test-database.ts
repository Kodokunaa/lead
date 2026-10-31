import { runMigrations } from '../src/database/migrate';

/**
 * Integration tests run against the `lead_test` database created by infra/postgres-init.
 * Migrations run as the owner (TEST_MIGRATION_DATABASE_URL); the code under test connects as
 * the runtime role (TEST_DATABASE_URL), exactly as the API does. Start it with `pnpm services:up`.
 */
function requireTestUrl(name: 'TEST_DATABASE_URL' | 'TEST_MIGRATION_DATABASE_URL'): string {
  const url = process.env[name];
  if (!url) {
    throw new Error(`${name} is not set. Copy .env.example to .env and run pnpm services:up.`);
  }
  // Audit rows cannot be deleted, so never let tests write to a non-test database.
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error(`${name} must point at a database whose name ends in "_test".`);
  }
  return url;
}

export interface TestDatabase {
  /** Runtime role (lead_app) — what the API uses. */
  readonly appUrl: string;
  /** Database owner — for assertions that need to bypass the app's privileges. */
  readonly ownerUrl: string;
}

export async function prepareTestDatabase(): Promise<TestDatabase> {
  const appUrl = requireTestUrl('TEST_DATABASE_URL');
  const ownerUrl = requireTestUrl('TEST_MIGRATION_DATABASE_URL');
  await runMigrations(ownerUrl, appUrl);
  return { appUrl, ownerUrl };
}

/** Values the API needs that are not about the database. */
export function setTestApiEnv(appUrl: string): void {
  process.env.DATABASE_URL = appUrl;
  process.env.WEB_ORIGIN ??= 'http://localhost:5173';
  process.env.JWT_SECRET ??= 'test-only-jwt-secret-that-is-long-enough';
  process.env.MFA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64url');
}
