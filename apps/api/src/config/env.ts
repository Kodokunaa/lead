import { z } from 'zod';

const postgresUrl = z.url().startsWith('postgres');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Normalized to a bare origin so a trailing slash cannot silently break CORS.
  WEB_ORIGIN: z.url().transform((value) => new URL(value).origin),
  /** Least-privilege runtime role (lead_app). Migrations use MIGRATION_DATABASE_URL instead. */
  DATABASE_URL: postgresUrl,
  /**
   * Number of reverse proxies in front of the API (0 = none). Needed so rate limits and audit
   * logs see the client's IP, not the proxy's. Never trust more hops than really exist, or
   * clients can spoof X-Forwarded-For.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** 32 random bytes, base64url. Encrypts stored MFA secrets; losing it disables everyone's MFA. */
  MFA_ENCRYPTION_KEY: z.string().refine((value) => Buffer.from(value, 'base64url').length === 32, {
    message: 'must be 32 bytes encoded as base64url',
  }),
  /** Where the development mailer writes emails (one .eml file each) instead of sending them. */
  MAIL_OUTBOX_DIR: z.string().min(1).default('storage/outbox'),
  /** Signs access tokens. 32+ random characters; rotating it signs everyone out within minutes. */
  JWT_SECRET: z.string().min(32),
});

const migrationEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
  MIGRATION_DATABASE_URL: postgresUrl,
});

export type Env = z.infer<typeof envSchema>;
export type MigrationEnv = z.infer<typeof migrationEnvSchema>;

function parseOrThrow<T>(schema: z.ZodType<T>, source: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return result.data;
}

/** Validates process environment at startup and fails fast with every missing or bad variable. */
export function loadEnv(source: NodeJS.ProcessEnv): Env {
  return parseOrThrow(envSchema, source);
}

export function loadMigrationEnv(source: NodeJS.ProcessEnv): MigrationEnv {
  return parseOrThrow(migrationEnvSchema, source);
}
