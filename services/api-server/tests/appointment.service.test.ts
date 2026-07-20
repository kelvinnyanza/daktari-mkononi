import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import { AppointmentService, PAYMENT_EXPIRY_MS } from '../src/modules/appointments/appointment.service.js';
import { ApiError } from '../src/lib/errors.js';

let deps: FakeDeps;
let clock: { now: Date };
let service: AppointmentService;

// Clock: Thursday 2026-07-16 09:00 UTC (12:00 EAT).
const NOW = new Date('2026-07-16T09:00:00.000Z');
// Booking target: Monday 2026-07-20 09:00 EAT = 06:00 UTC.
const SLOT = new Date('2026-07-20T06:00:00.000Z');

async function expectApiError(promise: Promise<unknown>, code: string): Promise<ApiError> {
  const error = await promise.then(
    () => {
      throw new Error(`expected ApiError ${code}, but the call succeeded`);
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe(code);
  return error as ApiError;
}

beforeAll(() => {
  applyTestEnv();
});

beforeEach(() => {
  deps = makeFakeDeps();
  clock = { now: new Date(NOW) };
  service = new AppointmentService(deps, () => clock.now);
});

function seedApprovedDoctor() {
  return deps.seedDoctor({}, { verificationStatus: 'APPROVED', consultationFeeTzs: 25_000 });
}

const booking = (doctorId: string, overrides: Record<string, unknown> = {}) => ({
  doctorId,
  type: 'VIDEO' as const,
  scheduledAt: new Date(SLOT),
  reason: 'Maumivu ya kichwa',
  paymentIntent: 'MOBILE_MONEY' as const,
  ...overrides,
});

describe('booking payment intents', () => {
  it('MOBILE_MONEY: PENDING_PAYMENT with a 30-minute expiry and an initiated payment', async () => {
    const { doctor } = seedApprovedDoctor();
    const { user } = deps.seedPatient();
    const result = await service.book(user.id, booking(doctor.id));

    expect(result.status).toBe('PENDING_PAYMENT');
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + PAYMENT_EXPIRY_MS));
    expect(deps.payments.initiated).toHaveLength(1);
    expect(deps.payments.initiated[0]!.amountTzs).toBe(25_000);
    expect(deps.payments.initiated[0]!.payerPhone).toBe(user.phone);
  });

  it('payment-completed event confirms the booking (webhook path), idempotently', async () => {
    const { doctor } = seedApprovedDoctor();
    const { user } = deps.seedPatient();
    const booked = await service.book(user.id, booking(doctor.id));

    const confirmed = await service.handlePaymentCompleted(booked.id);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.expiresAt).toBeNull();

    // Replay is a no-op, not an error (webhooks retry).
    const replay = await service.handlePaymentCompleted(booked.id);
    expect(replay.status).toBe('CONFIRMED');
  });

  it('NHIF with a verified insurance row confirms immediately', async () => {
    const { doctor } = seedApprovedDoctor();
    const { user, patient } = deps.seedPatient();
    deps.seedInsurance(patient.id, { provider: 'NHIF', verifiedAt: new Date('2026-01-01') });

    const result = await service.book(user.id, booking(doctor.id, { paymentIntent: 'NHIF' }));
    expect(result.status).toBe('CONFIRMED');
    expect(result.pendingReason).toBeNull();
  });

  it('NHIF without verified insurance stays PENDING_PAYMENT with INSURANCE_UNVERIFIED', async () => {
    const { doctor } = seedApprovedDoctor();
    const { user, patient } = deps.seedPatient();
    deps.seedInsurance(patient.id, { provider: 'NHIF', verifiedAt: null }); // on file but unverified

    const result = await service.book(user.id, booking(doctor.id, { paymentIntent: 'NHIF' }));
    expect(result.status).toBe('PENDING_PAYMENT');
    expect(result.pendingReason).toBe('INSURANCE_UNVERIFIED');
    expect(result.expiresAt).toBeNull(); // no payment timeout for insurance-pending
  });

  it('an expired NHIF card does not confirm', async () => {
    const { doctor } = seedApprovedDoctor();
    const { user, patient } = deps.seedPatient();
    deps.seedInsurance(patient.id, {
      provider: 'NHIF',
      verifiedAt: new Date('2025-01-01'),
      validUntil: new Date('2026-01-01'), // lapsed before NOW
    });
    const result = await service.book(user.id, booking(doctor.id, { paymentIntent: 'NHIF' }));
    expect(result.status).toBe('PENDING_PAYMENT');
    expect(result.pendingReason).toBe('INSURANCE_UNVERIFIED');
  });

  it('CASH_AT_FACILITY confirms immediately for IN_PERSON and mints a check-in token', async () => {
    const { doctor } = seedApprovedDoctor();
    const { user } = deps.seedPatient();
    const result = await service.book(
      user.id,
      booking(doctor.id, { paymentIntent: 'CASH_AT_FACILITY', type: 'IN_PERSON' }),
    );
    expect(result.status).toBe('CONFIRMED');
    expect(result.checkInToken).toBeTruthy();
  });

  it('CASH_AT_FACILITY is rejected for remote appointment types', async () => {
    const { doctor } = seedApprovedDoctor();
    const { user } = deps.seedPatient();
    await expectApiError(
      service.book(user.id, booking(doctor.id, { paymentIntent: 'CASH_AT_FACILITY', type: 'VIDEO' })),
      'CASH_REQUIRES_IN_PERSON',
    );
  });

  it('booking a suspended or unknown doctor is 404', async () => {
    const { user } = deps.seedPatient();
    const { doctor } = deps.seedDoctor({}, { verificationStatus: 'SUSPENDED' });
    await expectApiError(service.book(user.id, booking(doctor.id)), 'DOCTOR_NOT_FOUND');
    await expectApiError(service.book(user.id, booking('c0000000000000000000nope')), 'DOCTOR_NOT_FOUND');
  });

  it('double-booking the same slot answers 409 SLOT_TAKEN (DB is the arbiter)', async () => {
    const { doctor } = seedApprovedDoctor();
    const alice = deps.seedPatient({ phone: '+255754000010' });
    const bob = deps.seedPatient({ phone: '+255754000011' });

    await service.book(alice.user.id, booking(doctor.id));
    await expectApiError(service.book(bob.user.id, booking(doctor.id)), 'SLOT_TAKEN');
  });

  it('a CANCELLED appointment frees the slot for rebooking', async () => {
    const { doctor } = seedApprovedDoctor();
    const alice = deps.seedPatient({ phone: '+255754000010' });
    const bob = deps.seedPatient({ phone: '+255754000011' });

    const first = await service.book(alice.user.id, booking(doctor.id));
    await service.cancelByPatient(alice.user.id, first.id, 'nimebadilisha mawazo');
    const second = await service.book(bob.user.id, booking(doctor.id));
    expect(second.status).toBe('PENDING_PAYMENT');
  });
});

