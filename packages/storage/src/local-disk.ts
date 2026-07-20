import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { StorageNotConfiguredError, type StoragePort } from './port.js';
import { createSignedFileToken } from './signed-token.js';

export interface LocalDiskStorageOptions {
  /** Root directory, e.g. "<repo>/.storage" (gitignored). */
  rootDir: string;
  /** HMAC secret for signed download tokens (>= 32 chars). */
  signingSecret: string;
  /** Route prefix the API serves files from. */
  urlPrefix?: string;
  now?: () => Date;
}

/** Keys are validated, not trusted: no absolute paths, no traversal. */
const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,254}$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`unsafe storage key: ${key}`);
  }
}

const META_SUFFIX = '.meta.json';

/**
 * Dev storage on the local filesystem. Signed URLs point at
 * /api/v1/files/:token where the token is HMAC-signed and expiring — the file
 * route verifies it with the same secret and streams the file. The content
 * type is persisted in a sidecar and travels inside the token.
 */
export class LocalDiskStorage implements StoragePort {
  private readonly rootDir: string;
  private readonly signingSecret: string;
  private readonly urlPrefix: string;
  private readonly now: () => Date;

  constructor(options: LocalDiskStorageOptions) {
    if (options.signingSecret.length < 32) {
      throw new StorageNotConfiguredError('file signing secret must be at least 32 characters');
    }
    this.rootDir = options.rootDir;
    this.signingSecret = options.signingSecret;
    this.urlPrefix = options.urlPrefix ?? '/api/v1/files';
    this.now = options.now ?? ((): Date => new Date());
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const resolved = path.resolve(this.rootDir, key);
    if (!resolved.startsWith(path.resolve(this.rootDir) + path.sep)) {
      throw new Error(`unsafe storage key: ${key}`);
    }
    return resolved;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const filePath = this.resolve(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
    await writeFile(`${filePath}${META_SUFFIX}`, JSON.stringify({ contentType }), 'utf8');
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<string> {
    const filePath = this.resolve(key);
    let contentType = 'application/octet-stream';
    try {
      const meta = JSON.parse(await readFile(`${filePath}${META_SUFFIX}`, 'utf8')) as {
        contentType?: string;
      };
      if (typeof meta.contentType === 'string') contentType = meta.contentType;
    } catch {
      // Missing sidecar → served as a generic download.
    }
    const token = createSignedFileToken(
      { key, contentType, exp: this.now().getTime() + ttlSeconds * 1000 },
      this.signingSecret,
    );
    return `${this.urlPrefix}/${token}`;
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolve(key);
    await rm(filePath, { force: true });
    await rm(`${filePath}${META_SUFFIX}`, { force: true });
  }

  /** Used by the /api/v1/files route after verifying the token. */
  async read(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
}
