import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';
import postgres from 'postgres';
import { loadMigrationEnv } from '../config/env';

export const MIGRATIONS_FOLDER = join(__dirname, '..', '..', 'drizzle');

/** The runtime role created by migration 0003. The API's DATABASE_URL must sign in as it. */
export const APP_ROLE = 'lead_app';

/**
 * Applies pending migrations as the database owner, then gives the runtime role the password
 * from the API's connection URL so the API can sign in with least privilege.
 */
export async function runMigrations(ownerUrl: string, appUrl: string): Promise<void> {
  const app = new URL(appUrl);
  if (decodeURIComponent(app.username) !== APP_ROLE) {
    throw new Error(`DATABASE_URL must connect as ${APP_ROLE}, not as the migration owner.`);
  }
  const password = decodeURIComponent(app.password);
  if (password.length < 12) {
    throw new Error(`The ${APP_ROLE} password in DATABASE_URL must be at least 12 characters.`);
  }

  const client = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    // format(%L) quotes the password safely; ALTER ROLE cannot take a bind parameter.
    // Postgres logs this statement if log_statement is 'ddl' or 'all'; keep it off in production.
    const [statement] = await client<{ sql: string }[]>`
      select format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ${APP_ROLE}::text, ${password}::text) as sql`;
    if (!statement) throw new Error('Could not build ALTER ROLE statement');
    await client.unsafe(statement.sql);
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (require.main === module) {
  const logger = new Logger('Migrate');
  const env = loadMigrationEnv(process.env);
  runMigrations(env.MIGRATION_DATABASE_URL, env.DATABASE_URL)
    .then(() => logger.log('Migrations applied'))
    .catch((error: unknown) => {
      logger.error('Migration failed', error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
