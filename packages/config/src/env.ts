import { z } from 'zod';

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// or postgresql:// connection string');

const redisUrl = z
  .string()
  .regex(/^rediss?:\/\/.+/, 'must be a redis:// or rediss:// connection string');

/**
 * Full environment contract for Daktari Mkononi.
 *
 * Secrets are only ever read through this schema — no `process.env` access
 * elsewhere in the codebase (see CLAUDE.md).
 */
export const envSchema = z.object({
  // Core
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url(),
  API_URL: z.string().url(),

  // Datastores
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,

  // Auth
  JWT_ACCESS_SECRET: z.string().min(64, 'must be at least 64 characters'),
  JWT_REFRESH_SECRET: z.string().min(64, 'must be at least 64 characters'),
  JWT_ACCESS_EXPIRY: z.string().min(1).default('15m'),
  JWT_REFRESH_EXPIRY: z.string().min(1).default('30d'),

  // PHI encryption at rest (AES-256-GCM): 32-byte key as 64 hex chars
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be exactly 64 hex characters (32 bytes)'),

  // AI
  ANTHROPIC_API_KEY: z.string().min(1),

  // Payments — Tanzania mobile money aggregator (TZS only)
  PAYMENT_API_KEY: z.string().min(1),
  PAYMENT_API_SECRET: z.string().min(1),
  PAYMENT_CALLBACK_URL: z.string().url(),

  // AWS (document storage)
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().min(1).default('af-south-1'),

  // Messaging
  SMS_API_KEY: z.string().min(1),
  SMS_SENDER_ID: z.string().min(1).max(11).default('DAKTARI'),
  WHATSAPP_API_KEY: z.string().min(1),

  // Video consultations
  DAILY_CO_API_KEY: z.string().min(1),

  // Observability
  SENTRY_DSN: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate an environment source (defaults to `process.env`) and return the
 * typed result. Throws with a readable, per-variable error report on failure.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `  - ${key}: ${issue.message}`;
    });
    throw new Error(
      `❌ Invalid environment configuration:\n${lines.join('\n')}\n` +
        'Fix the variables above (see .env.example) and restart.',
    );
  }
  return result.data;
}

let cached: Env | undefined;

/**
 * Typed, validated environment. Validation runs on first property access
 * (fail-fast at startup for any consumer), not at import time, so tooling
 * and tests can import this module without a fully populated environment.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    cached ??= loadEnv();
    return cached[prop as keyof Env];
  },
  has(_target, prop) {
    cached ??= loadEnv();
    return prop in cached;
  },
  ownKeys() {
    cached ??= loadEnv();
    return Reflect.ownKeys(cached);
  },
  getOwnPropertyDescriptor(_target, prop) {
    cached ??= loadEnv();
    return Object.getOwnPropertyDescriptor(cached, prop);
  },
});

/** Test-only helper: clear the memoized environment. */
export function resetEnvCache(): void {
  cached = undefined;
}
