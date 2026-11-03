import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type ServerSideEncryption,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl as presignGet } from '@aws-sdk/s3-request-presigner';
import { assertSafeKey } from './local-disk.js';
import {
  MAX_DOWNLOAD_URL_TTL_SECONDS,
  MAX_UPLOAD_URL_TTL_SECONDS,
  StorageNotConfiguredError,
  clampTtl,
  type PresignedUpload,
  type PresignedUploadInput,
  type StoragePort,
} from './port.js';

export interface S3StorageOptions {
  /** From env S3_BUCKET — never hard-coded. */
  bucket: string;
  /** af-south-1 (Cape Town) — the region closest to Tanzania. */
  region: string;
  /**
   * Static keys. Both unset ⇒ the SDK's default provider chain (instance /
   * task role) — the Phase 14 target.
   */
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Set ⇒ SSE-KMS with this key; unset ⇒ SSE-S3 (AES256). */
  kmsKeyId?: string;
  /** Tests inject a mocked client; production builds one from the options. */
  client?: Pick<S3Client, 'send'>;
  /** For createPresignedPost / getSignedUrl, which need a real client config. */
  presignClient?: S3Client;
  now?: () => Date;
}

/** Read a streamed body to the end (an unread body would keep the socket open). */
async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (body && typeof body === 'object' && 'transformToByteArray' in body) {
    return Buffer.from(await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
  }
  return Buffer.alloc(0);
}

const isNotFound = (error: unknown): boolean => {
  const named = error as { name?: string; $metadata?: { httpStatusCode?: number } } | undefined;
  return named?.name === 'NotFound' || named?.name === 'NoSuchKey' || named?.$metadata?.httpStatusCode === 404;
};

/**
 * Production document storage on S3 (af-south-1). Every object is written
 * with server-side encryption; uploads from clients go DIRECT to S3 through
 * a presigned POST whose policy pins the key, the exact Content-Type, the
 * size range and the encryption header — S3 itself rejects anything else.
 * Downloads are presigned GETs. All signed URLs are short-lived (≤ 10 min
 * upload, ≤ 15 min download). The bucket should additionally block public
 * access and enforce encryption by policy (docs/pilot-runbook.md).
 */
export class S3Storage implements StoragePort {
  private readonly client: Pick<S3Client, 'send'>;
  private readonly presignClient: S3Client;
  private readonly now: () => Date;

  constructor(private readonly options: S3StorageOptions) {
    if (options.bucket.trim() === '') throw new StorageNotConfiguredError('S3_BUCKET is empty');
    const hasKey = options.accessKeyId !== undefined && options.accessKeyId !== '';
    const hasSecret = options.secretAccessKey !== undefined && options.secretAccessKey !== '';
    if (hasKey !== hasSecret) {
      throw new StorageNotConfiguredError('set both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or neither (role)');
    }
    const built =
      options.presignClient ??
      new S3Client({
        region: options.region,
        ...(hasKey
          ? { credentials: { accessKeyId: options.accessKeyId!, secretAccessKey: options.secretAccessKey! } }
          : {}),
      });
    this.presignClient = built;
    this.client = options.client ?? built;
    this.now = options.now ?? ((): Date => new Date());
  }

  private get encryption(): { ServerSideEncryption: ServerSideEncryption; SSEKMSKeyId?: string } {
    return this.options.kmsKeyId !== undefined
      ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: this.options.kmsKeyId }
      : { ServerSideEncryption: 'AES256' };
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        ...this.encryption,
      }),
    );
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    return presignGet(this.presignClient, new GetObjectCommand({ Bucket: this.options.bucket, Key: key }), {
      expiresIn: clampTtl(ttlSeconds, MAX_DOWNLOAD_URL_TTL_SECONDS),
    });
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  async createPresignedUpload(input: PresignedUploadInput): Promise<PresignedUpload> {
    assertSafeKey(input.key);
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) {
      throw new RangeError('maxBytes must be a positive integer');
    }
    const expires = clampTtl(input.ttlSeconds, MAX_UPLOAD_URL_TTL_SECONDS);
    const sse = this.encryption;
    const encryptionFields: Record<string, string> = {
      'x-amz-server-side-encryption': sse.ServerSideEncryption,
      ...(sse.SSEKMSKeyId !== undefined ? { 'x-amz-server-side-encryption-aws-kms-key-id': sse.SSEKMSKeyId } : {}),
    };
    const { url, fields } = await createPresignedPost(this.presignClient, {
      Bucket: this.options.bucket,
      Key: input.key, // exact key — the policy pins it
      Expires: expires,
      Fields: { 'Content-Type': input.contentType, ...encryptionFields },
      Conditions: [
        ['content-length-range', 1, input.maxBytes],
        ['eq', '$Content-Type', input.contentType],
        ...Object.entries(encryptionFields).map(([name, value]) => ['eq', `$${name}`, value] as ['eq', string, string]),
      ],
    });
    return {
      url,
      method: 'POST',
      fields,
      contentType: input.contentType,
      maxBytes: input.maxBytes,
      expiresAt: new Date(this.now().getTime() + expires * 1000),
    };
  }

  async stat(key: string): Promise<{ size: number; contentType: string | null } | null> {
    assertSafeKey(key);
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async readHead(key: string, length: number): Promise<Buffer> {
    assertSafeKey(key);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key, Range: `bytes=0-${Math.max(0, length - 1)}` }),
    );
    return (await bodyToBuffer(result.Body)).subarray(0, length);
  }
}
