import { describe, expect, it } from 'vitest';
import { evaluateRefreshAttempt, newTokenFamily } from '../src/index.js';

describe('newTokenFamily', () => {
  it('returns unique UUIDs', () => {
    const families = new Set(Array.from({ length: 100 }, newTokenFamily));
    expect(families.size).toBe(100);
    expect(newTokenFamily()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('evaluateRefreshAttempt', () => {
  it('rotates when the presented token is the active one and the family is live', () => {
    expect(
      evaluateRefreshAttempt({
        presentedTokenHash: 'hash-current',
        activeTokenHash: 'hash-current',
        familyRevokedAt: null,
      }),
    ).toEqual({ action: 'ROTATE' });
  });

  it('revokes the family when an already-rotated token is replayed', () => {
    expect(
      evaluateRefreshAttempt({
        presentedTokenHash: 'hash-old-stolen',
        activeTokenHash: 'hash-current',
        familyRevokedAt: null,
      }),
    ).toEqual({ action: 'REVOKE_FAMILY', reason: 'REUSE_DETECTED' });
  });

  it('treats a family with no active token as reuse', () => {
    expect(
      evaluateRefreshAttempt({
        presentedTokenHash: 'hash-anything',
        activeTokenHash: null,
        familyRevokedAt: null,
      }),
    ).toEqual({ action: 'REVOKE_FAMILY', reason: 'REUSE_DETECTED' });
  });

  it('rejects tokens from an already-revoked family', () => {
    expect(
      evaluateRefreshAttempt({
        presentedTokenHash: 'hash-current',
        activeTokenHash: 'hash-current',
        familyRevokedAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    ).toEqual({ action: 'REVOKE_FAMILY', reason: 'FAMILY_ALREADY_REVOKED' });
  });
});
