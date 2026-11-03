import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '@daktari/config';
import { devRoutesEnabled } from '../src/lib/dev-routes-gate.js';
import { assertProductionReady, findEnvironmentMismatches } from '../src/lib/production-guard.js';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps } from './helpers/fakes.js';

/**
 * The dev "mark as paid" route confirms a booking without money moving: it
 * must be impossible to enable wherever real money exists.
 */
describe('dev "mark as paid" route cannot be enabled in production', () => {
  beforeAll(() => {
    applyTestEnv();
  });
  afterEach(() => {
    applyTestEnv(); // restore NODE_ENV / AZAMPAY_ENV for the next test
    delete process.env.AZAMPAY_ENV;
    resetEnvCache();
  });

  it('gate: off when NODE_ENV=production OR AZAMPAY_ENV=production', () => {
    expect(devRoutesEnabled({ NODE_ENV: 'development', AZAMPAY_ENV: 'sandbox' })).toBe(true);
    expect(devRoutesEnabled({ NODE_ENV: 'test', AZAMPAY_ENV: 'sandbox' })).toBe(true);
    expect(devRoutesEnabled({ NODE_ENV: 'production', AZAMPAY_ENV: 'sandbox' })).toBe(false);
    expect(devRoutesEnabled({ NODE_ENV: 'development', AZAMPAY_ENV: 'production' })).toBe(false);
    expect(devRoutesEnabled({ NODE_ENV: 'production', AZAMPAY_ENV: 'production' })).toBe(false);
  });

  async function postMarkPaid(): Promise<number> {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ deps: makeFakeDeps(), redis: null, logger: false });
    await app.ready();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/dev/payments/ckabc123def456ghi789jkl0/complete',
    });
    await app.close();
    return response.statusCode;
  }

  it('in dev the route exists (401 without a session, not 404)', async () => {
    expect(await postMarkPaid()).toBe(401);
  });

  it('NODE_ENV=production → the route is not registered (404)', async () => {
    process.env.NODE_ENV = 'production';
    resetEnvCache();
    expect(await postMarkPaid()).toBe(404);
  });

  it('AZAMPAY_ENV=production with NODE_ENV left at development → still 404', async () => {
    process.env.NODE_ENV = 'development';
    process.env.AZAMPAY_ENV = 'production';
    resetEnvCache();
    expect(await postMarkPaid()).toBe(404);
  });

  it('request-time re-check: registered in dev, then the env says production → 404', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ deps: makeFakeDeps(), redis: null, logger: false });
    await app.ready();
    process.env.AZAMPAY_ENV = 'production';
    resetEnvCache();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/dev/payments/ckabc123def456ghi789jkl0/complete',
    });
    await app.close();
    expect(response.statusCode).toBe(404);
  });

  it('startup guard refuses AZAMPAY_ENV=production unless NODE_ENV=production', () => {
    const base = {
      DATABASE_URL: 'postgresql://daktari:daktari@localhost:5432/daktari_mkononi',
      JWT_ACCESS_SECRET: 'a'.repeat(64),
      JWT_REFRESH_SECRET: 'b'.repeat(64),
      ENCRYPTION_KEY: '0f'.repeat(32),
      OTP_PEPPER: 'pepper-'.padEnd(32, 'x'),
      FILE_SIGNING_SECRET: 'files-'.padEnd(32, 'y'),
    };
    const mismatched = loadEnv({ ...base, NODE_ENV: 'development', AZAMPAY_ENV: 'production' });
    expect(findEnvironmentMismatches(mismatched)).toEqual([
      'NODE_ENV (AZAMPAY_ENV=production requires NODE_ENV=production)',
    ]);
    expect(() => assertProductionReady(mismatched)).toThrowError(/AZAMPAY_ENV=production requires NODE_ENV=production/);
    // A plain dev env (sandbox) stays bootable.
    expect(() => assertProductionReady(loadEnv({ ...base, NODE_ENV: 'development' }))).not.toThrow();
  });
});
