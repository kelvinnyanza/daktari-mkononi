import { createHmac } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { splitFee } from '@daktari/payments';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import { PaymentService } from '../src/modules/payments/payment.service.js';
import { AppointmentService } from '../src/modules/appointments/appointment.service.js';
import { ApiError } from '../src/lib/errors.js';

const NOW = new Date('2026-07-16T09:00:00.000Z');
const SLOT = new Date('2026-07-20T06:00:00.000Z');

let deps: FakeDeps;
let clock: { now: Date };
let payments: PaymentService;
let appointments: AppointmentService;

function makeServices() {
  payments = new PaymentService(
    {
      payments: deps.paymentsRepo,
      doctorPayments: deps.doctorPayments,
      appointments: deps.appointments,
      patients: deps.patients,
      doctors: deps.doctors,
      mobileMoney: deps.mobileMoney,
      sms: deps.sms,
      auditLogs: deps.auditLogs,
    },
    () => clock.now,
  );
  appointments = new AppointmentService({ ...deps, payments }, () => clock.now);
}

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
  makeServices();
});

/** Book a MOBILE_MONEY appointment (auto-initiates collection attempt 1). */
async function bookedMobileMoney(feeTzs = 25_000) {
  const { doctor, user: doctorUser } = deps.seedDoctor(
    {},
    { verificationStatus: 'APPROVED', consultationFeeTzs: feeTzs },
  );
  const { user, patient } = deps.seedPatient({ phone: '+255742345678' }); // Vodacom
  const booked = await appointments.book(user.id, {
    doctorId: doctor.id,
    type: 'VIDEO',
    scheduledAt: new Date(SLOT),
    reason: 'Homa ya siku tatu',
    paymentIntent: 'MOBILE_MONEY',
  });
  const payment = [...deps.state.paymentRows.values()][0]!;
  return { doctor, doctorUser, user, patient, booked, payment };
}

describe('initiation', () => {
  it('booking creates ONE Payment row with the integer fee split and starts collection', async () => {
    const { payment } = await bookedMobileMoney(25_001);
    const split = splitFee(25_001);
    expect(payment.amountTzs).toBe(25_001);
    expect(payment.platformFeeTzs).toBe(split.platformFeeTzs);
    expect(payment.doctorAmountTzs).toBe(split.doctorAmountTzs);
    expect(payment.platformFeeTzs + payment.doctorAmountTzs).toBe(25_001);
    expect(payment.method).toBe('MPESA'); // derived from the 074x prefix
    expect(payment.idempotencyKey).toBe(`${payment.appointmentId}:1`);
    expect(payment.status).toBe('PROCESSING');
    expect(deps.mobileMoney.collections).toHaveLength(1);
  });

  it('double-POST pay while PROCESSING returns the existing state — one collection call', async () => {
    const { user, booked } = await bookedMobileMoney();
    const first = await payments.payForAppointment(user.id, booked.id);
    const second = await payments.payForAppointment(user.id, booked.id);
    expect(first.status).toBe('PROCESSING');
    expect(second.status).toBe('PROCESSING');
    expect(second.attempt).toBe(1);
    expect(deps.mobileMoney.collections).toHaveLength(1); // booking's initiation only
  });

  it('after a FAILED payment a new attempt is allowed while still payable', async () => {
    const { user, booked, payment } = await bookedMobileMoney();
    await deps.paymentsRepo.transitionStatus(payment.id, ['PROCESSING'], {
      status: 'FAILED',
      failureReason: 'wallet declined',
    });

    const retried = await payments.payForAppointment(user.id, booked.id);
    expect(retried.status).toBe('PROCESSING');
    expect(retried.attempt).toBe(2);
    const row = deps.state.paymentRows.get(payment.id)!;
    expect(row.idempotencyKey).toBe(`${booked.id}:2`);
    expect(deps.mobileMoney.collections).toHaveLength(2);
  });

  it('rejects paying an expired or non-mobile-money appointment', async () => {
    const { user, booked } = await bookedMobileMoney();
    clock.now = new Date(NOW.getTime() + 31 * 60_000); // past the 30-min expiry
    await expectApiError(payments.payForAppointment(user.id, booked.id), 'APPOINTMENT_EXPIRED');

    const stranger = deps.seedPatient({ phone: '+255754999888' });
    clock.now = new Date(NOW);
    await expectApiError(
      payments.payForAppointment(stranger.user.id, booked.id),
      'APPOINTMENT_NOT_FOUND',
    );
  });
});

