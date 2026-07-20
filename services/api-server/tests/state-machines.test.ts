import { describe, expect, it } from 'vitest';
import {
  APPOINTMENT_TRANSITIONS,
  findAppointmentTransition,
} from '../src/modules/appointments/appointment.machine.js';
import {
  VERIFICATION_TRANSITIONS,
  findVerificationTransition,
} from '../src/modules/doctors/verification.machine.js';

describe('doctor verification transition table', () => {
  it('contains every legal transition, each resolvable by (event, from)', () => {
    const expected: Array<[string, string, string]> = [
      ['DOCUMENTS_COMPLETE', 'PENDING', 'DOCUMENTS_SUBMITTED'],
      ['DOCUMENTS_COMPLETE', 'REJECTED', 'DOCUMENTS_SUBMITTED'],
      ['CLAIM', 'DOCUMENTS_SUBMITTED', 'UNDER_REVIEW'],
      ['APPROVE', 'UNDER_REVIEW', 'APPROVED'],
      ['REJECT', 'UNDER_REVIEW', 'REJECTED'],
      ['SUSPEND', 'APPROVED', 'SUSPENDED'],
    ];
    expect(VERIFICATION_TRANSITIONS).toHaveLength(expected.length);
    for (const [event, from, to] of expected) {
      const transition = findVerificationTransition(event as never, from as never);
      expect(transition, `${event} from ${from}`).toBeDefined();
      expect(transition!.to).toBe(to);
    }
  });

  it('admin actions require doctor:verify; automatic transitions carry no permission', () => {
    for (const transition of VERIFICATION_TRANSITIONS) {
      if (transition.event === 'DOCUMENTS_COMPLETE') {
        expect(transition.permission).toBeNull();
      } else {
        expect(transition.permission).toBe('doctor:verify');
      }
    }
  });

  it('rejects a sample of illegal transitions', () => {
    expect(findVerificationTransition('APPROVE', 'PENDING')).toBeUndefined();
    expect(findVerificationTransition('APPROVE', 'DOCUMENTS_SUBMITTED')).toBeUndefined(); // must claim first
    expect(findVerificationTransition('CLAIM', 'APPROVED')).toBeUndefined();
    expect(findVerificationTransition('SUSPEND', 'UNDER_REVIEW')).toBeUndefined();
    expect(findVerificationTransition('REJECT', 'APPROVED')).toBeUndefined();
    expect(findVerificationTransition('DOCUMENTS_COMPLETE', 'UNDER_REVIEW')).toBeUndefined();
  });
});

describe('appointment transition table', () => {
  it('contains every legal transition, each resolvable by (event, from)', () => {
    const expected: Array<[string, string, string]> = [
      ['PAYMENT_COMPLETED', 'PENDING_PAYMENT', 'CONFIRMED'],
      ['INSURANCE_CONFIRMED', 'PENDING_PAYMENT', 'CONFIRMED'],
      ['CASH_CONFIRMED', 'PENDING_PAYMENT', 'CONFIRMED'],
      ['PAYMENT_TIMEOUT', 'PENDING_PAYMENT', 'CANCELLED'],
      ['PATIENT_CANCEL', 'PENDING_PAYMENT', 'CANCELLED'],
      ['PATIENT_CANCEL', 'CONFIRMED', 'CANCELLED'],
      ['DOCTOR_CANCEL', 'PENDING_PAYMENT', 'CANCELLED'],
      ['DOCTOR_CANCEL', 'CONFIRMED', 'CANCELLED'],
      ['CHECK_IN', 'CONFIRMED', 'CHECKED_IN'],
      ['MARK_NO_SHOW', 'CONFIRMED', 'NO_SHOW'],
      ['START_CONSULTATION', 'CHECKED_IN', 'IN_PROGRESS'],
      ['START_CONSULTATION', 'CONFIRMED', 'IN_PROGRESS'],
      ['COMPLETE_CONSULTATION', 'IN_PROGRESS', 'COMPLETED'],
      ['TECHNICAL_FAILURE', 'IN_PROGRESS', 'CONFIRMED'],
    ];
    expect(APPOINTMENT_TRANSITIONS).toHaveLength(expected.length);
    for (const [event, from, to] of expected) {
      const transition = findAppointmentTransition(event as never, from as never);
      expect(transition, `${event} from ${from}`).toBeDefined();
      expect(transition!.to).toBe(to);
    }
  });

  it('rejects a sample of illegal transitions', () => {
    expect(findAppointmentTransition('PAYMENT_COMPLETED', 'CONFIRMED')).toBeUndefined();
    expect(findAppointmentTransition('PAYMENT_COMPLETED', 'CANCELLED')).toBeUndefined();
    expect(findAppointmentTransition('PATIENT_CANCEL', 'CHECKED_IN')).toBeUndefined();
    expect(findAppointmentTransition('PATIENT_CANCEL', 'COMPLETED')).toBeUndefined();
    expect(findAppointmentTransition('CHECK_IN', 'PENDING_PAYMENT')).toBeUndefined();
    expect(findAppointmentTransition('CHECK_IN', 'CHECKED_IN')).toBeUndefined(); // single use
    expect(findAppointmentTransition('MARK_NO_SHOW', 'CHECKED_IN')).toBeUndefined();
    expect(findAppointmentTransition('PAYMENT_TIMEOUT', 'CONFIRMED')).toBeUndefined();
    expect(findAppointmentTransition('COMPLETE_CONSULTATION', 'CONFIRMED')).toBeUndefined();
    expect(findAppointmentTransition('TECHNICAL_FAILURE', 'CONFIRMED')).toBeUndefined();
    expect(findAppointmentTransition('TECHNICAL_FAILURE', 'COMPLETED')).toBeUndefined();
  });

  it('terminal states have no outgoing transitions', () => {
    for (const terminal of ['CANCELLED', 'NO_SHOW', 'COMPLETED'] as const) {
      expect(
        APPOINTMENT_TRANSITIONS.filter((transition) => transition.from === terminal),
      ).toHaveLength(0);
    }
  });
});
