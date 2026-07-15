import { resetEnvCache } from '@daktari/config';

export const TEST_ACCESS_SECRET = 'access-'.padEnd(64, 'a');
export const TEST_REFRESH_SECRET = 'refresh-'.padEnd(64, 'b');

/** Populate process.env with a fully valid environment for auth tests. */
export function applyTestEnv(): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:4000',
    DATABASE_URL: 'postgresql://daktari:daktari@localhost:5432/daktari_test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: TEST_ACCESS_SECRET,
    JWT_REFRESH_SECRET: TEST_REFRESH_SECRET,
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '30d',
    ENCRYPTION_KEY: '0f'.repeat(32),
    ANTHROPIC_API_KEY: 'sk-ant-test',
    PAYMENT_API_KEY: 'pay-key',
    PAYMENT_API_SECRET: 'pay-secret',
    PAYMENT_CALLBACK_URL: 'http://localhost:4000/webhooks/payments',
    AWS_ACCESS_KEY_ID: 'AKIATEST',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    SMS_API_KEY: 'sms-key',
    WHATSAPP_API_KEY: 'wa-key',
    DAILY_CO_API_KEY: 'daily-key',
  });
  resetEnvCache();
}
