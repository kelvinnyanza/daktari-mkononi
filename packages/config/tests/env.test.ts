import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';

/**
 * The always-required tier and nothing else — this is exactly what
 * `pnpm dev:setup` writes, so if this stops parsing, local first-run breaks.
 */
const minimalEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://daktari:daktari@localhost:5432/daktari_mkononi',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'b'.repeat(64),
  ENCRYPTION_KEY: '0f'.repeat(32),
  OTP_PEPPER: 'pepper-'.padEnd(32, 'x'),
  FILE_SIGNING_SECRET: 'files-'.padEnd(32, 'y'),
};

/** Every provider wired, as production would be. */
const validEnv: Record<string, string> = {
  ...minimalEnv,
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  REDIS_URL: 'redis://localhost:6379',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  AWS_ACCESS_KEY_ID: 'AKIATEST',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  SMS_API_KEY: 'sms-key',
  DAILY_CO_API_KEY: 'daily-key',
};

describe('loadEnv', () => {
  it('parses a fully valid environment', () => {
    const env = loadEnv(validEnv);
    expect(env.NODE_ENV).toBe('test');
    expect(env.DATABASE_URL).toContain('postgresql://');
  });

  it('applies defaults for optional-with-default variables', () => {
    const env = loadEnv(validEnv);
    expect(env.AWS_REGION).toBe('af-south-1');
    expect(env.JWT_ACCESS_EXPIRY).toBe('15m');
    expect(env.JWT_REFRESH_EXPIRY).toBe('30d');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SMS_SENDER_ID).toBe('DAKTARI');
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('rejects a missing required variable and names it in the error', () => {
    const { DATABASE_URL: _omitted, ...rest } = validEnv;
    expect(() => loadEnv(rest)).toThrowError(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' })).toThrowError(
      /DATABASE_URL/,
    );
  });

  it('rejects a non-redis REDIS_URL', () => {
    expect(() => loadEnv({ ...validEnv, REDIS_URL: 'http://localhost:6379' })).toThrowError(
      /REDIS_URL/,
    );
  });

  it('rejects JWT secrets shorter than 64 characters', () => {
    expect(() => loadEnv({ ...validEnv, JWT_ACCESS_SECRET: 'short' })).toThrowError(
      /JWT_ACCESS_SECRET.*64/,
    );
  });

  it('rejects an ENCRYPTION_KEY that is not 64 hex chars', () => {
    expect(() => loadEnv({ ...validEnv, ENCRYPTION_KEY: 'zz'.repeat(32) })).toThrowError(
      /ENCRYPTION_KEY/,
    );
    expect(() => loadEnv({ ...validEnv, ENCRYPTION_KEY: 'abc123' })).toThrowError(
      /ENCRYPTION_KEY/,
    );
  });

  it('reports every invalid variable in one readable error', () => {
    const { JWT_ACCESS_SECRET: _a, OTP_PEPPER: _b, ...rest } = validEnv;
    try {
      loadEnv(rest);
      expect.unreachable('loadEnv should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).toContain('OTP_PEPPER');
      expect(message).toContain('Invalid environment configuration');
    }
  });
});

/**
 * Requirement tiers. Local dev must boot with a database and secrets alone;
 * every external provider is enforced for production by the api-server's
 * production guard, not here.
 */
describe('loadEnv — requirement tiers', () => {
  it('accepts the minimal dev environment: datastore + secrets only', () => {
    const env = loadEnv(minimalEnv);
    expect(env.DATABASE_URL).toContain('postgresql://');
  });

  it.each([
    'NODE_ENV',
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'ENCRYPTION_KEY',
    'OTP_PEPPER',
    'FILE_SIGNING_SECRET',
  ])('has no usable default for %s beyond NODE_ENV', (key) => {
    const { [key]: _omitted, ...rest } = minimalEnv;
    if (key === 'NODE_ENV') {
      // The one exception: NODE_ENV defaults to development.
      expect(loadEnv(rest).NODE_ENV).toBe('development');
      return;
    }
    expect(() => loadEnv(rest)).toThrowError(new RegExp(key));
  });

  it.each([
    'REDIS_URL',
    'ANTHROPIC_API_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'SMS_API_KEY',
    'DAILY_CO_API_KEY',
    'AZAMPAY_CLIENT_ID',
  ])('treats provider credential %s as optional (fakes cover it in dev)', (key) => {
    expect(() => loadEnv(minimalEnv)).not.toThrow();
    expect(loadEnv(minimalEnv)[key as 'REDIS_URL']).toBeUndefined();
  });

  it('defaults the public URLs to localhost for dev', () => {
    const env = loadEnv(minimalEnv);
    expect(env.APP_URL).toBe('http://localhost:3000');
    expect(env.API_URL).toBe('http://localhost:4000');
  });

  it('still validates an optional variable when it IS provided', () => {
    // Optional must not mean unchecked — a typo'd Redis URL should fail loudly.
    expect(() => loadEnv({ ...minimalEnv, REDIS_URL: 'http://localhost:6379' })).toThrowError(
      /REDIS_URL/,
    );
  });

  it('no longer carries the retired PAYMENT_*/WHATSAPP ghosts', () => {
    // These were required but unread since Phase 7's AzamPay provider landed;
    // requiring them blocked local boot for no benefit.
    const env = loadEnv(minimalEnv) as unknown as Record<string, unknown>;
    for (const ghost of [
      'PAYMENT_API_KEY',
      'PAYMENT_API_SECRET',
      'PAYMENT_CALLBACK_URL',
      'WHATSAPP_API_KEY',
    ]) {
      expect(env[ghost]).toBeUndefined();
    }
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => loadEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrowError(/NODE_ENV/);
  });

  it('rejects an OTP_PEPPER shorter than 32 characters', () => {
    expect(() => loadEnv({ ...validEnv, OTP_PEPPER: 'too-short' })).toThrowError(
      /OTP_PEPPER.*32/,
    );
  });
});
