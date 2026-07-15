import { describe, expect, it } from 'vitest';
import { idSchema, tzPhoneSchema, tzsAmountSchema } from '../src/common.js';

describe('tzPhoneSchema', () => {
  it('accepts a canonical +255 number', () => {
    expect(tzPhoneSchema.parse('+255712345678')).toBe('+255712345678');
  });

  it('normalizes a 0-prefixed local number', () => {
    expect(tzPhoneSchema.parse('0712345678')).toBe('+255712345678');
  });

  it('normalizes a bare 255-prefixed number', () => {
    expect(tzPhoneSchema.parse('255712345678')).toBe('+255712345678');
  });

  it('strips spaces and dashes before validating', () => {
    expect(tzPhoneSchema.parse('+255 712 345 678')).toBe('+255712345678');
    expect(tzPhoneSchema.parse('0712-345-678')).toBe('+255712345678');
  });

  it('rejects non-Tanzanian and malformed numbers', () => {
    expect(() => tzPhoneSchema.parse('+254712345678')).toThrow(); // Kenya
    expect(() => tzPhoneSchema.parse('+25571234567')).toThrow(); // 8 digits
    expect(() => tzPhoneSchema.parse('+2557123456789')).toThrow(); // 10 digits
    expect(() => tzPhoneSchema.parse('712345678')).toThrow(); // no prefix at all
    expect(() => tzPhoneSchema.parse('+255abc345678')).toThrow();
  });
});

describe('idSchema', () => {
  it('accepts a CUID', () => {
    expect(idSchema.parse('clx1q2w3e4r5t6y7u8i9o0p1')).toBe('clx1q2w3e4r5t6y7u8i9o0p1');
  });

  it('accepts a UUID', () => {
    const uuid = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff';
    expect(idSchema.parse(uuid)).toBe(uuid);
  });

  it('rejects a Mongo ObjectId', () => {
    expect(() => idSchema.parse('507f1f77bcf86cd799439011')).toThrow();
  });

  it('rejects arbitrary strings', () => {
    expect(() => idSchema.parse('not-an-id')).toThrow();
  });
});

describe('tzsAmountSchema', () => {
  it('accepts whole-shilling amounts', () => {
    expect(tzsAmountSchema.parse(25_000)).toBe(25_000);
  });

  it('rejects decimal and non-positive amounts', () => {
    expect(() => tzsAmountSchema.parse(25_000.5)).toThrow();
    expect(() => tzsAmountSchema.parse(0)).toThrow();
    expect(() => tzsAmountSchema.parse(-100)).toThrow();
  });
});
