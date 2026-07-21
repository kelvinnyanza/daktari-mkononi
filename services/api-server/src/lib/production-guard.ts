import type { Env } from '@daktari/config';

/**
 * Production-readiness guard. In production the server MUST NOT boot on top of
 * fake/console adapters or unset provider credentials — a fake payment or
 * console SMS in production silently drops real money paths and real messages.
 *
 * Returns the list of ALL offenders (never first-failure-only) so an operator
 * fixes everything in one pass. Empty list ⇒ safe to boot.
 */
export function findProductionAdapterOffenders(env: Env): string[] {
  if (env.NODE_ENV !== 'production') return [];

  const offenders: string[] = [];
  const missing = (value: string | undefined): boolean => value === undefined || value === '';

  // The env schema deliberately makes these optional so local dev can boot on
  // fakes; production correctness therefore rests entirely on this guard.

  // Datastore — REDIS_URL unset means an in-memory rate limiter, which counts
  // per process and so under-enforces across instances.
  if (missing(env.REDIS_URL)) offenders.push('REDIS_URL');

  // Public URLs — the schema defaults these to localhost, which would silently
  // break CORS, the refresh-cookie origin, and every link in an SMS.
  if (env.APP_URL.includes('localhost')) offenders.push('APP_URL');
  if (env.API_URL.includes('localhost')) offenders.push('API_URL');

  // AI screening — unset means every screening endpoint answers 503.
  if (missing(env.ANTHROPIC_API_KEY)) offenders.push('ANTHROPIC_API_KEY');

  // Document storage — unset means PHI documents land on the pod's local disk
  // and vanish with it, instead of S3.
  if (missing(env.AWS_ACCESS_KEY_ID)) offenders.push('AWS_ACCESS_KEY_ID');
  if (missing(env.AWS_SECRET_ACCESS_KEY)) offenders.push('AWS_SECRET_ACCESS_KEY');

  // Payments — AzamPay collection/refund. Missing creds ⇒ FakePayments in prod.
  if (missing(env.AZAMPAY_CLIENT_ID)) offenders.push('AZAMPAY_CLIENT_ID');
  if (missing(env.AZAMPAY_CLIENT_SECRET)) offenders.push('AZAMPAY_CLIENT_SECRET');
  if (missing(env.AZAMPAY_APP_NAME)) offenders.push('AZAMPAY_APP_NAME');
  // Webhook signature secret — without it every provider webhook 401s.
  if (missing(env.AZAMPAY_WEBHOOK_SECRET)) offenders.push('AZAMPAY_WEBHOOK_SECRET');

  // SMS gateway — OTPs, refund notices, doctor-cancel alerts.
  if (missing(env.SMS_API_KEY)) offenders.push('SMS_API_KEY');

  // Video — Daily.co rooms/tokens. Missing key ⇒ FakeVideo (no real calls).
  if (missing(env.DAILY_CO_API_KEY)) offenders.push('DAILY_CO_API_KEY');

  return offenders;
}

export class ProductionReadinessError extends Error {
  constructor(readonly offenders: string[]) {
    super(
      `Refusing to start in production: the following provider adapters are ` +
        `unconfigured (would fall back to fake/console adapters or reject ` +
        `requests): ${offenders.join(', ')}. Set every listed variable and ` +
        `restart.`,
    );
    this.name = 'ProductionReadinessError';
  }
}

/** Throws ProductionReadinessError naming every offender when unsafe to boot. */
export function assertProductionReady(env: Env): void {
  const offenders = findProductionAdapterOffenders(env);
  if (offenders.length > 0) throw new ProductionReadinessError(offenders);
}
