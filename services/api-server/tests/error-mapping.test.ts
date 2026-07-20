import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signAccessToken } from '@daktari/auth';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';

let app: FastifyInstance;
let deps: FakeDeps;

beforeAll(async () => {
  applyTestEnv();
  const { buildApp } = await import('../src/app.js');
  deps = makeFakeDeps();
  app = await buildApp({ deps, redis: null, logger: false });
  // Test-only route for the 500 catch-all.
  app.get('/boom', () => {
    throw new Error('kaboom');
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('error envelope mapping', () => {
  it('maps Zod validation failures to 400 VALIDATION_ERROR with field details', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { phone: '+254712345678', password: 'short' }, // Kenyan phone, weak password
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as {
      error: { code: string; message: { sw: string; en: string }; requestId: string; details: Array<{ field: string }> };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message.sw).toBeTruthy();
    expect(body.error.message.en).toBeTruthy();
    expect(body.error.requestId).toBeTruthy();
    const fields = body.error.details.map((detail) => detail.field);
    expect(fields).toContain('phone');
    expect(fields).toContain('password');
  });

  it('maps a missing bearer token to 401 TOKEN_MISSING', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('TOKEN_MISSING');
  });

  it('maps an expired access token to 401 TOKEN_EXPIRED', async () => {
    const token = await signAccessToken(
      { sub: 'user-1', role: 'PATIENT', sessionId: 'sess-1' },
      { expiresIn: Math.floor(Date.now() / 1000) - 60 },
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('TOKEN_EXPIRED');
  });

  it('maps a tampered access token to 401 TOKEN_INVALID', async () => {
    const token = await signAccessToken({ sub: 'user-1', role: 'PATIENT', sessionId: 'sess-1' });
    const tampered = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('TOKEN_INVALID');
  });

  it('maps a valid token whose session is revoked to 401 SESSION_REVOKED', async () => {
    const user = deps.seedUser({ phone: '+255754000010' });
    await deps.sessions.create({
      id: 'sess-revoked',
      userId: user.id,
      refreshTokenHash: 'x',
      tokenFamily: 'fam-revoked',
      userAgent: null,
      ipAddress: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await deps.sessions.revoke('sess-revoked', 'LOGOUT');
    const token = await signAccessToken({ sub: user.id, role: 'PATIENT', sessionId: 'sess-revoked' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('SESSION_REVOKED');
  });

  it('serves an authenticated /me and audit-logs the PHI read', async () => {
    const user = deps.seedUser({ phone: '+255754000011', fullName: 'Neema Shirima' });
    await deps.sessions.create({
      id: 'sess-live',
      userId: user.id,
      refreshTokenHash: 'y',
      tokenFamily: 'fam-live',
      userAgent: null,
      ipAddress: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const token = await signAccessToken({ sub: user.id, role: 'PATIENT', sessionId: 'sess-live' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.fullName).toBe('Neema Shirima');

    // onResponse audit hook is fire-and-forget; give it a tick.
    await new Promise((resolve) => setImmediate(resolve));
    const entry = deps.state.auditEntries.find((item) => item.actorUserId === user.id);
    expect(entry).toBeDefined();
    expect(entry!.resourceType).toBe('PHI_READ');
  });

  it('maps unknown errors to 500 INTERNAL_ERROR with a requestId', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    const body = response.json() as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.requestId).toBeTruthy();
  });

  it('propagates an inbound x-request-id to the response and error envelope', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { 'x-request-id': 'trace-abc-123' },
    });
    expect(response.headers['x-request-id']).toBe('trace-abc-123');
    expect(response.json().error.requestId).toBe('trace-abc-123');
  });

  it('maps unknown routes to a 404 bilingual envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('health endpoints respond and readiness reports skipped checks when unwired', async () => {
    const live = await app.inject({ method: 'GET', url: '/health' });
    expect(live.statusCode).toBe(200);
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks).toEqual({ database: 'skipped', redis: 'skipped' });
  });
});
