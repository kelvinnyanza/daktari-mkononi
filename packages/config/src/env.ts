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
 *
 * **Requirement tiers.** Only the variables that have no safe default and no
 * fake — the datastore and the secrets that protect PHI — are required
 * everywhere. Every external provider is optional here and enforced for
 * production by `assertProductionReady` in the api-server, which names all
 * offenders at once. That split is what lets a developer boot with nothing but
 * a Postgres URL while production still refuses to start on console adapters.
 *
 * The one deliberate exception is the AI key: an unset key for the selected
 * AI_PROVIDER does NOT fall back to a fake, because a fake medical triage that
 * answers plausibly is more dangerous than one that is plainly unavailable.
 * Screening returns 503 AI_NOT_CONFIGURED instead. The dev fake exists only
 * when chosen explicitly (AI_PROVIDER=fake), is marked [JARIBIO] on every
 * reply, and is refused in production.
 */
export const envSchema = z.object({
  // ── Always required ───────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: postgresUrl,

  // ── Dev-defaulted, production-enforced ────────────────────────────────────
  // Localhost defaults are correct for dev and wrong-but-harmless in
  // production, where the guard requires them to be set explicitly.
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),

  // Unset in dev ⇒ in-memory rate limiting and /health/ready reports redis
  // 'skipped'. Required in production, where a single-process limiter would
  // silently under-count across instances.
  REDIS_URL: redisUrl.optional(),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(64, 'must be at least 64 characters'),
  JWT_REFRESH_SECRET: z.string().min(64, 'must be at least 64 characters'),
  JWT_ACCESS_EXPIRY: z.string().min(1).default('15m'),
  JWT_REFRESH_EXPIRY: z.string().min(1).default('30d'),

  // PHI encryption at rest (AES-256-GCM): 32-byte key as 64 hex chars
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be exactly 64 hex characters (32 bytes)'),

  // Server-side secret for HMAC-SHA-256 OTP hashing (see @daktari/encryption)
  OTP_PEPPER: z.string().min(32, 'must be at least 32 characters'),

  // HMAC secret for signed file-download tokens (@daktari/storage)
  FILE_SIGNING_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // Local dev file storage root (LocalDiskStorage); S3 takes over in production
  STORAGE_ROOT: z.string().min(1).default('.storage'),

  // ── AI (screening/triage) ─────────────────────────────────────────────────
  // Which backend answers screening. `fake` is a dev-only canned [JARIBIO]
  // responder — the production guard refuses to boot with it.
  AI_PROVIDER: z.enum(['anthropic', 'openai', 'fake']).default('anthropic'),
  // The SELECTED provider's key unset ⇒ screening answers 503
  // AI_NOT_CONFIGURED (never a silent fallback to the other provider). Both
  // keys may be present at once — switching is then one variable.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  // Unset ⇒ the selected provider's own default (claude-sonnet-4-6 /
  // gpt-6.1-sol). Leave it blank so AI_PROVIDER alone switches backends; a
  // model id belonging to the other provider is rejected below.
  AI_MODEL: z.string().min(1).optional(),

  // ── Payments — Tanzania mobile money aggregator (TZS only) ────────────────
  // NOTE: PAYMENT_API_KEY / PAYMENT_API_SECRET / PAYMENT_CALLBACK_URL were
  // removed — they predate the AzamPay provider (Phase 7) and nothing has read
  // them since. Requiring them only blocked local boot.
  // Unset ⇒ FakePayments in dev; the production guard requires them.
  AZAMPAY_APP_NAME: z.string().min(1).optional(),
  AZAMPAY_CLIENT_ID: z.string().min(1).optional(),
  AZAMPAY_CLIENT_SECRET: z.string().min(1).optional(),
  AZAMPAY_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  AZAMPAY_AUTH_BASE_URL: z.string().url().optional(),
  AZAMPAY_CHECKOUT_BASE_URL: z.string().url().optional(),
  AZAMPAY_WEBHOOK_SECRET: z.string().min(16).optional(),

  // ── AWS (document storage) ────────────────────────────────────────────────
  // Unset ⇒ LocalDiskStorage under STORAGE_ROOT; S3 takes over in production.
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).default('af-south-1'),

  // ── Messaging ─────────────────────────────────────────────────────────────
  // Unset ⇒ ConsoleSms (OTP codes print to the API console — how you sign in
  // locally). WHATSAPP_API_KEY was removed: nothing reads it yet.
  SMS_API_KEY: z.string().min(1).optional(),
  SMS_USERNAME: z.string().min(1).default('sandbox'),
  SMS_SENDER_ID: z.string().min(1).max(11).default('DAKTARI'),

  // ── Video consultations ───────────────────────────────────────────────────
  // Unset ⇒ FakeVideo (rooms/tokens are stubs, no real call is placed).
  DAILY_CO_API_KEY: z.string().min(1).optional(),

  // ── Observability ─────────────────────────────────────────────────────────
  // Reserved: validated so a typo is caught, not yet wired to a reporter.
  SENTRY_DSN: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
}).superRefine((value, ctx) => {
  // Every Anthropic model id starts with "claude-"; nothing else does. Catches
  // the one-variable switch that left AI_MODEL pointing at the old provider —
  // which would otherwise surface only as a 404 on the first patient message.
  const model = value.AI_MODEL;
  if (model === undefined || value.AI_PROVIDER === 'fake') return;
  const claudeModel = model.startsWith('claude-');
  if (value.AI_PROVIDER === 'openai' && claudeModel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AI_MODEL'],
      message: `"${model}" is an Anthropic model but AI_PROVIDER=openai — blank AI_MODEL to use the OpenAI default`,
    });
  }
  if (value.AI_PROVIDER === 'anthropic' && !claudeModel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AI_MODEL'],
      message: `"${model}" is not an Anthropic model but AI_PROVIDER=anthropic — blank AI_MODEL to use the Anthropic default`,
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate an environment source (defaults to `process.env`) and return the
 * typed result. Throws with a readable, per-variable error report on failure.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // A blank value means "not configured", not "configured as empty string".
  // `.env` files spell an unset provider as `SMS_API_KEY=` (a present, empty
  // value), and dotenv faithfully reports `''` — which `.optional()` rejects,
  // since optional only admits `undefined`. Without this, the generated dev
  // .env would fail validation on every commented-out provider. Required
  // variables are unaffected: a blank one still fails, as "Required".
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    normalized[key] = value === '' ? undefined : value;
  }

  const result = envSchema.safeParse(normalized);
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