describe('webhook processing (service level)', () => {
  it('success → payment COMPLETED and appointment CONFIRMED; duplicate replay is a no-op', async () => {
    const { booked, payment } = await bookedMobileMoney();
    const reference = payment.idempotencyKey;

    const first = await payments.handleWebhook({
      transactionId: deps.mobileMoney.collections[0]!.providerReference,
      externalReference: reference,
      status: 'success',
    });
    expect(first.outcome).toBe('applied');
    expect(deps.state.paymentRows.get(payment.id)!.status).toBe('COMPLETED');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('CONFIRMED');
    expect(deps.state.appointments.get(booked.id)!.expiresAt).toBeNull();

    // Replay of the terminal event: no second transition, no second audit.
    const replay = await payments.handleWebhook({
      transactionId: deps.mobileMoney.collections[0]!.providerReference,
      externalReference: reference,
      status: 'success',
    });
    expect(replay.outcome).toBe('noop');
    expect(
      deps.state.auditEntries.filter((entry) => entry.action === 'PAYMENT_COMPLETED'),
    ).toHaveLength(1);
    expect(
      deps.state.auditEntries.filter(
        (entry) =>
          entry.action === 'APPOINTMENT_TRANSITION' &&
          JSON.stringify(entry.metadata).includes('PAYMENT_COMPLETED'),
      ),
    ).toHaveLength(1);
  });

  it('failure → payment FAILED with reason, appointment stays PENDING_PAYMENT', async () => {
    const { booked, payment } = await bookedMobileMoney();
    const result = await payments.handleWebhook({
      transactionId: deps.mobileMoney.collections[0]!.providerReference,
      externalReference: payment.idempotencyKey,
      status: 'failure',
      message: 'customer cancelled on handset',
    });
    expect(result.outcome).toBe('applied');
    const row = deps.state.paymentRows.get(payment.id)!;
    expect(row.status).toBe('FAILED');
    expect(row.failureReason).toBe('customer cancelled on handset');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('PENDING_PAYMENT');
  });

  it('unknown reference → audited, reported unknown (route answers 200)', async () => {
    const result = await payments.handleWebhook({
      transactionId: 'never-seen',
      externalReference: 'ghost:1',
      status: 'success',
    });
    expect(result.outcome).toBe('unknown-reference');
    expect(
      deps.state.auditEntries.some((entry) => entry.action === 'WEBHOOK_UNKNOWN_REFERENCE'),
    ).toBe(true);
  });
});

describe('reconciliation (shared code path with the webhook)', () => {
  it('PROCESSING + provider COMPLETED → identical outcome to the webhook', async () => {
    const { booked, payment } = await bookedMobileMoney();
    const reference = deps.mobileMoney.collections[0]!.providerReference;
    deps.mobileMoney.setProviderStatus(reference, 'COMPLETED');

    // The fake repo stamps updatedAt with the real clock, so age the cutoff
    // relative to real now.
    clock.now = new Date(Date.now() + 120_000); // older than the 90s cutoff
    expect(await payments.reconcilePendingPayments()).toBe(1);

    expect(deps.state.paymentRows.get(payment.id)!.status).toBe('COMPLETED');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('CONFIRMED');
    // Same audit action as the webhook path — the shared applyPaymentResult.
    const audit = deps.state.auditEntries.find((entry) => entry.action === 'PAYMENT_COMPLETED')!;
    expect(JSON.stringify(audit.metadata)).toContain('reconciliation');
  });

  it('provider still pending → untouched; younger than 90s → not even queried', async () => {
    const { payment } = await bookedMobileMoney();
    const reference = deps.mobileMoney.collections[0]!.providerReference;

    // Younger than 90s: not queried at all (updatedAt is real-clock stamped).
    clock.now = new Date(Date.now() + 30_000);
    expect(await payments.reconcilePendingPayments()).toBe(0);
    expect(deps.mobileMoney.statusQueries).toHaveLength(0);

    // Old enough but provider still pending: queried, left PROCESSING.
    clock.now = new Date(Date.now() + 120_000);
    expect(await payments.reconcilePendingPayments()).toBe(0);
    expect(deps.mobileMoney.statusQueries).toEqual([reference]);
    expect(deps.state.paymentRows.get(payment.id)!.status).toBe('PROCESSING');
  });
});

