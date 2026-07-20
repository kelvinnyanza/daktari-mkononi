import { afterAll, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '@daktari/config';
import {
  ProductionReadinessError,
  assertProductionReady,
  findProductionAdapterOffenders,
} from '../src/lib/production-guard.js';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps } from './helpers/fakes.js';

/** A fully-configured production env — every adapter real. */
const prodEnv: Record<string, string> = {
  NODE_ENV: 'production',
  APP_URL: 'https://app.daktari.co.tz',
  API_URL: 'https://api.daktari.co.tz',
  DATABASE_URL: 'postgresql://daktari:daktari@db:5432/daktari',
  REDIS_URL: 'redis://redis:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'b'.repeat(64),
  ENCRYPTION_KEY: '0f'.repeat(32),
  OTP_PEPPER: 'pepper-'.padEnd(32, 'x'),
  FILE_SIGNING_SECRET: 'files-'.padEnd(32, 'y'),
  ANTHROPIC_API_KEY: 'sk-ant-prod',
  PAYMENT_API_KEY: 'pay-key',
  PAYMENT_API_SECRET: 'pay-secret',
  PAYMENT_CALLBACK_URL: 'https://api.daktari.co.tz/webhooks/payments',
  AWS_ACCESS_KEY_ID: 'AKIAPROD',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  SMS_API_KEY: 'sms-key',
  WHATSAPP_API_KEY: 'wa-key',
  DAILY_CO_API_KEY: 'daily-key',
  AZAMPAY_APP_NAME: 'daktari',
  AZAMPAY_CLIENT_ID: 'azam-id',
  AZAMPAY_CLIENT_SECRET: 'azam-secret',
  AZAMPAY_WEBHOOK_SECRET: 'whsec-production-secret-value',
};

describe('production adapter guard', () => {
  it('a fully-configured production env has no offenders and boots', () => {
    const env = loadEnv(prodEnv);
    expect(findProductionAdapterOffenders(env)).toEqual([]);
    expect(() => assertProductionReady(env)).not.toThrow();
  });

  it('names ALL offenders at once, not first-failure-only', () => {
    // SMS_API_KEY / DAILY_CO_API_KEY are required (min 1) in the env schema, so
    // loadEnv would reject empties before the guard runs. The guard is a
    // second enforcement layer, so mutate the parsed env directly to simulate
    // every provider adapter being fake/unset at the same time.
    const env = {
      ...loadEnv(prodEnv),
      AZAMPAY_APP_NAME: undefined,
      AZAMPAY_CLIENT_ID: undefined,
      AZAMPAY_CLIENT_SECRET: undefined,
      AZAMPAY_WEBHOOK_SECRET: undefined,
      SMS_API_KEY: '',
      DAILY_CO_API_KEY: '',
    };
    const offenders = findProductionAdapterOffenders(env);
    expect(offenders).toEqual(
      expect.arrayContaining([
        'AZAMPAY_CLIENT_ID',
        'AZAMPAY_CLIENT_SECRET',
        'AZAMPAY_APP_NAME',
        'AZAMPAY_WEBHOOK_SECRET',
        'SMS_API_KEY',
        'DAILY_CO_API_KEY',
      ]),
    );
    expect(offenders.length).toBe(6);

    const error = (() => {
      try {
        assertProductionReady(env);
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(ProductionReadinessError);
    // The message lists every offender in one pass.
    for (const name of offenders) {
      expect((error as ProductionReadinessError).message).toContain(name);
    }
  });

  it('reports a single offender when only one is missing', () => {
    const env = { ...loadEnv(prodEnv), DAILY_CO_API_KEY: '' };
    expect(findProductionAdapterOffenders(env)).toEqual(['DAILY_CO_API_KEY']);
  });

  it('is a no-op outside production — dev keeps its fake/console fallbacks', () => {
    const devEnv = {
      ...loadEnv({ ...prodEnv, NODE_ENV: 'development' }),
      AZAMPAY_APP_NAME: undefined,
      AZAMPAY_CLIENT_ID: undefined,
      AZAMPAY_CLIENT_SECRET: undefined,
      SMS_API_KEY: '',
      DAILY_CO_API_KEY: '',
    };
    expect(findProductionAdapterOffenders(devEnv)).toEqual([]);
    expect(() => assertProductionReady(devEnv)).not.toThrow();
  });
});

/**
 * The dev-only payment flip (`/api/v1/dev/payments/:id/complete`) would let any
 * authenticated caller mark a booking paid. It must not exist in production —
 * asserted against a really-built app, not by reading the registration `if`.
 */
describe('dev-only routes are absent in production', () => {
  afterAll(() => {
    applyTestEnv(); // restore the shared env cache for the rest of the run
  });

  async function buildWith(nodeEnv: string) {
    applyTestEnv();
    process.env['NODE_ENV'] = nodeEnv;
    resetEnvCache();
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ deps: makeFakeDeps(), redis: null, logger: false });
    await app.ready();
    return app;
  }

  it('registers the dev payment flip outside production', async () => {
    const app = await buildWith('development');
    try {
      // 401 (not 404): the route exists, it just demands authentication.
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/dev/payments/ckzz0000000000000000000a/complete',
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('does not register the dev payment flip in production', async () => {
    const app = await buildWith('production');
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/dev/payments/ckzz0000000000000000000a/complete',
      });
      expect(response.statusCode).toBe(404);
      // Nothing under the /dev prefix survives the guard.
      expect(app.printRoutes()).not.toContain('dev');
    } finally {
      await app.close();
    }
  });
});
