import type { Env } from '@daktari/config';

/**
 * The dev-only routes (POST /api/v1/dev/payments/:id/complete — "mark as
 * paid") confirm a booking WITHOUT money moving. They must never exist where
 * real money does. Two independent signals, either one disables them:
 *
 *  - NODE_ENV=production;
 *  - AZAMPAY_ENV=production — real money hosts, even if NODE_ENV was left at
 *    its `development` default (the misconfiguration that would otherwise
 *    expose the route AND skip the production guard).
 *
 * Checked at registration (app.ts) and again on every request (dev.routes.ts).
 */
export function devRoutesEnabled(env: Pick<Env, 'NODE_ENV' | 'AZAMPAY_ENV'>): boolean {
  return env.NODE_ENV !== 'production' && env.AZAMPAY_ENV !== 'production';
}
