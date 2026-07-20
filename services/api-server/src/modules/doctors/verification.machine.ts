import type { DoctorVerificationStatus } from '@daktari/db';
import type { Permission } from '@daktari/auth';

/**
 * Doctor verification state machine — one explicit transition table, no
 * scattered ifs. The service executes side effects listed here; every applied
 * transition writes an AuditLog row (DOCTOR_VERIFICATION_TRANSITION).
 *
 *   PENDING ──(docs complete)──► DOCUMENTS_SUBMITTED ──(claim)──► UNDER_REVIEW
 *   REJECTED ──(re-upload completes set)──► DOCUMENTS_SUBMITTED
 *   UNDER_REVIEW ──(decision)──► APPROVED | REJECTED
 *   APPROVED ──(suspend)──► SUSPENDED
 */
export type VerificationEvent =
  | 'DOCUMENTS_COMPLETE'
  | 'CLAIM'
  | 'APPROVE'
  | 'REJECT'
  | 'SUSPEND';

export interface VerificationTransition {
  event: VerificationEvent;
  from: DoctorVerificationStatus;
  to: DoctorVerificationStatus;
  /** null → system-triggered (no permission check beyond route auth). */
  permission: Permission | null;
  sideEffects: readonly string[];
}

export const VERIFICATION_TRANSITIONS: readonly VerificationTransition[] = [
  {
    event: 'DOCUMENTS_COMPLETE',
    from: 'PENDING',
    to: 'DOCUMENTS_SUBMITTED',
    permission: null, // automatic when tmc_cert + degree + id are all present
    sideEffects: ['audit'],
  },
  {
    event: 'DOCUMENTS_COMPLETE',
    from: 'REJECTED',
    to: 'DOCUMENTS_SUBMITTED',
    permission: null, // re-submission after rejection re-enters the queue
    sideEffects: ['audit'],
  },
  {
    event: 'CLAIM',
    from: 'DOCUMENTS_SUBMITTED',
    to: 'UNDER_REVIEW',
    permission: 'doctor:verify',
    sideEffects: ['audit', 'record-reviewer'],
  },
  {
    event: 'APPROVE',
    from: 'UNDER_REVIEW',
    to: 'APPROVED',
    permission: 'doctor:verify',
    sideEffects: ['audit', 'set-verifiedAt', 'sms-doctor'], // requires all required docs APPROVED
  },
  {
    event: 'REJECT',
    from: 'UNDER_REVIEW',
    to: 'REJECTED',
    permission: 'doctor:verify',
    sideEffects: ['audit', 'record-rejection-notes', 'sms-doctor'], // requires notes
  },
  {
    event: 'SUSPEND',
    from: 'APPROVED',
    to: 'SUSPENDED',
    permission: 'doctor:verify',
    sideEffects: ['audit', 'record-suspension-reason', 'sms-doctor', 'exclude-from-directory'],
  },
] as const;

/** The single lookup the service uses; undefined = illegal → 409. */
export function findVerificationTransition(
  event: VerificationEvent,
  from: DoctorVerificationStatus,
): VerificationTransition | undefined {
  return VERIFICATION_TRANSITIONS.find(
    (transition) => transition.event === event && transition.from === from,
  );
}
