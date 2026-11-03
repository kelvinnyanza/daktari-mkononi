import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDiskStorage } from '../src/local-disk.js';
import { verifySignedFileToken, verifySignedUploadToken } from '../src/signed-token.js';
import { StorageNotConfiguredError } from '../src/port.js';

const SECRET = 'file-signing-secret-file-signing-secret';

let rootDir: string;
let clock: { now: Date };
let storage: LocalDiskStorage;

beforeAll(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), 'daktari-storage-'));
  clock = { now: new Date('2026-07-16T09:00:00.000Z') };
  storage = new LocalDiskStorage({
    rootDir,
    signingSecret: SECRET,
    now: () => clock.now,
  });
});

afterAll(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('LocalDiskStorage', () => {
  it('round-trips a file and issues a verifiable signed URL', async () => {
    const data = Buffer.from('%PDF-1.7 test');
    await storage.put('doctor-docs/d1/tmc_cert.pdf', data, 'application/pdf');

    const url = await storage.getSignedUrl('doctor-docs/d1/tmc_cert.pdf', 300);
    expect(url.startsWith('/api/v1/files/')).toBe(true);

    const token = url.slice('/api/v1/files/'.length);
    const payload = verifySignedFileToken(token, SECRET, clock.now);
    expect(payload).not.toBeNull();
    expect(payload!.key).toBe('doctor-docs/d1/tmc_cert.pdf');
    expect(payload!.contentType).toBe('application/pdf'); // from the sidecar

    const read = await storage.read(payload!.key);
    expect(read.equals(data)).toBe(true);
  });

  it('expired and tampered tokens verify to null', async () => {
    await storage.put('doctor-docs/d1/id.png', Buffer.from([0x89]), 'image/png');
    const url = await storage.getSignedUrl('doctor-docs/d1/id.png', 60);
    const token = url.slice('/api/v1/files/'.length);

    // Expired: 61 seconds later.
    expect(verifySignedFileToken(token, SECRET, new Date(clock.now.getTime() + 61_000))).toBeNull();
    // Tampered signature.
    expect(verifySignedFileToken(`${token.slice(0, -2)}xx`, SECRET, clock.now)).toBeNull();
    // Wrong secret.
    expect(verifySignedFileToken(token, 'x'.repeat(40), clock.now)).toBeNull();
    // Garbage.
    expect(verifySignedFileToken('not-a-token', SECRET, clock.now)).toBeNull();
  });

  it('refuses path-traversal and absolute keys', async () => {
    await expect(storage.put('../escape.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(/unsafe/);
    await expect(storage.put('a/../../escape.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(/unsafe/);
    await expect(storage.put('/etc/passwd', Buffer.from('x'), 'text/plain')).rejects.toThrow(/unsafe/);
    await expect(storage.read('..\\pgdata\\postgresql.conf')).rejects.toThrow(/unsafe/);
  });

  it('delete removes the file so reads fail afterwards', async () => {
    await storage.put('tmp/gone.pdf', Buffer.from('%PDF-'), 'application/pdf');
    await storage.delete('tmp/gone.pdf');
    await expect(storage.read('tmp/gone.pdf')).rejects.toThrow();
  });

  it('requires a signing secret of at least 32 characters', () => {
    expect(() => new LocalDiskStorage({ rootDir, signingSecret: 'short' })).toThrow(
      StorageNotConfiguredError,
    );
  });
});

describe('LocalDiskStorage presigned upload (same contract as S3)', () => {
  const secret = 's'.repeat(32);
  it('issues a domain-separated upload token carrying key, type, size cap and a clamped expiry', async () => {
    const now = new Date('2026-11-03T10:00:00Z');
    const storage = new LocalDiskStorage({ rootDir, signingSecret: secret, now: () => now });
    const upload = await storage.createPresignedUpload({
      key: 'doctor-docs/d1/tmc_cert.pdf',
      contentType: 'application/pdf',
      maxBytes: 1024,
      ttlSeconds: 3600, // asked for an hour …
    });
    expect(upload.method).toBe('POST');
    expect(upload.fields).toEqual({});
    expect(upload.expiresAt.getTime() - now.getTime()).toBe(600_000); // … capped at 10 min
    const token = upload.url.replace('/api/v1/files/upload/', '');
    expect(verifySignedUploadToken(token, secret, now)).toMatchObject({
      key: 'doctor-docs/d1/tmc_cert.pdf',
      contentType: 'application/pdf',
      maxBytes: 1024,
    });
    // Never usable as a download token, and a download token never as an upload token.
    expect(verifySignedFileToken(token, secret, now)).toBeNull();
    const download = (await storage.getSignedUrl('doctor-docs/d1/tmc_cert.pdf', 60)).replace('/api/v1/files/', '');
    expect(verifySignedUploadToken(download, secret, now)).toBeNull();
    await expect(
      storage.createPresignedUpload({ key: '../etc/passwd', contentType: 'x', maxBytes: 1, ttlSeconds: 60 }),
    ).rejects.toThrow(/unsafe/);
  });

  it('stat + readHead report size, type and the first bytes', async () => {
    const storage = new LocalDiskStorage({ rootDir, signingSecret: secret });
    await storage.put('t/head.pdf', Buffer.from('%PDF-1.7 rest'), 'application/pdf');
    expect(await storage.stat('t/head.pdf')).toEqual({ size: 13, contentType: 'application/pdf' });
    expect((await storage.readHead('t/head.pdf', 5)).toString()).toBe('%PDF-');
    expect(await storage.stat('t/missing.pdf')).toBeNull();
  });
});