describe('expiry sweep (clock-injected, no real timers)', () => {
  it('cancels stale unpaid MOBILE_MONEY bookings with reason PAYMENT_TIMEOUT', async () => {
    const { doctor } = seedApprovedDoctor();
    const { user } = deps.seedPatient();
    const booked = await service.book(user.id, booking(doctor.id));

    clock.now = new Date(NOW.getTime() + PAYMENT_EXPIRY_MS - 1000);
    expect(await service.expireStalePayments()).toBe(0); // not stale yet

    clock.now = new Date(NOW.getTime() + PAYMENT_EXPIRY_MS + 1000);
    expect(await service.expireStalePayments()).toBe(1);

    const appointment = deps.state.appointments.get(booked.id)!;
    expect(appointment.status).toBe('CANCELLED');
    expect(appointment.cancellationReason).toBe('PAYMENT_TIMEOUT');

    // A late payment completion on the expired booking is now illegal.
    await expectApiError(service.handlePaymentCompleted(booked.id), 'INVALID_STATE_TRANSITION');
  });

  it('does not touch confirmed or insurance-pending bookings', async () => {
    const { doctor } = seedApprovedDoctor();
    const { user, patient } = deps.seedPatient();
    deps.seedInsurance(patient.id, { provider: 'NHIF', verifiedAt: null });
    await service.book(user.id, booking(doctor.id, { paymentIntent: 'NHIF' })); // INSURANCE_UNVERIFIED

    clock.now = new Date(NOW.getTime() + 10 * PAYMENT_EXPIRY_MS);
    expect(await service.expireStalePayments()).toBe(0);
  });
});

