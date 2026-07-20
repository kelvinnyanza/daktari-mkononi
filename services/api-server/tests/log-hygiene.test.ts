/**
 * Phase 6 Step 0: WS tickets (and any other query-string credential) must
 * never appear in logs — neither via the req.url serializer nor via
 * key-based redaction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps } from './helpers/fakes.js';
import { deepRedact, maskQueryString } from '../src/lib/logger.js';

let app: FastifyInstance;
const logLines: string[] = [];

beforeAll(async () => {
  applyTestEnv();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({
    deps: makeFakeDeps(),
    redis: null,
    loggerStream: { write: (msg: string) => void logLines.push(msg) },
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

describe('log hygiene', () => {
  it('a request to /ws?ticket=abc logs no "abc" anywhere', async () => {
    logLines.length = 0;
    await app.inject({ method: 'GET', url: '/ws?ticket=abc-super-secret-ticket' });

    const output = logLines.join('\n');
    expect(output.length).toBeGreaterThan(0); // the request WAS logged
    expect(output).not.toContain('abc-super-secret-ticket');
    expect(output).not.toContain('ticket=');
    expect(output).toContain('/ws?[REDACTED]'); // path survives for debugging
  });

  it('signed file-download tokens in the path query are masked too', async () => {
    logLines.length = 0;
    await app.inject({ method: 'GET', url: '/api/v1/files/sometoken?expires=123&sig=topsecret' });
    const output = logLines.join('\n');
    expect(output).not.toContain('topsecret');
  });

  it('maskQueryString strips everything after ? and leaves plain paths alone', () => {
    expect(maskQueryString('/ws?ticket=abc')).toBe('/ws?[REDACTED]');
    expect(maskQueryString('/api/v1/doctors?page=2')).toBe('/api/v1/doctors?[REDACTED]');
    expect(maskQueryString('/health')).toBe('/health');
  });

  it('the key-redaction regex now covers ticket fields in logged objects', () => {
    const redacted = deepRedact({
      ticket: 'abc',
      wsTicket: 'def',
      nested: { ticketValue: 'ghi', safe: 'ok' },
    }) as Record<string, unknown>;
    expect(redacted.ticket).toBe('[REDACTED]');
    expect(redacted.wsTicket).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).ticketValue).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).safe).toBe('ok');
  });
});
