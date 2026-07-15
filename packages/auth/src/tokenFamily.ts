/**
 * Refresh-token rotation with family reuse detection (pure logic only —
 * the DB writes that persist these decisions land in Phase 3).
 *
 * Contract:
 *  - Every login starts a new token family (newTokenFamily()).
 *  - Each refresh rotates: the presented token is retired and exactly one
 *    newer token becomes the family's active token.
 *  - If a presented token is NOT the family's active token, it was already
 *    rotated once — someone is replaying a stolen refresh token. The ONLY
 *    safe response is to revoke the entire family and its session, forcing
 *    both the attacker and the legitimate user to re-authenticate.
 *  - A presented token for an already-revoked family is always rejected.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

/** Start a new token family (one per login/session). */
export function newTokenFamily(): string {
  return randomUUID();
}

export interface RefreshAttempt {
  /** Hash of the refresh token the client just presented. */
  presentedTokenHash: string;
  /** Hash of the family's currently active (most recently issued) token; null if none recorded. */
  activeTokenHash: string | null;
  /** When the family was revoked, if it ever was. */
  familyRevokedAt: Date | null;
}

export type RefreshDecision =
  | { action: 'ROTATE' }
  | { action: 'REVOKE_FAMILY'; reason: 'REUSE_DETECTED' | 'FAMILY_ALREADY_REVOKED' };

/** Constant-time equality over strings of possibly different lengths. */
function constantTimeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Decide what to do with a refresh attempt.
 *
 * Returns ROTATE only when the presented token is the family's active token
 * and the family is unrevoked. Any other combination revokes the family:
 * the caller (Phase 3 auth service) must then revoke every session/token in
 * the family and audit-log the event before responding 401.
 */
export function evaluateRefreshAttempt(attempt: RefreshAttempt): RefreshDecision {
  if (attempt.familyRevokedAt !== null) {
    return { action: 'REVOKE_FAMILY', reason: 'FAMILY_ALREADY_REVOKED' };
  }
  if (
    attempt.activeTokenHash === null ||
    !constantTimeEqual(attempt.presentedTokenHash, attempt.activeTokenHash)
  ) {
    // The token was valid once but has since been rotated out — replay.
    return { action: 'REVOKE_FAMILY', reason: 'REUSE_DETECTED' };
  }
  return { action: 'ROTATE' };
}
