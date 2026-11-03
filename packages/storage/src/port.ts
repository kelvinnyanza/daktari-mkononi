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
  /**
   * Direct-upload target the CLIENT posts the file to (the bytes never pass
   * through the API). The storage enforces the size range and content type;
   * the API still sniffs the stored bytes afterwards (readHead) because no
   * policy can check what a file actually contains.
   */
  createPresignedUpload(input: PresignedUploadInput): Promise<PresignedUpload>;
  /** Size + stored content type, or null when the object does not exist. */
  stat(key: string): Promise<{ size: number; contentType: string | null } | null>;
  /** The first `length` bytes (magic-byte check after a direct upload). */
  readHead(key: string, length: number): Promise<Buffer>;
}

export interface PresignedUploadInput {
  key: string;
  contentType: string;
  maxBytes: number;
  ttlSeconds: number;
}

/**
 * POST multipart/form-data to `url`: every `fields` entry first (order
 * preserved), then the file as the LAST part, named "file". A relative `url`
 * (local dev) is relative to the API origin.
 */
export interface PresignedUpload {
  url: string;
  method: 'POST';
  fields: Record<string, string>;
  contentType: string;
  maxBytes: number;
  expiresAt: Date;
}

/** Upper bounds for any signed URL this package issues. */
export const MAX_UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const MAX_DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

export function clampTtl(ttlSeconds: number, max: number): number {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new RangeError('ttlSeconds must be positive');
  return Math.min(Math.floor(ttlSeconds), max);
}

export class StorageNotConfiguredError extends Error {
  readonly code = 'STORAGE_NOT_CONFIGURED';

  constructor(detail: string) {
    super(`storage is not configured: ${detail}`);
    this.name = 'StorageNotConfiguredError';
  }
}
