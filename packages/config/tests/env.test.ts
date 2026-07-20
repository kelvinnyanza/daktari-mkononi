import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';

const validEnv: Record<string, string> = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  DATABASE_URL: 'postgresql://daktari:daktari@localhost:5432/daktari_mkononi',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'b'.repeat(64),
  ENCRYPTION_KEY: '0f'.repeat(32),
  OTP_PEPPER: 'pepper-'.padEnd(32, 'x'),
  FILE_SIGNING_SECRET: 'files-'.padEnd(32, 'y'),
  ANTHROPIC_API_KEY: 'sk-ant-test',
  PAYMENT_API_KEY: 'pay-key',
  PAYMENT_API_SECRET: 'pay-secret',
  PAYMENT_CALLBACK_URL: 'http://localhost:4000/webhooks/payments',
  AWS_ACCESS_KEY_ID: 'AKIATEST',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  SMS_API_KEY: 'sms-key',
  WHATSAPP_API_KEY: 'wa-key',
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
    const { ANTHROPIC_API_KEY: _a, DAILY_CO_API_KEY: _b, ...rest } = validEnv;
    try {
      loadEnv(rest);
      expect.unreachable('loadEnv should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('ANTHROPIC_API_KEY');
      expect(message).toContain('DAILY_CO_API_KEY');
      expect(message).toContain('Invalid environment configuration');
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
