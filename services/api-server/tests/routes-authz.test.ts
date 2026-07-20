/**
 * Route-level ownership/permission denials for cross-role access paths.
 * Tokens are minted directly (no argon2 logins) to keep this fast.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signAccessToken } from '@daktari/auth';
import type { User } from '@daktari/db';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';

let deps: FakeDeps;
let app: FastifyInstance;

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

let patientToken: string;
let doctorToken: string;
let adminToken: string;
let patientId: string;

beforeAll(async () => {
  applyTestEnv();
  deps = makeFakeDeps();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ deps, redis: null, logger: false });
  await app.ready();

  const patient = deps.seedPatient({ phone: '+255754000001' });
  const doctor = deps.seedDoctor({ phone: '+255754000002' }, { verificationStatus: 'APPROVED' });
  const admin = deps.seedUser({ phone: '+255754000003', role: 'PLATFORM_ADMIN' });
  patientId = patient.patient.id;
  [patientToken, doctorToken, adminToken] = await Promise.all([
    tokenFor(patient.user),
    tokenFor(doctor.user),
    tokenFor(admin),
  ]);
});

afterAll(async () => {
  await app?.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('unauthenticated requests', () => {
  it.each([
    ['GET', '/api/v1/patients/me/profile'],
    ['GET', '/api/v1/doctors/me/verification'],
    ['POST', '/api/v1/appointments'],
    ['GET', '/api/v1/doctors/admin/verification-queue'],
  ])('%s %s → 401 TOKEN_MISSING', async (method, url) => {
    const response = await app.inject({ method: method as 'GET', url });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('TOKEN_MISSING');
  });
});

describe('patient cross-role denials', () => {
  it('patient cannot use admin patient reads (patient:read:any)', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/patients', headers: auth(patientToken) });
    expect(list.statusCode).toBe(403);
    expect(list.json().error.code).toBe('PERMISSION_DENIED');

    const one = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${patientId}`,
      headers: auth(patientToken),
    });
    expect(one.statusCode).toBe(403);
  });

  it('patient cannot touch the doctor verification workflow', async () => {
    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/doctors/admin/verification-queue',
      headers: auth(patientToken),
    });
    expect(queue.statusCode).toBe(403);

    const claim = await app.inject({
      method: 'POST',
      url: `/api/v1/doctors/admin/${randomUUID()}/claim`,
      headers: auth(patientToken),
    });
    expect(claim.statusCode).toBe(403);
  });

  it('patient cannot upload doctor documents or set schedules (doctor:update:own)', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/doctors/me/documents',
      headers: auth(patientToken),
    });
    expect(upload.statusCode).toBe(403);

    const schedule = await app.inject({
      method: 'PUT',
      url: '/api/v1/doctors/me/schedule',
      headers: auth(patientToken),
      payload: { slots: [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }] },
    });
    expect(schedule.statusCode).toBe(403);
  });

  it('patient cannot use doctor-side appointment actions (appointment:read:assigned)', async () => {
    for (const url of [
      `/api/v1/appointments/${randomUUID()}/doctor-cancel`,
      '/api/v1/appointments/check-in',
      `/api/v1/appointments/${randomUUID()}/no-show`,
    ]) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: auth(patientToken),
        payload: { reason: 'not allowed anyway', checkInToken: 'x'.repeat(20) },
      });
      expect(response.statusCode, url).toBe(403);
    }
  });

  it('patient PATCH cannot smuggle platform-owned fields (strict schema → 400)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/patients/me/profile',
      headers: auth(patientToken),
      payload: { patientNumber: 'PN-FORGED', region: 'MWANZA' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('doctor cross-role denials', () => {
  it('doctor cannot read or update patient profiles (patient:*:own / read:any)', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/patients/me/profile',
      headers: auth(doctorToken),
    });
    expect(me.statusCode).toBe(403); // patient:read:own is patient-only

    const adminRead = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${patientId}`,
      headers: auth(doctorToken),
    });
    expect(adminRead.statusCode).toBe(403); // patient:read:any is admin-only
  });

  it('doctor cannot book appointments (appointment:create is patient-side)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/appointments',
      headers: auth(doctorToken),
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it('doctor cannot run the admin verification workflow on themselves', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/doctors/admin/verification-queue',
      headers: auth(doctorToken),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('platform admin positive paths', () => {
  it('admin reaches patient list and verification queue', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/v1/patients', headers: auth(adminToken) });
    expect(patients.statusCode).toBe(200);

    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/doctors/admin/verification-queue',
      headers: auth(adminToken),
    });
    expect(queue.statusCode).toBe(200);
  });

  it('admin PHI reads land in the audit log', async () => {
    const before = deps.state.auditEntries.filter((entry) => entry.resourceType === 'PHI_READ').length;
    await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${patientId}`,
      headers: auth(adminToken),
    });
    const after = deps.state.auditEntries.filter((entry) => entry.resourceType === 'PHI_READ').length;
    expect(after).toBe(before + 1);
  });
});

describe('multipart document upload through the route', () => {
  function multipartBody(fieldName: string, fileName: string, contentType: string, data: Buffer) {
    const boundary = `----daktari${randomUUID().replace(/-/g, '')}`;
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return {
      payload: Buffer.concat([head, data, tail]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  }

  it('accepts a valid PDF from a doctor and rejects a renamed executable', async () => {
    const good = multipartBody('tmc_cert', 'cert.pdf', 'application/pdf', Buffer.from('%PDF-1.7 x'));
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/doctors/me/documents',
      headers: { ...auth(doctorToken), ...good.headers },
      payload: good.payload,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().document.type).toBe('TMC_CERTIFICATE');

    const evil = multipartBody(
      'degree',
      'degree.pdf',
      'application/pdf',
      Buffer.concat([Buffer.from('MZ'), Buffer.alloc(32)]),
    );
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/doctors/me/documents',
      headers: { ...auth(doctorToken), ...evil.headers },
      payload: evil.payload,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe('CONTENT_MISMATCH');
  });
});
