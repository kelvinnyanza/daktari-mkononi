import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps } from './helpers/fakes.js';

/**
 * A client that sends the wrong Content-Type, an empty JSON body or broken
 * JSON gets an error that says WHAT is wrong — not a generic BAD_REQUEST.
 */
describe('request body / Content-Type errors are specific (13b)', () => {
  beforeAll(() => {
    applyTestEnv();
  });

  async function send(headers: Record<string, string>, payload: string | undefined) {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ deps: makeFakeDeps(), redis: null, logger: false });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers,
      ...(payload !== undefined ? { payload } : {}),
    });
    await app.close();
    return { status: response.statusCode, error: response.json().error as { code: string; message: { sw: string; en: string } } };
  }

  it('wrong Content-Type → 415 UNSUPPORTED_MEDIA_TYPE, says to send application/json', async () => {
    const result = await send({ 'content-type': 'text/plain' }, 'phone=1&password=2');
    expect(result.status).toBe(415);
    expect(result.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(result.error.message.en).toContain('application/json');
    expect(result.error.message.sw).toContain('application/json');
  });

  it('Content-Type application/json with an EMPTY body → 400 EMPTY_JSON_BODY (not a validation error)', async () => {
    const result = await send({ 'content-type': 'application/json' }, '');
    expect(result.status).toBe(400);
    expect(result.error.code).toBe('EMPTY_JSON_BODY');
    expect(result.error.message.en).toMatch(/empty/i);
  });

  it('malformed JSON → 400 MALFORMED_JSON', async () => {
    const result = await send({ 'content-type': 'application/json' }, '{"phone":');
    expect(result.status).toBe(400);
    expect(result.error.code).toBe('MALFORMED_JSON');
  });

  it('the AzamPay webhook still accepts a text/plain callback (never 415 a real payment)', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ deps: makeFakeDeps(), redis: null, logger: false });
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/azampay',
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify({ utilityref: 'ghost:1', transactionstatus: 'success', operator: 'Tigo' }),
    });
    await app.close();
    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe('unknown-reference');
  });

  it('a well-formed body still reaches validation as before', async () => {
    const result = await send({ 'content-type': 'application/json' }, '{}');
    expect(result.status).toBe(400);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});
