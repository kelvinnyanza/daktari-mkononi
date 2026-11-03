import { beforeAll, describe, expect, it } from 'vitest';
import { createSignedFileToken, createSignedUploadToken } from '@daktari/storage';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps } from './helpers/fakes.js';

const SECRET = 'files-'.padEnd(32, 'y'); // FILE_SIGNING_SECRET from applyTestEnv

function multipart(fileName: string, contentType: string, data: Buffer): { payload: Buffer; boundary: string } {
  const boundary = '----daktari-test-boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  return { payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]), boundary };
}

/** Local stand-in for S3's presigned POST: the token carries and enforces the policy. */
describe('POST /api/v1/files/upload/:token (local presigned upload)', () => {
  beforeAll(() => {
    applyTestEnv();
  });

  async function post(token: string, contentType: string, data: Buffer) {
    const deps = makeFakeDeps();
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ deps, redis: null, logger: false });
    await app.ready();
    const body = multipart('scan.pdf', contentType, data);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/files/upload/${token}`,
      headers: { 'content-type': `multipart/form-data; boundary=${body.boundary}` },
      payload: body.payload,
    });
    await app.close();
    return { response, deps };
  }

  const token = (overrides: Partial<{ maxBytes: number; exp: number; contentType: string }> = {}) =>
    createSignedUploadToken(
      {
        key: 'doctor-docs/d1/tmc_cert.pdf',
        contentType: 'application/pdf',
        maxBytes: 64,
        exp: Date.now() + 60_000,
        ...overrides,
      },
      SECRET,
    );

  it('stores the file under the token key with the token content type → 204', async () => {
    const { response, deps } = await post(token(), 'application/pdf', Buffer.from('%PDF-1.7 hello'));
    expect(response.statusCode).toBe(204);
    expect(deps.storage.blobs.get('doctor-docs/d1/tmc_cert.pdf')).toMatchObject({ contentType: 'application/pdf' });
  });

  it('wrong content type → 400 CONTENT_TYPE_MISMATCH; too large → 400 FILE_TOO_LARGE; nothing stored', async () => {
    const wrongType = await post(token(), 'image/png', Buffer.from('x'));
    expect(wrongType.response.statusCode).toBe(400);
    expect(wrongType.response.json().error.code).toBe('CONTENT_TYPE_MISMATCH');
    expect(wrongType.deps.storage.blobs.size).toBe(0);

    const tooBig = await post(token({ maxBytes: 8 }), 'application/pdf', Buffer.alloc(100, 0x41));
    expect(tooBig.response.statusCode).toBe(400);
    expect(tooBig.response.json().error.code).toBe('FILE_TOO_LARGE');
    expect(tooBig.deps.storage.blobs.size).toBe(0);
  });

  it('regression: a real-length download token is served (was 414 at Fastify’s 100-char param limit)', async () => {
    const deps = makeFakeDeps();
    const key = 'doctor-docs/ckz9x1y2z3a4b5c6d7e8f9g0h/police_clearance.pdf';
    await deps.storage.put(key, Buffer.from('%PDF-1.7'), 'application/pdf');
    const download = createSignedFileToken({ key, contentType: 'application/pdf', exp: Date.now() + 60_000 }, SECRET);
    expect(download.length).toBeGreaterThan(100);
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ deps, redis: null, logger: false });
    const response = await app.inject({ method: 'GET', url: `/api/v1/files/${download}` });
    await app.close();
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('%PDF-1.7');
  });

  it('expired, tampered or download tokens → 404', async () => {
    expect((await post(token({ exp: Date.now() - 1 }), 'application/pdf', Buffer.from('%PDF-'))).response.statusCode).toBe(404);
    expect((await post(`${token()}x`, 'application/pdf', Buffer.from('%PDF-'))).response.statusCode).toBe(404);
    const download = createSignedFileToken(
      { key: 'doctor-docs/d1/tmc_cert.pdf', contentType: 'application/pdf', exp: Date.now() + 60_000 },
      SECRET,
    );
    expect((await post(download, 'application/pdf', Buffer.from('%PDF-'))).response.statusCode).toBe(404);
  });
});