describe('cancellation, check-in, no-show', () => {
  async function confirmedInPerson() {
    const { doctor, user: doctorUser } = seedApprovedDoctor();
    const { user, patient } = deps.seedPatient();
    const booked = await service.book(
      user.id,
      booking(doctor.id, { paymentIntent: 'CASH_AT_FACILITY', type: 'IN_PERSON' }),
    );
    return { doctor, doctorUser, user, patient, booked };
  }

  it('patient can cancel ≥ 2h before the start; window enforced at exactly < 2h', async () => {
    const { user, booked } = await confirmedInPerson();
    // 2h+1min before start — allowed.
    clock.now = new Date(SLOT.getTime() - 2 * 60 * 60_000 - 60_000);
    const cancelled = await service.cancelByPatient(user.id, booked.id, 'safari ya ghafla');
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('patient cancellation inside the 2h window → 409 CANCELLATION_WINDOW_PASSED', async () => {
    const { user, booked } = await confirmedInPerson();
    clock.now = new Date(SLOT.getTime() - 60 * 60_000); // 1h before
    await expectApiError(
      service.cancelByPatient(user.id, booked.id, 'nimechelewa'),
      'CANCELLATION_WINDOW_PASSED',
    );
  });

  it('a patient cannot cancel another patient’s appointment (404, no enumeration)', async () => {
    const { booked } = await confirmedInPerson();
    const intruder = deps.seedPatient({ phone: '+255754999888' });
    await expectApiError(
      service.cancelByPatient(intruder.user.id, booked.id, 'mine now'),
      'APPOINTMENT_NOT_FOUND',
    );
  });

  it('doctor can cancel any time with a reason; the patient is notified by SMS', async () => {
    const { doctorUser, user, booked } = await confirmedInPerson();
    clock.now = new Date(SLOT.getTime() - 10 * 60_000); // 10 min before — fine for doctors
    const cancelled = await service.cancelByDoctor(doctorUser.id, booked.id, 'emergency surgery');
    expect(cancelled.status).toBe('CANCELLED');
    const lastSms = deps.sms.sent.at(-1)!;
    expect(lastSms.to).toBe(user.phone);
    expect(lastSms.body).toMatch(/imeghairiwa|cancelled/);
  });

  it('a different doctor cannot cancel or no-show someone else’s appointment', async () => {
    const { booked } = await confirmedInPerson();
    const other = deps.seedDoctor({}, { verificationStatus: 'APPROVED' });
    await expectApiError(
      service.cancelByDoctor(other.user.id, booked.id, 'not my patient'),
      'APPOINTMENT_NOT_FOUND',
    );
    clock.now = new Date(SLOT.getTime() + 20 * 60_000);
    await expectApiError(service.markNoShow(other.user.id, booked.id), 'APPOINTMENT_NOT_FOUND');
  });

  it('check-in via token: CONFIRMED → CHECKED_IN, single use', async () => {
    const { doctorUser, booked } = await confirmedInPerson();
    const checkedIn = await service.checkIn(doctorUser.id, booked.checkInToken!);
    expect(checkedIn.status).toBe('CHECKED_IN');

    // Second use: state is CHECKED_IN, transition is illegal.
    await expectApiError(
      service.checkIn(doctorUser.id, booked.checkInToken!),
      'INVALID_STATE_TRANSITION',
    );
  });

  it('the assigned doctor’s token in another doctor’s hands is rejected', async () => {
    const { booked } = await confirmedInPerson();
    const other = deps.seedDoctor({}, { verificationStatus: 'APPROVED' });
    await expectApiError(
      service.checkIn(other.user.id, booked.checkInToken!),
      'INVALID_CHECK_IN_TOKEN',
    );
  });

  it('no-show requires scheduledAt + 15 min to have passed', async () => {
    const { doctorUser, booked } = await confirmedInPerson();
    clock.now = new Date(SLOT.getTime() + 14 * 60_000);
    await expectApiError(service.markNoShow(doctorUser.id, booked.id), 'NO_SHOW_TOO_EARLY');

    clock.now = new Date(SLOT.getTime() + 16 * 60_000);
    const marked = await service.markNoShow(doctorUser.id, booked.id);
    expect(marked.status).toBe('NO_SHOW');
  });

  it('cancelling an already CANCELLED appointment is an illegal transition', async () => {
    const { user, booked } = await confirmedInPerson();
    clock.now = new Date(SLOT.getTime() - 3 * 60 * 60_000);
    await service.cancelByPatient(user.id, booked.id, 'first');
    await expectApiError(
      service.cancelByPatient(user.id, booked.id, 'second'),
      'INVALID_STATE_TRANSITION',
    );
  });
});

describe('reschedule (atomic cancel + rebook, same payment linkage)', () => {
  it('moves a confirmed booking to a new slot with a fresh check-in token', async () => {
    const { doctor } = seedApprovedDoctor();
    const { user } = deps.seedPatient();
    const booked = await service.book(
      user.id,
      booking(doctor.id, { paymentIntent: 'CASH_AT_FACILITY', type: 'IN_PERSON' }),
    );

    const newSlot = new Date('2026-07-21T06:00:00.000Z');
    const moved = await service.reschedule(user.id, booked.id, { scheduledAt: newSlot });

    expect(moved.id).not.toBe(booked.id);
    expect(moved.status).toBe('CONFIRMED'); // payment state carries over
    expect(moved.scheduledAt).toEqual(newSlot);
    expect(moved.checkInToken).toBeTruthy();
    expect(moved.checkInToken).not.toBe(booked.checkInToken);

    const old = deps.state.appointments.get(booked.id)!;
    expect(old.status).toBe('CANCELLED');
    expect(old.cancellationReason).toBe('RESCHEDULED');
  });

  it('rescheduling onto a taken slot fails with SLOT_TAKEN and leaves the original untouched', async () => {
    const { doctor } = seedApprovedDoctor();
    const alice = deps.seedPatient({ phone: '+255754000010' });
    const bob = deps.seedPatient({ phone: '+255754000011' });

    const target = new Date('2026-07-21T06:00:00.000Z');
    await service.book(bob.user.id, booking(doctor.id, { scheduledAt: target }));
    const mine = await service.book(alice.user.id, booking(doctor.id));

    await expectApiError(
      service.reschedule(alice.user.id, mine.id, { scheduledAt: target }),
      'SLOT_TAKEN',
    );
    expect(deps.state.appointments.get(mine.id)!.status).toBe('PENDING_PAYMENT'); // rolled back
  });
});

describe('views', () => {
  it('patient list is paginated and scoped to the caller; doctor day view scoped to the doctor', async () => {
    const { doctor, user: doctorUser } = seedApprovedDoctor();
    const { user } = deps.seedPatient();
    const other = deps.seedPatient({ phone: '+255754999777' });

    await service.book(user.id, booking(doctor.id));
    await service.book(
      other.user.id,
      booking(doctor.id, { scheduledAt: new Date('2026-07-20T06:30:00.000Z') }),
    );

    const mine = await service.listMine(user.id, { page: 1, pageSize: 10 });
    expect(mine.total).toBe(1); // never the other patient's booking

    const day = await service.doctorDay(doctorUser.id, { page: 1, pageSize: 10, date: '2026-07-20' });
    expect(day.total).toBe(2);
    expect(day.items[0]!).not.toHaveProperty('checkInToken'); // doctor view hides tokens

    const emptyDay = await service.doctorDay(doctorUser.id, { page: 1, pageSize: 10, date: '2026-07-21' });
    expect(emptyDay.total).toBe(0);
  });
});
