/**
 * Env-free hashing primitives. This module must never read environment
 * variables — packages/db's seed imports it standalone.
 */
import crypto, { createHmac, randomBytes } from 'node:crypto';
import argon2 from 'argon2';

/** OWASP-aligned argon2id parameters: 64 MiB memory, 3 iterations, 4 lanes. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

/**
 * Hash a password with argon2id. The salt is generated internally, so two
 * hashes of the same password always differ.
 */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a password against an argon2id hash. Returns false (never throws)
 * for wrong passwords or malformed hashes.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Cryptographically secure random token, hex-encoded.
 * @param bytes entropy size; the returned string is `2 * bytes` hex chars.
 */
export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Generate a 6-digit OTP as a zero-padded string ("004217" is valid).
 * Uses rejection sampling over a 32-bit CSPRNG draw so every code in
 * 000000–999999 is exactly equally likely (no modulo bias).
 */
export function generateOtp(): string {
  const range = 1_000_000;
  const maxUint32 = 0x1_0000_0000;
  const limit = maxUint32 - (maxUint32 % range); // largest multiple of range below 2^32
  let value: number;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= limit);
  return String(value % range).padStart(6, '0');
}

/** Keying material for OTP hashing. */
export interface OtpHashParams {
  /**
   * Server-side secret (env OTP_PEPPER, never stored with the data).
   * A 6-digit OTP has only 10^6 possibilities — a leaked table of plain
   * SHA-256 hashes is brute-forced instantly. HMAC with a pepper means a
   * table leak alone reveals nothing.
   */
  pepper: string;
  /**
   * Binds the hash to its owner and purpose, e.g. `${userId}:PHONE_VERIFY`.
   * The same code issued to two users (or two purposes) hashes differently,
   * so hashes cannot be correlated or replayed across rows.
   */
  context: string;
}

/**
 * Hash an OTP for storage: HMAC-SHA-256(pepper, context:code).
 * A fast hash (not argon2) is deliberate — OTPs expire in minutes and are
 * capped at 5 attempts, so slow hashing buys nothing; the pepper + context
 * binding is what protects a leaked table.
 */
export function hashOtp(code: string, params: OtpHashParams): string {
  return createHmac('sha256', params.pepper)
    .update(`${params.context}:${code}`, 'utf8')
    .digest('hex');
}

/** Verify an OTP against its stored HMAC using a timing-safe comparison. */
export function verifyOtp(code: string, hash: string, params: OtpHashParams): boolean {
  const computed = Buffer.from(hashOtp(code, params), 'hex');
  let stored: Buffer;
  try {
    stored = Buffer.from(hash, 'hex');
  } catch {
    return false;
  }
  if (stored.length !== computed.length) {
    return false;
  }
  return crypto.timingSafeEqual(computed, stored);
}
