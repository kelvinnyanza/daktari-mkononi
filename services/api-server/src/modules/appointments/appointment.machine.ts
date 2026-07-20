import type { AppointmentStatus } from '@daktari/db';
import type { Permission } from '@daktari/auth';

/**
 * Appointment state machine — one explicit transition table, no scattered
 * ifs. The service is the only executor; every applied transition writes an
 * AuditLog row (APPOINTMENT_TRANSITION). Guards (cancellation window, no-show
 * grace, insurance verification) are named here and enforced in the service.
 *
 *   PENDING_PAYMENT ──payment/insurance/cash──► CONFIRMED
 *   PENDING_PAYMENT ──timeout/cancel──► CANCELLED
 *   CONFIRMED ──check-in token──► CHECKED_IN
 *   CONFIRMED ──cancel/no-show──► CANCELLED | NO_SHOW
 *   CONFIRMED/CHECKED_IN ──start──► IN_PROGRESS ──complete──► COMPLETED
 *   IN_PROGRESS ──technical failure──► CONFIRMED (once per appointment)
 */
export type AppointmentEvent =
  | 'PAYMENT_COMPLETED'
  | 'INSURANCE_CONFIRMED'
  | 'CASH_CONFIRMED'
  | 'PAYMENT_TIMEOUT'
  | 'PATIENT_CANCEL'
  | 'DOCTOR_CANCEL'
  | 'CHECK_IN'
  | 'MARK_NO_SHOW'
  | 'START_CONSULTATION'
  | 'COMPLETE_CONSULTATION'
  | 'TECHNICAL_FAILURE';

export interface AppointmentTransition {
  event: AppointmentEvent;
  from: AppointmentStatus;
  to: AppointmentStatus;
  /** null → internal/system event (payment webhook, expiry sweep, booking flow). */
  permission: Permission | null;
  /** Named guards the service must enforce before applying. */
  guards: readonly string[];
  sideEffects: readonly string[];
}

export const APPOINTMENT_TRANSITIONS: readonly AppointmentTransition[] = [
  {
    event: 'PAYMENT_COMPLETED',
    from: 'PENDING_PAYMENT',
    to: 'CONFIRMED',
    permission: null, // driven by the payment aggregator webhook (Phase 7: PaymentPort)
    guards: [],
    sideEffects: ['audit', 'set-confirmedAt', 'clear-expiresAt', 'mint-check-in-token-if-in-person'],
  },
  {
    event: 'INSURANCE_CONFIRMED',
    from: 'PENDING_PAYMENT',
    to: 'CONFIRMED',
    permission: null, // booking flow, when a verified PatientInsurance row matches
    guards: ['verified-insurance-on-file'],
    sideEffects: ['audit', 'set-confirmedAt', 'mint-check-in-token-if-in-person'],
  },
  {
    event: 'CASH_CONFIRMED',
    from: 'PENDING_PAYMENT',
    to: 'CONFIRMED',
    permission: null, // booking flow, CASH_AT_FACILITY (IN_PERSON only), settled at facility
    guards: ['in-person-only'],
    sideEffects: ['audit', 'set-confirmedAt', 'mint-check-in-token-if-in-person'],
  },
  {
    event: 'PAYMENT_TIMEOUT',
    from: 'PENDING_PAYMENT',
    to: 'CANCELLED',
    permission: null, // expiry sweep job
    guards: ['expiresAt-passed'],
    sideEffects: ['audit', 'set-cancellation-reason-PAYMENT_TIMEOUT'],
  },
  {
    event: 'PATIENT_CANCEL',
    from: 'PENDING_PAYMENT',
    to: 'CANCELLED',
    permission: 'appointment:cancel:own',
    guards: ['is-owner'],
    sideEffects: ['audit', 'record-cancellation'],
  },
  {
    event: 'PATIENT_CANCEL',
    from: 'CONFIRMED',
    to: 'CANCELLED',
    permission: 'appointment:cancel:own',
    guards: ['is-owner', 'at-least-2h-before-start'],
    sideEffects: ['audit', 'record-cancellation'],
  },
  {
    event: 'DOCTOR_CANCEL',
    from: 'PENDING_PAYMENT',
    to: 'CANCELLED',
    permission: 'appointment:manage:assigned', // mutation — never gated by a read permission
    guards: ['is-assigned-doctor', 'reason-required'],
    sideEffects: ['audit', 'record-cancellation', 'sms-patient'],
  },
  {
    event: 'DOCTOR_CANCEL',
    from: 'CONFIRMED',
    to: 'CANCELLED',
    permission: 'appointment:manage:assigned',
    guards: ['is-assigned-doctor', 'reason-required'], // any time, unlike patients
    sideEffects: ['audit', 'record-cancellation', 'sms-patient'],
  },
  {
    event: 'CHECK_IN',
    from: 'CONFIRMED',
    to: 'CHECKED_IN',
    permission: 'appointment:manage:assigned',
    guards: ['valid-check-in-token', 'is-assigned-doctor'],
    sideEffects: ['audit', 'set-checkedInAt'],
  },
  {
    event: 'MARK_NO_SHOW',
    from: 'CONFIRMED',
    to: 'NO_SHOW',
    permission: 'appointment:manage:assigned',
    guards: ['is-assigned-doctor', 'after-scheduledAt-plus-15min'],
    sideEffects: ['audit'],
  },
  {
    event: 'START_CONSULTATION',
    from: 'CHECKED_IN',
    to: 'IN_PROGRESS',
    permission: 'consultation:conduct',
    guards: ['is-assigned-doctor'],
    sideEffects: ['audit'],
  },
  {
    event: 'START_CONSULTATION',
    from: 'CONFIRMED',
    to: 'IN_PROGRESS',
    permission: 'consultation:conduct',
    guards: ['is-assigned-doctor', 'remote-consultation-only'],
    sideEffects: ['audit'],
  },
  {
    event: 'COMPLETE_CONSULTATION',
    from: 'IN_PROGRESS',
    to: 'COMPLETED',
    permission: 'consultation:conduct',
    guards: ['is-assigned-doctor'],
    sideEffects: ['audit'],
  },
  {
    event: 'TECHNICAL_FAILURE',
    from: 'IN_PROGRESS',
    to: 'CONFIRMED',
    permission: null, // consultation abort flow (either party or system)
    guards: ['once-only-per-appointment'], // technicalFailureAt must be unset
    sideEffects: ['audit', 'set-technicalFailureAt', 'mark-consultation-ABANDONED', 'end-video-room'],
  },
] as const;

/** The single lookup the service uses; undefined = illegal → 409. */
export function findAppointmentTransition(
  event: AppointmentEvent,
  from: AppointmentStatus,
): AppointmentTransition | undefined {
  return APPOINTMENT_TRANSITIONS.find(
    (transition) => transition.event === event && transition.from === from,
  );
}
