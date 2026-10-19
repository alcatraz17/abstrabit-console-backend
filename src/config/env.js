import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake');
const secret = (minLength) => z.string().min(minLength, `must be at least ${minLength} characters`);
const optionalString = z
  .string()
  .optional()
  .transform((value) => value || undefined);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres connection string'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  DATABASE_CA_CERT: optionalString,
  SESSION_SECRET: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(secret(32)).min(1)),
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (value) => Buffer.from(value, 'base64').length === 32,
      'must be 32 bytes encoded as base64',
    ),
  DISCORD_APPLICATION_ID: snowflake,
  DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'must be a 64-character hex key'),
  DISCORD_BOT_TOKEN: secret(20),
  CRON_SECRET: secret(32),
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: z.string().min(1).default('llama-3.1-8b-instant'),
});

export function loadEnv(source = process.env) {
  const normalized = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value === '' ? undefined : value]),
  );
  const parsed = envSchema.safeParse(normalized);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `  ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  return Object.freeze(parsed.data);
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
