import { Logger } from '@nestjs/common';
import type { Role } from '@lead/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import { hashPassword } from '../auth/password';
import * as schema from './schema';

/**
 * Generated demo accounts for local development. No real CCC records are used until the
 * college gives written approval (RA 10173). Existing accounts are left untouched.
 */
export const SEED_ACCOUNTS: readonly { email: string; displayName: string; role: Role }[] = [
  { email: 'admin@lead.test', displayName: 'Demo Administrator', role: 'admin' },
  { email: 'teacher01@lead.test', displayName: 'Teacher 01', role: 'teacher' },
  { email: 'learner01@lead.test', displayName: 'Learner 01', role: 'student' },
  { email: 'learner02@lead.test', displayName: 'Learner 02', role: 'student' },
];

const seedEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url().startsWith('postgres'),
  SEED_PASSWORD: z.string().min(12, 'SEED_PASSWORD must be at least 12 characters'),
});

export async function seed(databaseUrl: string, password: string): Promise<number> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const db = drizzle(client, { schema });
    const passwordHash = await hashPassword(password);
    const inserted = await db
      .insert(schema.users)
      .values(
        SEED_ACCOUNTS.map((account) => ({
          ...account,
          status: 'active' as const,
          passwordHash,
          emailVerifiedAt: new Date(),
        })),
      )
      .onConflictDoNothing({ target: schema.users.email })
      .returning({ id: schema.users.id });
    return inserted.length;
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (require.main === module) {
  const logger = new Logger('Seed');
  const env = seedEnvSchema.parse(process.env);
  if (env.NODE_ENV === 'production') {
    logger.error('Refusing to seed demo accounts in production.');
    process.exitCode = 1;
  } else {
    seed(env.DATABASE_URL, env.SEED_PASSWORD)
      .then((count) => logger.log(`Created ${count} demo account(s); existing ones unchanged.`))
      .catch((error: unknown) => {
        logger.error('Seed failed', error instanceof Error ? error.stack : String(error));
        process.exitCode = 1;
      });
  }
}
