import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { generateOtp, hashOtp, verifyOtp } from '../src/index.js';

describe('generateOtp', () => {
  it('always returns exactly 6 digits, zero-padded', () => {
    for (let i = 0; i < 1_000; i += 1) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it('preserves leading zeros (codes below 100000 keep length 6)', () => {
    // With 5000 draws, P(no code < 100000) ≈ (0.9)^5000 ≈ 10^-229.
    const codes = Array.from({ length: 5_000 }, generateOtp);
    expect(codes.every((code) => code.length === 6)).toBe(true);
    expect(codes.some((code) => code.startsWith('0'))).toBe(true);
  });

  it('has sane distribution across the range (rejection sampling, no modulo pile-up)', () => {
    const buckets = [0, 0, 0, 0];
    for (let i = 0; i < 8_000; i += 1) {
      const bucket = Math.floor(Number(generateOtp()) / 250_000);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    // each quarter expects ~2000; allow generous ±25% noise margin
    for (const count of buckets) {
      expect(count).toBeGreaterThan(1_500);
      expect(count).toBeLessThan(2_500);
    }
  });
});

describe('hashOtp / verifyOtp', () => {
  const params = { pepper: 'p'.repeat(32), context: 'user-1:PHONE_VERIFY' };

  it('verifies the correct code', () => {
    const hash = hashOtp('004217', params);
    expect(verifyOtp('004217', hash, params)).toBe(true);
  });

  it('rejects a wrong code and a malformed hash', () => {
    const hash = hashOtp('004217', params);
    expect(verifyOtp('004218', hash, params)).toBe(false);
    expect(verifyOtp('004217', 'zz-not-hex', params)).toBe(false);
    expect(verifyOtp('004217', 'abcd', params)).toBe(false); // wrong length
  });

  it('binds the hash to the pepper — same code, different pepper, different hash', () => {
    const hash = hashOtp('123456', params);
    const otherPepper = { ...params, pepper: 'q'.repeat(32) };
    expect(hashOtp('123456', otherPepper)).not.toBe(hash);
    expect(verifyOtp('123456', hash, otherPepper)).toBe(false);
  });

  it('binds the hash to the context — same code for two users hashes differently', () => {
    const hash = hashOtp('123456', params);
    const otherUser = { ...params, context: 'user-2:PHONE_VERIFY' };
    const otherPurpose = { ...params, context: 'user-1:PASSWORD_RESET' };
    expect(hashOtp('123456', otherUser)).not.toBe(hash);
    expect(hashOtp('123456', otherPurpose)).not.toBe(hash);
    expect(verifyOtp('123456', hash, otherUser)).toBe(false);
  });

  it('uses a timing-safe comparison under the hood', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    const hash = hashOtp('123456', params);
    expect(verifyOtp('123456', hash, params)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
