import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';
import postgres from 'postgres';
import { loadEnv } from '../config/env';

export const MIGRATIONS_FOLDER = join(__dirname, '..', '..', 'drizzle');

/** Applies pending migrations to the given database. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (require.main === module) {
  const logger = new Logger('Migrate');
  runMigrations(loadEnv(process.env).DATABASE_URL)
    .then(() => logger.log('Migrations applied'))
    .catch((error: unknown) => {
      logger.error('Migration failed', error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
