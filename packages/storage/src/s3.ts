import { StorageNotConfiguredError, type StoragePort } from './port.js';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
}

/**
 * Production storage on S3-compatible object storage. Stub for now: fully
 * typed against StoragePort, but every call throws STORAGE_NOT_CONFIGURED
 * until AWS credentials are provisioned (the SDK dependency lands with them).
 */
export class S3Storage implements StoragePort {
  constructor(private readonly options: S3StorageOptions) {}

  private assertConfigured(): never {
    if (
      this.options.accessKeyId === undefined ||
      this.options.accessKeyId === '' ||
      this.options.secretAccessKey === undefined ||
      this.options.secretAccessKey === ''
    ) {
      throw new StorageNotConfiguredError('AWS credentials are not set');
    }
    throw new StorageNotConfiguredError('S3 client not implemented yet (Phase 7)');
  }

  async put(_key: string, _data: Buffer, _contentType: string): Promise<void> {
    this.assertConfigured();
  }

  async getSignedUrl(_key: string, _ttlSeconds: number): Promise<string> {
    this.assertConfigured();
  }

  async delete(_key: string): Promise<void> {
    this.assertConfigured();
  }
}
