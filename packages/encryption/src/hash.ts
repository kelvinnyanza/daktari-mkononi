/**
 * Env-free hashing primitives. This module must never read environment
 * variables — packages/db's seed imports it standalone.
 */
import crypto, { createHash, randomBytes } from 'node:crypto';
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

/**
 * Hash an OTP for storage. SHA-256 (not argon2) is deliberate: OTPs are
 * 6 digits, expire in minutes, and are rate-limited to 5 attempts, so a slow
 * hash buys nothing and would throttle the auth service.
 */
export function hashOtp(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** Verify an OTP against its stored SHA-256 hash using a timing-safe comparison. */
export function verifyOtp(code: string, hash: string): boolean {
  const computed = Buffer.from(hashOtp(code), 'hex');
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
