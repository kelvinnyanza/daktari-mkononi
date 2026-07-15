import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptAesGcm,
  encryptAesGcm,
  InvalidKeyError,
  InvalidPayloadError,
  TamperedDataError,
} from '../src/index.js';

const key = randomBytes(32);
const phi = 'Mgonjwa: Juma Mwinyi. Utambuzi: B50.9 malaria. Dawa: ALu 4x6.';

describe('encryptAesGcm / decryptAesGcm', () => {
  it('round-trips UTF-8 plaintext', () => {
    expect(decryptAesGcm(encryptAesGcm(phi, key), key)).toBe(phi);
  });

  it('produces a versioned v1 payload with iv, tag, ct', () => {
    const payload = JSON.parse(encryptAesGcm(phi, key)) as Record<string, unknown>;
    expect(payload['v']).toBe(1);
    expect(payload['iv']).toMatch(/^[0-9a-f]{24}$/); // 12 bytes
    expect(payload['tag']).toMatch(/^[0-9a-f]{32}$/); // 16 bytes
    expect(typeof payload['ct']).toBe('string');
  });

  it('generates a unique IV per call', () => {
    const ivs = new Set(
      Array.from({ length: 50 }, () => {
        const payload = JSON.parse(encryptAesGcm(phi, key)) as { iv: string };
        return payload.iv;
      }),
    );
    expect(ivs.size).toBe(50);
  });

  it('throws TamperedDataError when the ciphertext is modified', () => {
    const payload = JSON.parse(encryptAesGcm(phi, key)) as { ct: string; [k: string]: unknown };
    const firstByte = payload.ct.slice(0, 2) === '00' ? 'ff' : '00';
    payload.ct = firstByte + payload.ct.slice(2);
    expect(() => decryptAesGcm(JSON.stringify(payload), key)).toThrow(TamperedDataError);
  });

  it('throws TamperedDataError when the auth tag is modified', () => {
    const payload = JSON.parse(encryptAesGcm(phi, key)) as { tag: string; [k: string]: unknown };
    const firstByte = payload.tag.slice(0, 2) === '00' ? 'ff' : '00';
    payload.tag = firstByte + payload.tag.slice(2);
    expect(() => decryptAesGcm(JSON.stringify(payload), key)).toThrow(TamperedDataError);
  });

  it('throws TamperedDataError with the wrong key', () => {
    const payload = encryptAesGcm(phi, key);
    expect(() => decryptAesGcm(payload, randomBytes(32))).toThrow(TamperedDataError);
  });

  it('throws InvalidPayloadError on garbage or wrong-version payloads', () => {
    expect(() => decryptAesGcm('not json', key)).toThrow(InvalidPayloadError);
    expect(() => decryptAesGcm('{"v":2,"iv":"","tag":"","ct":""}', key)).toThrow(
      InvalidPayloadError,
    );
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => encryptAesGcm(phi, randomBytes(16))).toThrow(InvalidKeyError);
    expect(() => decryptAesGcm(encryptAesGcm(phi, key), randomBytes(64))).toThrow(
      InvalidKeyError,
    );
  });
});