describe('refunds', () => {
  async function paidAppointment() {
    const context = await bookedMobileMoney();
    await payments.handleWebhook({
      transactionId: deps.mobileMoney.collections[0]!.providerReference,
      externalReference: context.payment.idempotencyKey,
      status: 'success',
    });
    return context;
  }

  it('doctor cancellation of a paid appointment → automatic full refund + SMS', async () => {
    const { doctorUser, user, booked, payment } = await paidAppointment();
    await appointments.cancelByDoctor(doctorUser.id, booked.id, 'emergency at the clinic');

    const row = deps.state.paymentRows.get(payment.id)!;
    expect(row.status).toBe('REFUNDED');
    expect(row.refundAmountTzs).toBe(row.amountTzs);
    expect(row.refundPending).toBe(false);
    expect(deps.mobileMoney.refunds).toHaveLength(1);
    expect(deps.mobileMoney.refunds[0]!.amountTzs).toBe(row.amountTzs);
    // Refund SMS precedes the cancellation notice — assert it was sent.
    const refundSms = deps.sms.sent.find((entry) => /yamerudishwa|refunded/.test(entry.body))!;
    expect(refundSms.to).toBe(user.phone);
  });

  it('patient cancellation ≥2h before start of a paid appointment → refund too', async () => {
    const { user, booked, payment } = await paidAppointment();
    clock.now = new Date(SLOT.getTime() - 3 * 60 * 60_000);
    await appointments.cancelByPatient(user.id, booked.id, 'safari ya ghafla');
    expect(deps.state.paymentRows.get(payment.id)!.status).toBe('REFUNDED');
  });

  it('refund failure → payment stays COMPLETED with refundPending; admin chase list shows it', async () => {
    const { doctorUser, booked, payment } = await paidAppointment();
    deps.mobileMoney.nextRefundThrows('PROVIDER_UNAVAILABLE');

    await appointments.cancelByDoctor(doctorUser.id, booked.id, 'double-booked');
    const row = deps.state.paymentRows.get(payment.id)!;
    expect(row.status).toBe('COMPLETED');
    expect(row.refundPending).toBe(true);
    expect(
      deps.state.auditEntries.some((entry) => entry.action === 'PAYMENT_REFUND_FAILED'),
    ).toBe(true);

    const pending = await payments.refundsPending();
    expect(pending.items.map((item) => item.id)).toEqual([payment.id]);
  });

  it('cancelling an UNPAID appointment never calls the provider', async () => {
    const { doctorUser, booked } = await bookedMobileMoney(); // still PROCESSING
    await appointments.cancelByDoctor(doctorUser.id, booked.id, 'schedule conflict');
    expect(deps.mobileMoney.refunds).toHaveLength(0);
  });
});

describe('doctor earnings accrual', () => {
  it('accrues exactly doctorAmountTzs once per consultation; replays are no-ops', async () => {
    const { doctor, booked, payment } = await bookedMobileMoney(25_001);
    await payments.handleWebhook({
      transactionId: deps.mobileMoney.collections[0]!.providerReference,
      externalReference: payment.idempotencyKey,
      status: 'success',
    });

    await payments.accrueForConsultation({
      appointmentId: booked.id,
      doctorId: doctor.id,
      consultationId: 'consult-1',
    });
    await payments.accrueForConsultation({
      appointmentId: booked.id,
      doctorId: doctor.id,
      consultationId: 'consult-1', // replay
    });

    const accruals = [...deps.state.doctorPaymentRows.values()];
    expect(accruals).toHaveLength(1);
    expect(accruals[0]!.amountTzs).toBe(splitFee(25_001).doctorAmountTzs);
    expect(accruals[0]!.status).toBe('PENDING'); // payout execution is a later phase
    expect(accruals[0]!.reference).toBe('consultation:consult-1');

    const earnings = await payments.doctorEarnings(
      deps.state.users.get(doctor.userId)!.id,
      { page: 1, pageSize: 10 },
    );
    expect(earnings.totalAmountTzs).toBe(splitFee(25_001).doctorAmountTzs);
  });

  it('unpaid (NHIF/cash) appointments do not accrue in this phase', async () => {
    const { doctor, booked } = await bookedMobileMoney(); // payment still PROCESSING
    await payments.accrueForConsultation({
      appointmentId: booked.id,
      doctorId: doctor.id,
      consultationId: 'consult-2',
    });
    expect(deps.state.doctorPaymentRows.size).toBe(0);
  });
});

