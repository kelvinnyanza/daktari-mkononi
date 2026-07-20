/** File storage port — implemented by LocalDiskStorage (dev) and S3Storage (prod). */
export interface StoragePort {
  /** Store a blob under `key` (path-like, e.g. "doctor-docs/<id>/tmc_cert.pdf"). */
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /**
   * Time-limited download URL. Local impl returns an API-relative path
   * (/api/v1/files/:token); S3 returns a presigned URL.
   */
  getSignedUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export class StorageNotConfiguredError extends Error {
  readonly code = 'STORAGE_NOT_CONFIGURED';

  constructor(detail: string) {
    super(`storage is not configured: ${detail}`);
    this.name = 'StorageNotConfiguredError';
  }
}
