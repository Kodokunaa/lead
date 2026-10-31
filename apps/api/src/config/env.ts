import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Normalized to a bare origin so a trailing slash cannot silently break CORS.
  WEB_ORIGIN: z.url().transform((value) => new URL(value).origin),
  DATABASE_URL: z.url().startsWith('postgres'),
});

export type Env = z.infer<typeof envSchema>;

/** Validates process environment at startup and fails fast with every missing or bad variable. */
export function loadEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return result.data;
}
