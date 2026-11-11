/**
 * Health tips (UI Phase 3): lifecycle rules, reviewer verification, patient
 * visibility (status + publish window), dev draft preview, ETag/304, and the
 * audit trail — over HTTP, with in-memory fakes.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signAccessToken } from '@daktari/auth';
import type { User } from '@daktari/db';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';

let deps: FakeDeps;
let app: FastifyInstance;
let tokens: { admin: string; verifiedDoctor: string; pendingDoctor: string; patient: string };

async function tokenFor(user: User): Promise<string> {
  const sessionId = randomUUID();
  await deps.sessions.create({
    id: sessionId,
    userId: user.id,
    refreshTokenHash: randomUUID(),
    tokenFamily: randomUUID(),
    userAgent: null,
    ipAddress: null,
    expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  return signAccessToken({ sub: user.id, role: user.role, sessionId });
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let counter = 0;
function tipBody(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    slug: `kunywa-maji-${counter}`,
    category: 'WATER_HYGIENE',
    titleSw: 'Kunywa maji safi',
    titleEn: 'Drink safe water',
    summarySw: 'Chemsha au tibu maji kabla ya kunywa.',
    summaryEn: 'Boil or treat water before you drink it.',
    bodySw: '## Kwa nini\nMaji machafu husababisha kuhara.\n\n- Chemsha maji',
    bodyEn: '## Why\nUnsafe water causes diarrhoea.\n\n- Boil water',
    takeawaysSw: ['Chemsha maji ya kunywa'],
    takeawaysEn: ['Boil drinking water'],
    illustration: 'drinking-water',
    sources: [{ name: 'WHO', url: 'https://www.who.int/news-room/fact-sheets/detail/drinking-water' }],
    ...overrides,
  };
}

async function createTip(overrides: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/health-tips',
    headers: auth(tokens.admin),
    payload: tipBody(overrides),
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string; slug: string }>();
}

const act = (id: string, action: string, token = tokens.admin) =>
  app.inject({ method: 'POST', url: `/api/v1/admin/health-tips/${id}/${action}`, headers: auth(token) });

async function publishedTip(overrides: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const tip = await createTip(overrides);
  expect((await act(tip.id, 'review', tokens.verifiedDoctor)).statusCode).toBe(200);
  expect((await act(tip.id, 'publish')).statusCode).toBe(200);
  return tip;
}

beforeAll(async () => {
  applyTestEnv();
  deps = makeFakeDeps();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ deps, redis: null, logger: false });
  await app.ready();
  const admin = deps.seedUser({ phone: '+255754000101', role: 'PLATFORM_ADMIN' });
  const verified = deps.seedDoctor({ phone: '+255754000102', fullName: 'Dkt. Amina Mushi' }, { verificationStatus: 'APPROVED' });
  const pending = deps.seedDoctor({ phone: '+255754000103' }, { verificationStatus: 'PENDING' });
  const patient = deps.seedPatient({ phone: '+255754000104' });
  tokens = {
    admin: await tokenFor(admin),
    verifiedDoctor: await tokenFor(verified.user),
    pendingDoctor: await tokenFor(pending.user),
    patient: await tokenFor(patient.user),
  };
});

beforeEach(() => {
  deps.state.healthTips.clear();
});

afterAll(async () => {
  await app?.close();
});

describe('lifecycle and permissions', () => {
  it('creates tips as DRAFT; patients and doctors cannot create', async () => {
    const tip = await createTip();
    expect(deps.state.healthTips.get(tip.id)!.status).toBe('DRAFT');
    for (const token of [tokens.patient, tokens.verifiedDoctor]) {
      const denied = await app.inject({ method: 'POST', url: '/api/v1/admin/health-tips', headers: auth(token), payload: tipBody() });
      expect(denied.statusCode).toBe(403);
    }
  });

  it('only a VERIFIED doctor (or a content admin) can review; never a patient', async () => {
    const tip = await createTip();
    expect((await act(tip.id, 'review', tokens.patient)).statusCode).toBe(403);
    const pending = await act(tip.id, 'review', tokens.pendingDoctor);
    expect(pending.statusCode).toBe(403);
    expect(pending.json<{ error: { code: string } }>().error.code).toBe('REVIEWER_NOT_VERIFIED');
    const ok = await act(tip.id, 'review', tokens.verifiedDoctor);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'REVIEWED', reviewedBy: 'Dkt. Amina Mushi' });
  });

  it('cannot publish an unreviewed tip; a doctor cannot publish', async () => {
    const tip = await createTip();
    expect((await act(tip.id, 'publish')).statusCode).toBe(409);
    await act(tip.id, 'review', tokens.verifiedDoctor);
    expect((await act(tip.id, 'publish', tokens.verifiedDoctor)).statusCode).toBe(403);
    expect((await act(tip.id, 'publish')).json()).toMatchObject({ status: 'PUBLISHED' });
  });

  it('editing the content of a published tip sends it back to DRAFT (re-review); priority does not', async () => {
    const tip = await publishedTip();
    const priority = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/health-tips/${tip.id}`,
      headers: auth(tokens.admin),
      payload: { priority: 50 },
    });
    expect(priority.json()).toMatchObject({ status: 'PUBLISHED', priority: 50 });
    const content = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/health-tips/${tip.id}`,
      headers: auth(tokens.admin),
      payload: { titleSw: 'Kunywa maji yaliyochemshwa' },
    });
    expect(content.json()).toMatchObject({ status: 'DRAFT', reviewedBy: null });
  });

  it('archive and restore; restore returns to DRAFT', async () => {
    const tip = await publishedTip();
    expect((await act(tip.id, 'archive')).json()).toMatchObject({ status: 'ARCHIVED' });
    expect((await act(tip.id, 'archive')).statusCode).toBe(409);
    expect((await act(tip.id, 'restore')).json()).toMatchObject({ status: 'DRAFT', reviewedBy: null });
  });

  it('every change is audited with from/to status', async () => {
    deps.state.auditEntries.length = 0;
    const tip = await publishedTip();
    await act(tip.id, 'archive');
    const actions = deps.state.auditEntries
      .filter((entry) => entry.resourceType === 'HealthTip')
      .map((entry) => [entry.action, (entry.metadata as { to?: string }).to]);
    expect(actions).toEqual([
      ['HEALTH_TIP_CREATED', undefined],
      ['HEALTH_TIP_REVIEWED', 'REVIEWED'],
      ['HEALTH_TIP_PUBLISHED', 'PUBLISHED'],
      ['HEALTH_TIP_ARCHIVED', 'ARCHIVED'],
    ]);
  });

  it('duplicate slugs are refused', async () => {
    await createTip({ slug: 'mbu-na-chandarua' });
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/health-tips',
      headers: auth(tokens.admin),
      payload: tipBody({ slug: 'mbu-na-chandarua' }),
    });
    expect(again.statusCode).toBe(409);
  });

  it('a verified doctor can read the review queue but not edit', async () => {
    await createTip();
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/health-tips?status=DRAFT', headers: auth(tokens.verifiedDoctor) });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ total: number }>().total).toBe(1);
    const patientList = await app.inject({ method: 'GET', url: '/api/v1/admin/health-tips', headers: auth(tokens.patient) });
    expect(patientList.statusCode).toBe(403);
  });
});

describe('patient (public) API', () => {
  it('shows only PUBLISHED tips inside their publish window', async () => {
    await createTip({ slug: 'rasimu-tu' });
    const live = await publishedTip({ slug: 'imechapishwa' });
    await publishedTip({ slug: 'baadaye', publishAt: new Date(Date.now() + 86_400_000).toISOString() });
    await publishedTip({ slug: 'imeisha', unpublishAt: new Date(Date.now() - 1000).toISOString(), publishAt: new Date(Date.now() - 86_400_000).toISOString() });

    const list = await app.inject({ method: 'GET', url: '/api/v1/health-tips' });
    expect(list.statusCode).toBe(200);
    const body = list.json<{ items: Array<{ slug: string; title: { sw: string } }>; total: number }>();
    expect(body.items.map((item) => item.slug)).toEqual(['imechapishwa']);
    expect(body.items[0]!.title.sw).toBe('Kunywa maji safi');

    expect((await app.inject({ method: 'GET', url: `/api/v1/health-tips/${live.slug}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/health-tips/rasimu-tu' })).statusCode).toBe(404);
  });

  it('filters by category and orders by priority', async () => {
    await publishedTip({ slug: 'malaria-a', category: 'MALARIA', illustration: 'safe-home', priority: 1 });
    await publishedTip({ slug: 'malaria-b', category: 'MALARIA', illustration: 'safe-home', priority: 9 });
    await publishedTip({ slug: 'maji-a' });
    const list = await app.inject({ method: 'GET', url: '/api/v1/health-tips?category=MALARIA' });
    expect(list.json<{ items: Array<{ slug: string }> }>().items.map((item) => item.slug)).toEqual(['malaria-b', 'malaria-a']);
  });

  it('ETag / If-None-Match: 304 until something changes', async () => {
    const tip = await publishedTip();
    const first = await app.inject({ method: 'GET', url: '/api/v1/health-tips' });
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^W\/"/);
    const again = await app.inject({ method: 'GET', url: '/api/v1/health-tips', headers: { 'if-none-match': etag } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/health-tips/${tip.id}`,
      headers: auth(tokens.admin),
      payload: { priority: 7 },
    });
    const changed = await app.inject({ method: 'GET', url: '/api/v1/health-tips', headers: { 'if-none-match': etag } });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers.etag).not.toBe(etag);
  });

  it('dev builds may preview drafts (badged RASIMU in the app) — never archived ones', async () => {
    await createTip({ slug: 'rasimu-preview' });
    const archived = await createTip({ slug: 'imehifadhiwa' });
    await act(archived.id, 'archive');
    const preview = await app.inject({ method: 'GET', url: '/api/v1/health-tips?preview=drafts' });
    const items = preview.json<{ items: Array<{ slug: string; status: string }> }>().items;
    expect(items).toEqual([expect.objectContaining({ slug: 'rasimu-preview', status: 'DRAFT' })]);
  });

  it('production ignores the draft preview flag', async () => {
    const { HealthTipService } = await import('../src/modules/health-tips/health-tip.service.js');
    const service = new HealthTipService(
      { tips: deps.healthTips, doctors: deps.doctors, auditLogs: deps.auditLogs, storage: deps.storage },
      { allowDraftPreview: false },
    );
    await createTip({ slug: 'siri' });
    const result = await service.listPublic({ page: 1, pageSize: 20, preview: 'drafts' });
    expect(result.items).toHaveLength(0);
  });
});

describe('tip image upload (existing storage)', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

  it('allows jpg/png/webp up to 1 MB only', async () => {
    const tip = await createTip();
    const url = `/api/v1/admin/health-tips/${tip.id}/image/upload-url`;
    const pdf = await app.inject({ method: 'POST', url, headers: auth(tokens.admin), payload: { fileName: 'a.pdf', contentType: 'application/pdf', size: 1000 } });
    expect(pdf.statusCode).toBe(400);
    const big = await app.inject({ method: 'POST', url, headers: auth(tokens.admin), payload: { fileName: 'a.png', contentType: 'image/png', size: 2_000_000 } });
    expect(big.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url, headers: auth(tokens.admin), payload: { fileName: 'a.png', contentType: 'image/png', size: 5000 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ key: string }>().key).toMatch(new RegExp(`^health-tips/${tip.id}/[a-f0-9]{16}\\.png$`));
  });

  it('checks the stored bytes; a published tip then serves a stable, versioned image URL', async () => {
    const tip = await publishedTip();
    const target = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/health-tips/${tip.id}/image/upload-url`,
      headers: auth(tokens.admin),
      payload: { fileName: 'maji.png', contentType: 'image/png', size: PNG.length },
    });
    const { key } = target.json<{ key: string }>();

    // A renamed non-image is rejected and deleted.
    await deps.storage.put(key, Buffer.from('not really a png at all'), 'image/png');
    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/health-tips/${tip.id}/image/complete`,
      headers: auth(tokens.admin),
      payload: { key, fileName: 'maji.png' },
    });
    expect(bad.statusCode).toBe(400);
    expect(await deps.storage.stat(key)).toBeNull();

    await deps.storage.put(key, PNG, 'image/png');
    const done = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/health-tips/${tip.id}/image/complete`,
      headers: auth(tokens.admin),
      payload: { key, fileName: 'maji.png' },
    });
    expect(done.statusCode).toBe(200);
    const detail = (await app.inject({ method: 'GET', url: `/api/v1/health-tips/${tip.slug}` })).json<{ imageUrl: string }>();
    expect(detail.imageUrl).toMatch(new RegExp(`^/api/v1/health-tips/${tip.id}/image\\?v=[a-f0-9]{12}$`));
    const image = await app.inject({ method: 'GET', url: detail.imageUrl });
    expect(image.statusCode).toBe(200);
    expect(image.headers['cache-control']).toContain('max-age');
  });
});
