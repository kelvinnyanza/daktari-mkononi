import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { S3Storage } from '../src/s3.js';

/**
 * S3Storage against a mocked client: commands are captured, never sent.
 * Presigning is pure local signing (static test credentials) — no network.
 */
function setup(extra: { kmsKeyId?: string; respond?: (command: unknown) => unknown } = {}) {
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = {
    send: (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      return Promise.resolve(extra.respond?.(command) ?? {});
    },
  };
  const presignClient = new S3Client({
    region: 'af-south-1',
    credentials: { accessKeyId: 'AKIATESTKEY', secretAccessKey: 'test-secret' },
  });
  const storage = new S3Storage({
    bucket: 'daktari-docs-test',
    region: 'af-south-1',
    client: client as never,
    presignClient,
    now: () => new Date('2026-11-03T10:00:00Z'),
    ...(extra.kmsKeyId !== undefined ? { kmsKeyId: extra.kmsKeyId } : {}),
  });
  return { storage, sent };
}

describe('S3Storage', () => {
  it('put: bucket from options, exact key, content type, SSE-S3 by default', async () => {
    const { storage, sent } = setup();
    await storage.put('doctor-docs/d1/id.png', Buffer.from('x'), 'image/png');
    expect(sent).toEqual([
      {
        name: 'PutObjectCommand',
        input: expect.objectContaining({
          Bucket: 'daktari-docs-test',
          Key: 'doctor-docs/d1/id.png',
          ContentType: 'image/png',
          ServerSideEncryption: 'AES256',
        }),
      },
    ]);
  });

  it('put with a KMS key → SSE-KMS', async () => {
    const { storage, sent } = setup({ kmsKeyId: 'arn:aws:kms:af-south-1:1:key/abc' });
    await storage.put('k/a.pdf', Buffer.from('x'), 'application/pdf');
    expect(sent[0]!.input).toMatchObject({
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: 'arn:aws:kms:af-south-1:1:key/abc',
    });
  });

  it('presigned POST pins key, exact Content-Type, size range and encryption; short expiry', async () => {
    const { storage } = setup();
    const upload = await storage.createPresignedUpload({
      key: 'doctor-docs/d1/tmc_cert.pdf',
      contentType: 'application/pdf',
      maxBytes: 10 * 1024 * 1024,
      ttlSeconds: 3600,
    });
    expect(upload.url).toContain('daktari-docs-test');
    expect(upload.url).toContain('af-south-1');
    expect(upload.fields).toMatchObject({
      key: 'doctor-docs/d1/tmc_cert.pdf',
      'Content-Type': 'application/pdf',
      'x-amz-server-side-encryption': 'AES256',
    });
    const policy = JSON.parse(Buffer.from(upload.fields.Policy!, 'base64').toString('utf8')) as {
      conditions: unknown[];
    };
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        ['content-length-range', 1, 10 * 1024 * 1024],
        ['eq', '$Content-Type', 'application/pdf'],
        ['eq', '$x-amz-server-side-encryption', 'AES256'],
        { bucket: 'daktari-docs-test' },
        { key: 'doctor-docs/d1/tmc_cert.pdf' },
      ]),
    );
    // Asked for an hour; the upload window is capped at 10 minutes.
    expect(upload.expiresAt.toISOString()).toBe('2026-11-03T10:10:00.000Z');
  });

  it('presigned GET is capped at 15 minutes and signed for the exact key', async () => {
    const { storage } = setup();
    const url = new URL(await storage.getSignedUrl('doctor-docs/d1/id.png', 24 * 3600));
    expect(url.hostname).toContain('daktari-docs-test');
    expect(url.pathname).toBe('/doctor-docs/d1/id.png');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('stat: HeadObject → size/type; 404 → null; readHead asks for a byte range', async () => {
    const { storage, sent } = setup({
      respond: (command) => {
        const name = (command as { constructor: { name: string } }).constructor.name;
        if (name === 'HeadObjectCommand') return { ContentLength: 2048, ContentType: 'application/pdf' };
        if (name === 'GetObjectCommand') {
          return { Body: { transformToByteArray: () => Promise.resolve(new TextEncoder().encode('%PDF-')) } };
        }
        return {};
      },
    });
    expect(await storage.stat('k/a.pdf')).toEqual({ size: 2048, contentType: 'application/pdf' });
    expect((await storage.readHead('k/a.pdf', 5)).toString()).toBe('%PDF-');
    expect(sent[1]!.input).toMatchObject({ Range: 'bytes=0-4' });

    const missing = new S3Storage({
      bucket: 'b',
      region: 'af-south-1',
      client: { send: () => Promise.reject(Object.assign(new Error('nf'), { name: 'NotFound' })) } as never,
      presignClient: new S3Client({ region: 'af-south-1', credentials: { accessKeyId: 'a', secretAccessKey: 'b' } }),
    });
    expect(await missing.stat('k/none.pdf')).toBeNull();
  });

  it('refuses unsafe keys, an empty bucket and half-set credentials', async () => {
    const { storage } = setup();
    await expect(storage.put('../x', Buffer.from('x'), 'text/plain')).rejects.toThrow(/unsafe/);
    expect(() => new S3Storage({ bucket: ' ', region: 'af-south-1' })).toThrow(/S3_BUCKET/);
    expect(() => new S3Storage({ bucket: 'b', region: 'af-south-1', accessKeyId: 'AKIA' })).toThrow(/both/);
  });
});
