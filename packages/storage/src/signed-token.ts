import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-signed, expiring download token for locally stored files:
 * base64url(JSON payload) + "." + base64url(HMAC-SHA-256(secret, payloadB64)).
 * Self-contained — the file route only needs the shared secret to verify.
 */
export interface SignedFilePayload {
  key: string;
  contentType: string;
  /** Unix epoch milliseconds. */
  exp: number;
}

const b64url = (data: Buffer): string => data.toString('base64url');

const sign = (payloadB64: string, secret: string): string =>
  b64url(createHmac('sha256', secret).update(payloadB64).digest());

/**
 * Upload tokens are HMAC'd under a distinct prefix (domain separation): a
 * download token can never be replayed as an upload token or vice versa,
 * even though both carry key / contentType / exp.
 */
const UPLOAD_CONTEXT = 'daktari-upload-v1.';

export interface SignedUploadPayload {
  key: string;
  contentType: string;
  maxBytes: number;
  /** Unix epoch milliseconds. */
  exp: number;
}

export function createSignedUploadToken(payload: SignedUploadPayload, secret: string): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${sign(UPLOAD_CONTEXT + payloadB64, secret)}`;
}

/** Payload of a valid, unexpired upload token; null otherwise (never throws). */
export function verifySignedUploadToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): SignedUploadPayload | null {
  const payload = verifyWith(token, secret, UPLOAD_CONTEXT);
  if (
    payload === null ||
    typeof payload.key !== 'string' ||
    typeof payload.contentType !== 'string' ||
    typeof payload.maxBytes !== 'number' ||
    typeof payload.exp !== 'number'
  ) {
    return null;
  }
  const typed = payload as unknown as SignedUploadPayload;
  return typed.exp > now.getTime() ? typed : null;
}

function verifyWith(token: string, secret: string, context: string): Record<string, unknown> | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const presentedBuf = Buffer.from(token.slice(dot + 1), 'base64url');
  const expectedBuf = Buffer.from(sign(context + payloadB64, secret), 'base64url');
  if (presentedBuf.length !== expectedBuf.length || !timingSafeEqual(presentedBuf, expectedBuf)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createSignedFileToken(payload: SignedFilePayload, secret: string): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Returns the payload for a valid, unexpired token; null otherwise (never throws). */
export function verifySignedFileToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): SignedFilePayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const presented = token.slice(dot + 1);
  const expected = sign(payloadB64, secret);
  const presentedBuf = Buffer.from(presented, 'base64url');
  const expectedBuf = Buffer.from(expected, 'base64url');
  if (presentedBuf.length !== expectedBuf.length || !timingSafeEqual(presentedBuf, expectedBuf)) {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as SignedFilePayload).key !== 'string' ||
    typeof (payload as SignedFilePayload).contentType !== 'string' ||
    typeof (payload as SignedFilePayload).exp !== 'number'
  ) {
    return null;
  }
  const typed = payload as SignedFilePayload;
  if (typed.exp <= now.getTime()) return null;
  return typed;
}
