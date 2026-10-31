import { runMigrations } from '../src/database/migrate';

/**
 * Integration tests run against TEST_DATABASE_URL (the `lead_test` database created by
 * infra/postgres-init). Start it with `pnpm services:up`.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy .env.example to .env and run pnpm services:up.',
    );
  }
  // Audit rows cannot be deleted, so never let tests write to a non-test database.
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point at a database whose name ends in "_test".');
  }
  return url;
}

export async function prepareTestDatabase(): Promise<string> {
  const url = testDatabaseUrl();
  await runMigrations(url);
  return url;
}
