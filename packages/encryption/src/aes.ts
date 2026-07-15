/**
 * AES-256-GCM encryption for PHI at rest (Tanzania PDPA 2022).
 *
 * Payload format v1 (JSON, all fields hex):
 *   { "v": 1, "iv": <12-byte IV>, "tag": <16-byte GCM tag>, "ct": <ciphertext> }
 *
 * The version field exists so a future key/algorithm rotation (v2) can decrypt
 * old rows without a migration rewrite.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { env } from '@daktari/config';
import { InvalidKeyError, InvalidPayloadError, TamperedDataError } from './errors.js';

const KEY_BYTES = 32;
const IV_BYTES = 12;

const hexString = (bytes?: number) =>
  bytes === undefined
    ? z.string().regex(/^(?:[0-9a-f]{2})*$/i)
    : z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`, 'i'));

const payloadV1Schema = z.object({
  v: z.literal(1),
  iv: hexString(IV_BYTES),
  tag: hexString(16),
  ct: hexString(),
});

/** Versioned encrypted payload, format v1. */
export type EncryptedPayloadV1 = z.infer<typeof payloadV1Schema>;

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new InvalidKeyError(`Encryption key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
}

/**
 * Encrypt UTF-8 plaintext with AES-256-GCM under the given 32-byte key.
 * A fresh random 12-byte IV is generated per call.
 * @returns the serialized v1 payload (JSON string) for storage.
 */
export function encryptAesGcm(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const payload: EncryptedPayloadV1 = {
    v: 1,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ct: ciphertext.toString('hex'),
  };
  return JSON.stringify(payload);
}

/**
 * Decrypt a serialized v1 payload with the given 32-byte key.
 * @throws InvalidPayloadError if the payload is not valid v1 JSON.
 * @throws TamperedDataError if GCM authentication fails (tampered iv/tag/ct
 *         or wrong key) — no partial plaintext is ever returned.
 */
export function decryptAesGcm(payload: string, key: Buffer): string {
  assertKey(key);
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw new InvalidPayloadError('Encrypted payload is not valid JSON');
  }
  const parsed = payloadV1Schema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidPayloadError('Encrypted payload does not match format v1');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.data.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(parsed.data.tag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.data.ct, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new TamperedDataError();
  }
}

/**
 * Read the platform PHI key from validated env. Lazy by construction:
 * `env` is a validate-on-first-access proxy, so importing this module
 * never requires ENCRYPTION_KEY to be set.
 */
function healthDataKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'hex');
}

/** Encrypt PHI with the platform ENCRYPTION_KEY (from validated env). */
export function encryptHealthData(plaintext: string): string {
  return encryptAesGcm(plaintext, healthDataKey());
}

/**
 * Decrypt PHI stored with the platform ENCRYPTION_KEY.
 * @throws TamperedDataError on any authentication failure.
 */
export function decryptHealthData(payload: string): string {
  return decryptAesGcm(payload, healthDataKey());
}