describe('webhook route (signature + idempotency over HTTP)', () => {
  const secret = 'whsec-test-secret-value'; // matches applyTestEnv
  const sign = (raw: string): string => createHmac('sha256', secret).update(raw, 'utf8').digest('hex');

  async function appWithPaidSetup() {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ deps, redis: null, logger: false, now: () => clock.now });
    await app.ready();
    const context = await bookedMobileMoney();
    return { app, ...context };
  }

  it('bad signature → 401 + WEBHOOK_SIGNATURE_INVALID audit, no state change', async () => {
    const { app, payment } = await appWithPaidSetup();
    const body = JSON.stringify(
      deps.mobileMoney.webhookBodyFor(deps.mobileMoney.collections[0]!.providerReference, 'success'),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/azampay',
      headers: { 'content-type': 'application/json', 'x-azampay-signature': sign(`${body}tampered`) },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
    expect(deps.state.paymentRows.get(payment.id)!.status).toBe('PROCESSING'); // untouched
    expect(
      deps.state.auditEntries.some((entry) => entry.action === 'WEBHOOK_SIGNATURE_INVALID'),
    ).toBe(true);
    await app.close();
  });

  it('valid signature over the exact raw string succeeds; a single altered byte after signing → 401', async () => {
    const { app, booked } = await appWithPaidSetup();
    const body = JSON.stringify(
      deps.mobileMoney.webhookBodyFor(deps.mobileMoney.collections[0]!.providerReference, 'success'),
    );
    const signature = sign(body); // signed over the EXACT raw string

    // One byte of the body altered AFTER signing — must fail closed.
    const tampered = `${body.slice(0, -2)}X${body.slice(-1)}`;
    const rejected = await app.inject({
      method: 'POST',
      url: '/webhooks/azampay',
      headers: { 'content-type': 'application/json', 'x-azampay-signature': signature },
      payload: tampered,
    });
    expect(rejected.statusCode).toBe(401);
    expect(deps.state.appointments.get(booked.id)!.status).toBe('PENDING_PAYMENT'); // untouched

    // The untampered body with the same signature succeeds — proving the
    // handler verified the exact raw bytes that arrived, via the
    // route-scoped parseAs:'string' parser (production path, not a bypass).
    const accepted = await app.inject({
      method: 'POST',
      url: '/webhooks/azampay',
      headers: { 'content-type': 'application/json', 'x-azampay-signature': signature },
      payload: body,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().outcome).toBe('applied');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('CONFIRMED');
    await app.close();
  });

  it('malformed and schema-invalid bodies → 400 (after a valid signature)', async () => {
    const { app } = await appWithPaidSetup();
    const malformed = 'not-json{';
    const bad = await app.inject({
      method: 'POST',
      url: '/webhooks/azampay',
      headers: { 'content-type': 'application/json', 'x-azampay-signature': sign(malformed) },
      payload: malformed,
    });
    expect(bad.statusCode).toBe(400);

    const wrongShape = JSON.stringify({ hello: 'world' });
    const invalid = await app.inject({
      method: 'POST',
      url: '/webhooks/azampay',
      headers: { 'content-type': 'application/json', 'x-azampay-signature': sign(wrongShape) },
      payload: wrongShape,
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });

  it('success → CONFIRMED; duplicate delivery → 200 no-op; unknown reference → 200 audited', async () => {
    const { app, booked } = await appWithPaidSetup();
    const body = JSON.stringify(
      deps.mobileMoney.webhookBodyFor(deps.mobileMoney.collections[0]!.providerReference, 'success'),
    );
    const headers = { 'content-type': 'application/json', 'x-azampay-signature': sign(body) };

    const first = await app.inject({ method: 'POST', url: '/webhooks/azampay', headers, payload: body });
    expect(first.statusCode).toBe(200);
    expect(first.json().outcome).toBe('applied');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('CONFIRMED');

    // Duplicate delivery of the same terminal event.
    const duplicate = await app.inject({ method: 'POST', url: '/webhooks/azampay', headers, payload: body });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().outcome).toBe('noop');

    // Unknown reference: 200, never 404 — don't teach the provider to retry.
    const unknown = JSON.stringify({
      transactionId: 'ghost-tx',
      externalReference: 'ghost:1',
      status: 'success',
      amount: 1000,
      currency: 'TZS',
    });
    const unknownResponse = await app.inject({
      method: 'POST',
      url: '/webhooks/azampay',
      headers: { 'content-type': 'application/json', 'x-azampay-signature': sign(unknown) },
      payload: unknown,
    });
    expect(unknownResponse.statusCode).toBe(200);
    expect(unknownResponse.json().outcome).toBe('unknown-reference');
    await app.close();
  });
});
