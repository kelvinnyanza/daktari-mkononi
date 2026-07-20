import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDiskStorage } from '../src/local-disk.js';
import { verifySignedFileToken } from '../src/signed-token.js';
import { S3Storage } from '../src/s3.js';
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

describe('S3Storage stub', () => {
  it('throws STORAGE_NOT_CONFIGURED without AWS credentials', async () => {
    const s3 = new S3Storage({
      bucket: 'daktari',
      region: 'af-south-1',
      accessKeyId: undefined,
      secretAccessKey: undefined,
    });
    await expect(s3.put('k', Buffer.from('x'), 'text/plain')).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    });
    await expect(s3.getSignedUrl('k', 60)).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });
    await expect(s3.delete('k')).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });
  });
});
