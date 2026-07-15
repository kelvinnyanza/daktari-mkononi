import { describe, expect, it } from 'vitest';
import { generateSecureToken, hashPassword, verifyPassword } from '../src/index.js';

describe('hashPassword / verifyPassword', () => {
  it('verifies the correct password', async () => {
    const hash = await hashPassword('Siri-Kali-123!');
    await expect(verifyPassword(hash, 'Siri-Kali-123!')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('Siri-Kali-123!');
    await expect(verifyPassword(hash, 'siri-kali-123!')).resolves.toBe(false);
  });

  it('salts hashes — same password, different hashes, both verify', async () => {
    const [first, second] = await Promise.all([
      hashPassword('Siri-Kali-123!'),
      hashPassword('Siri-Kali-123!'),
    ]);
    expect(first).not.toBe(second);
    await expect(verifyPassword(second, 'Siri-Kali-123!')).resolves.toBe(true);
  });

  it('uses argon2id with the configured cost parameters', async () => {
    const hash = await hashPassword('Siri-Kali-123!');
    expect(hash).toContain('$argon2id$');
    expect(hash).toContain('m=65536,t=3,p=4');
  });

  it('returns false (not a throw) for a malformed stored hash', async () => {
    await expect(verifyPassword('not-a-hash', 'whatever')).resolves.toBe(false);
  });
});

describe('generateSecureToken', () => {
  it('returns hex of the requested entropy size', () => {
    expect(generateSecureToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSecureToken(16)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateSecureToken()));
    expect(tokens.size).toBe(100);
  });
});
