import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FEE_RATES, calculateFees } from '@daktari/payments';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import { PaymentService } from '../src/modules/payments/payment.service.js';
import { FeeSettingsService } from '../src/modules/payments/fee-settings.service.js';
import { AppointmentService } from '../src/modules/appointments/appointment.service.js';
import { ApiError } from '../src/lib/errors.js';

const NOW = new Date('2026-07-16T09:00:00.000Z');
const SLOT = new Date('2026-07-20T06:00:00.000Z');

let deps: FakeDeps;
let clock: { now: Date };
let payments: PaymentService;
let fees: FeeSettingsService;
let appointments: AppointmentService;

function makeServices() {
  fees = new FeeSettingsService(
    { feeSettings: deps.feeSettings, doctors: deps.doctors, auditLogs: deps.auditLogs },
    () => clock.now,
  );
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
      fees,
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

/**
 * A validly SIGNED AzamPay checkout callback (old-style arguments kept so the
 * scenarios read as before): utilityref = our key, externalreference =
 * AzamPay's id. The fake's status API still says PENDING unless a test sets
 * it, so the signed callback is what gets applied.
 */
function signedCallback(input: {
  transactionId: string;
  externalReference: string;
  status: 'success' | 'failure';
  amount?: number;
  message?: string;
}) {
  return payments.handleCheckoutCallback(
    {
      utilityref: input.externalReference,
      externalreference: input.transactionId,
      transactionstatus: input.status,
      operator: 'Mpesa',
      ...(input.amount !== undefined ? { amount: String(input.amount) } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
    },
    'valid',
  );
}

describe('initiation', () => {
  it('booking creates ONE Payment row with the integer fee split and starts collection', async () => {
    const { payment } = await bookedMobileMoney(25_001);
    const split = calculateFees(25_001, DEFAULT_FEE_RATES);
    expect(payment.amountTzs).toBe(25_001);
    expect(payment.platformFeeTzs).toBe(split.platformCommissionTzs);
    expect(payment.vatTzs).toBe(split.vatTzs);
    expect(payment.doctorAmountTzs).toBe(split.doctorAmountTzs);
    expect(payment.platformFeeTzs + payment.vatTzs + payment.doctorAmountTzs).toBe(25_001);
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

    const first = await signedCallback({
      transactionId: deps.mobileMoney.collections[0]!.providerReference,
      externalReference: reference,
      status: 'success',
    });
    expect(first.outcome).toBe('applied');
    expect(deps.state.paymentRows.get(payment.id)!.status).toBe('COMPLETED');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('CONFIRMED');
    expect(deps.state.appointments.get(booked.id)!.expiresAt).toBeNull();

    // Replay of the terminal event: no second transition, no second audit.
    const replay = await signedCallback({
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
    const result = await signedCallback({
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
    const result = await signedCallback({
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

    // The fake repo stamps updatedAt with the real clock: back-date the row
    // (older than the 90s cutoff) instead of moving the injected clock past
    // the booking's payment window, which would make this a late success.
    const row = deps.state.paymentRows.get(payment.id)!;
    deps.state.paymentRows.set(payment.id, { ...row, updatedAt: new Date(NOW.getTime() - 120_000) });
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
    await signedCallback({
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
    await signedCallback({
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
    expect(accruals[0]!.amountTzs).toBe(calculateFees(25_001, DEFAULT_FEE_RATES).doctorAmountTzs);
    expect(accruals[0]!.status).toBe('PENDING'); // payout execution is a later phase
    expect(accruals[0]!.reference).toBe('consultation:consult-1');

    const earnings = await payments.doctorEarnings(
      deps.state.users.get(doctor.userId)!.id,
      { page: 1, pageSize: 10 },
    );
    expect(earnings.totalAmountTzs).toBe(calculateFees(25_001, DEFAULT_FEE_RATES).doctorAmountTzs);
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

describe('webhook route (AzamPay RSA signature + status confirmation over HTTP)', () => {
  async function appWithPaidSetup() {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ deps, redis: null, logger: false, now: () => clock.now });
    await app.ready();
    const context = await bookedMobileMoney();
    return { app, ...context, reference: deps.mobileMoney.collections[0]!.providerReference };
  }
  const post = (app: Awaited<ReturnType<typeof appWithPaidSetup>>['app'], payload: string) =>
    app.inject({ method: 'POST', url: '/webhooks/azampay', headers: { 'content-type': 'application/json' }, payload });

  it('invalid signature (status flipped after signing) → 401 + WEBHOOK_SIGNATURE_INVALID audit, no state change', async () => {
    const { app, payment, reference } = await appWithPaidSetup();
    const signedFailure = deps.mobileMoney.webhookBodyFor(reference, 'failure');
    const forged = JSON.stringify({ ...signedFailure, transactionstatus: 'success' });
    const response = await post(app, forged);
    expect(response.statusCode).toBe(401);
    expect(deps.state.paymentRows.get(payment.id)!.status).toBe('PROCESSING'); // untouched
    expect(deps.state.auditEntries.some((entry) => entry.action === 'WEBHOOK_SIGNATURE_INVALID')).toBe(true);
    await app.close();
  });

  it('validly signed success → CONFIRMED; duplicate delivery → 200 no-op; credentials in the body are never stored', async () => {
    const { app, booked, reference } = await appWithPaidSetup();
    const body = JSON.stringify(deps.mobileMoney.webhookBodyFor(reference, 'success'));
    const first = await post(app, body);
    expect(first.statusCode).toBe(200);
    expect(first.json().outcome).toBe('applied');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('CONFIRMED');
    expect(deps.mobileMoney.statusQueries).toContain(reference); // confirmed with AzamPay first

    const duplicate = await post(app, body);
    expect(duplicate.json().outcome).toBe('noop');
    expect(JSON.stringify(deps.state.auditEntries)).not.toContain('merchant_password');
    await app.close();
  });

  it('no checkout status API (NOT_SUPPORTED): a validly signed callback applies alone, an unsigned one defers', async () => {
    const { app, booked, reference } = await appWithPaidSetup();
    deps.mobileMoney.checkoutStatusUnsupported = true;
    const unsigned = JSON.stringify(deps.mobileMoney.webhookBodyFor(reference, 'success', { signature: null }));
    expect((await post(app, unsigned)).json().outcome).toBe('deferred');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('PENDING_PAYMENT');
    const signed = JSON.stringify(deps.mobileMoney.webhookBodyFor(reference, 'success'));
    expect((await post(app, signed)).json().outcome).toBe('applied');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('CONFIRMED');
    // The webhook's status query is the fast, single-attempt kind.
    expect(deps.mobileMoney.statusHints.every((hint) => hint?.fast === true)).toBe(true);
    await app.close();
  });

  it('UNSIGNED callback is never applied on its own: deferred while the status API says pending', async () => {
    const { app, booked, reference } = await appWithPaidSetup();
    const unsigned = JSON.stringify(deps.mobileMoney.webhookBodyFor(reference, 'success', { signature: null }));
    const response = await post(app, unsigned);
    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe('deferred');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('PENDING_PAYMENT');
    await app.close();
  });

  it('UNSIGNED callback + status API says COMPLETED → applied from the STATUS answer', async () => {
    const { app, booked, reference } = await appWithPaidSetup();
    deps.mobileMoney.setProviderStatus(reference, 'COMPLETED', undefined, { amountTzs: 25_000 });
    const unsigned = JSON.stringify(deps.mobileMoney.webhookBodyFor(reference, 'success', { signature: null }));
    expect((await post(app, unsigned)).json().outcome).toBe('applied');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('CONFIRMED');
    await app.close();
  });

  it('signed callback that the status API contradicts → nothing applied, STATUS_CONFLICT for an admin', async () => {
    const { app, booked, payment, reference } = await appWithPaidSetup();
    deps.mobileMoney.setProviderStatus(reference, 'FAILED', 'declined');
    const body = JSON.stringify(deps.mobileMoney.webhookBodyFor(reference, 'success'));
    expect((await post(app, body)).json().outcome).toBe('conflict');
    const row = deps.state.paymentRows.get(payment.id)!;
    expect(row.status).toBe('PROCESSING');
    expect(row.reviewReason).toBe('STATUS_CONFLICT');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('PENDING_PAYMENT');
    await app.close();
  });

  it('refs-only signature (the docs’ other wording) is treated as unsigned; unverifiable key too', async () => {
    const { app, booked, payment, reference } = await appWithPaidSetup();
    const refsOnly = deps.mobileMoney.sign(`${payment.idempotencyKey}${reference}`);
    const body = JSON.stringify(deps.mobileMoney.webhookBodyFor(reference, 'success', { signature: refsOnly }));
    expect((await post(app, body)).json().outcome).toBe('deferred');
    deps.mobileMoney.publicKeyUnavailable = true;
    const signed = JSON.stringify(deps.mobileMoney.webhookBodyFor(reference, 'success'));
    expect((await post(app, signed)).json().outcome).toBe('deferred');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('PENDING_PAYMENT');
    await app.close();
  });

  it('callback amount ≠ owed → AMOUNT_MISMATCH, not confirmed', async () => {
    const { app, booked, payment, reference } = await appWithPaidSetup();
    const body = JSON.stringify(deps.mobileMoney.webhookBodyFor(reference, 'success', { amount: '2500' }));
    await post(app, body);
    expect(deps.state.paymentRows.get(payment.id)!.reviewReason).toBe('AMOUNT_MISMATCH');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('PENDING_PAYMENT');
    await app.close();
  });

  it('malformed and schema-invalid bodies → 400; unknown reference → 200 audited', async () => {
    const { app } = await appWithPaidSetup();
    expect((await post(app, '{not json')).statusCode).toBe(400);
    expect((await post(app, JSON.stringify({ hello: 'world' }))).statusCode).toBe(400);
    const ghost = JSON.stringify({
      utilityref: 'ghost-appointment:1',
      externalreference: 'ghost-pg',
      transactionstatus: 'success',
      operator: 'Tigo',
      amount: '1000',
    });
    const unknown = await post(app, ghost);
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json().outcome).toBe('unknown-reference');
    expect(deps.state.auditEntries.some((entry) => entry.action === 'WEBHOOK_UNKNOWN_REFERENCE')).toBe(true);
    await app.close();
  });

  it('a superseded attempt reporting success is flagged STRAY_ATTEMPT on the current payment', async () => {
    const { app, user, booked, payment, reference } = await appWithPaidSetup();
    const attempt1 = deps.mobileMoney.webhookBodyFor(reference, 'success'); // built while attempt 1 is current
    await deps.paymentsRepo.transitionStatus(payment.id, ['PROCESSING'], { status: 'FAILED', failureReason: 'x' });
    await payments.payForAppointment(user.id, booked.id); // attempt 2 → key :2
    const response = await post(app, JSON.stringify(attempt1));
    expect(response.json().outcome).toBe('stray-attempt');
    expect(deps.state.paymentRows.get(payment.id)!.reviewReason).toBe('STRAY_ATTEMPT');
    await app.close();
  });

  it('disbursement callbacks are never trusted: they only trigger a refund status check', async () => {
    const { app, payment, reference } = await appWithPaidSetup();
    await post(app, JSON.stringify(deps.mobileMoney.webhookBodyFor(reference, 'success')));
    deps.mobileMoney.nextRefund('pending');
    await payments.refundIfPaid(payment.appointmentId!, 'complaint');
    const row = deps.state.paymentRows.get(payment.id)!;
    expect(row.refundState).toBe('PROCESSING');

    // The callback body CLAIMS success; the status API still says pending → nothing changes.
    const claim = JSON.stringify({ pgReferenceId: row.refundReference, status: 'success', amount: '25000' });
    expect((await post(app, claim)).json().outcome).toBe('pending');
    expect(deps.state.paymentRows.get(payment.id)!.status).toBe('COMPLETED');

    deps.mobileMoney.setProviderStatus(row.refundReference!, 'COMPLETED');
    expect((await post(app, claim)).json().outcome).toBe('applied');
    expect(deps.state.paymentRows.get(payment.id)!.status).toBe('REFUNDED');
    await app.close();
  });
});

describe('late / orphan payments (Phase 13a)', () => {
  const successFor = (payment: { idempotencyKey: string }) => ({
    transactionId: deps.mobileMoney.collections[0]!.providerReference,
    externalReference: payment.idempotencyKey,
    status: 'success' as const,
  });

  it('success after the expiry sweep cancelled the booking → no confirmation, flagged, refunded, patient told', async () => {
    const { user, booked, payment } = await bookedMobileMoney(15_000);
    clock.now = new Date(NOW.getTime() + 31 * 60_000);
    expect(await appointments.expireStalePayments()).toBe(1);
    expect(deps.state.paymentRows.get(payment.id)!.abandonedAt).not.toBeNull();
    expect(deps.state.paymentRows.get(payment.id)!.status).toBe('PROCESSING'); // never closed blind

    const result = await signedCallback(successFor(payment));
    expect(result.outcome).toBe('applied');

    expect(deps.state.appointments.get(booked.id)!.status).toBe('CANCELLED');
    const row = deps.state.paymentRows.get(payment.id)!;
    expect(row.reviewReason).toBe('LATE_SUCCESS');
    expect(row.reviewNote).toBe('APPOINTMENT_CANCELLED');
    expect(row.status).toBe('REFUNDED');
    expect(row.refundAmountTzs).toBe(15_000);
    expect(deps.mobileMoney.refunds).toHaveLength(1);
    const texts = deps.sms.sent.filter((entry) => entry.to === user.phone).map((entry) => entry.body);
    expect(texts.some((body) => body.includes('baada ya miadi kuisha'))).toBe(true);
    expect(texts.some((body) => body.includes('yamerudishwa'))).toBe(true);
    const actions = deps.state.auditEntries.map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining(['PAYMENT_ABANDONED', 'PAYMENT_REVIEW_FLAGGED', 'PAYMENT_REFUNDED']),
    );
    // The admin alert queue lists it until an admin resolves it.
    expect((await payments.reviewQueue()).items.map((item) => item.id)).toEqual([payment.id]);
  });

  it('success after expiresAt but BEFORE the sweep ran still never confirms', async () => {
    const { booked, payment } = await bookedMobileMoney();
    clock.now = new Date(NOW.getTime() + 31 * 60_000); // window over, sweep not yet run
    await signedCallback(successFor(payment));
    expect(deps.state.appointments.get(booked.id)!.status).toBe('PENDING_PAYMENT');
    const row = deps.state.paymentRows.get(payment.id)!;
    expect(row.reviewNote).toBe('APPOINTMENT_EXPIRED');
    expect(row.status).toBe('REFUNDED');
  });

  it('patient cancels an unpaid booking → reconciliation keeps checking; late success → refund', async () => {
    const { user, booked, payment } = await bookedMobileMoney();
    await appointments.cancelByPatient(user.id, booked.id, 'nimebadili mawazo');
    expect(deps.state.paymentRows.get(payment.id)!.abandonedAt).not.toBeNull();

    deps.mobileMoney.setProviderStatus(deps.mobileMoney.collections[0]!.providerReference, 'COMPLETED');
    clock.now = new Date(Date.now() + 120_000);
    expect(await payments.reconcilePendingPayments()).toBe(1);
    const row = deps.state.paymentRows.get(payment.id)!;
    expect(row.reviewReason).toBe('LATE_SUCCESS');
    expect(row.status).toBe('REFUNDED');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('CANCELLED');
  });

  it('abandoned payment that finally FAILS is just failed — nothing to refund', async () => {
    const { user, booked, payment } = await bookedMobileMoney();
    await appointments.cancelByPatient(user.id, booked.id, 'sitaki tena');
    deps.mobileMoney.setProviderStatus(deps.mobileMoney.collections[0]!.providerReference, 'FAILED', 'timeout');
    clock.now = new Date(Date.now() + 120_000);
    await payments.reconcilePendingPayments();
    const row = deps.state.paymentRows.get(payment.id)!;
    expect(row.status).toBe('FAILED');
    expect(row.reviewReason).toBeNull();
    expect(deps.mobileMoney.refunds).toHaveLength(0);
  });

  it('abandoned and still not final after 24h → flagged STUCK_PROCESSING once', async () => {
    const { user, booked, payment } = await bookedMobileMoney();
    await appointments.cancelByPatient(user.id, booked.id, 'nimebadili mawazo');
    clock.now = new Date(Date.now() + 25 * 60 * 60_000);
    await payments.reconcilePendingPayments();
    await payments.reconcilePendingPayments();
    expect(deps.state.paymentRows.get(payment.id)!.reviewReason).toBe('STUCK_PROCESSING');
    expect(
      deps.state.auditEntries.filter((entry) => entry.action === 'PAYMENT_REVIEW_FLAGGED'),
    ).toHaveLength(1);
  });

  it('a PENDING payment (never reached the provider) is closed when abandoned', async () => {
    deps.mobileMoney.nextCollectionThrows('PROVIDER_UNAVAILABLE');
    const { user, booked, payment } = await bookedMobileMoney();
    expect(payment.status).toBe('PENDING');
    await appointments.cancelByPatient(user.id, booked.id, 'mtandao mbovu');
    expect(deps.state.paymentRows.get(payment.id)!.status).toBe('FAILED');
  });

  it('the refund is claimed once: concurrent triggers send money back only once', async () => {
    const { payment } = await bookedMobileMoney();
    await signedCallback(successFor(payment));
    await Promise.all([
      payments.refundIfPaid(payment.appointmentId!, 'a'),
      payments.refundIfPaid(payment.appointmentId!, 'b'),
    ]);
    expect(deps.mobileMoney.refunds).toHaveLength(1);
  });

  it('admin resolves a review item with a note (audited); resolving twice is refused', async () => {
    const { payment } = await bookedMobileMoney();
    clock.now = new Date(NOW.getTime() + 31 * 60_000);
    await signedCallback(successFor(payment));
    const admin = deps.seedUser({ role: 'PLATFORM_ADMIN' });
    const view = await payments.resolveReview(admin.id, payment.id, 'Refund confirmed with patient');
    expect(view.reviewResolvedAt).not.toBeNull();
    expect((await payments.reviewQueue()).items).toHaveLength(0);
    await expectApiError(payments.resolveReview(admin.id, payment.id, 'again'), 'REVIEW_NOT_OPEN');
  });
});

describe('amount check + unknown outcomes (Phase 13a)', () => {
  it('provider-reported amount ≠ owed → COMPLETED but NOT confirmed, flagged AMOUNT_MISMATCH, no auto-refund', async () => {
    const { booked, payment } = await bookedMobileMoney(15_000);
    await signedCallback({
      transactionId: deps.mobileMoney.collections[0]!.providerReference,
      externalReference: payment.idempotencyKey,
      status: 'success',
      amount: 1_500,
    });
    const row = deps.state.paymentRows.get(payment.id)!;
    expect(row.status).toBe('COMPLETED');
    expect(row.receivedAmountTzs).toBe(1_500);
    expect(row.reviewReason).toBe('AMOUNT_MISMATCH');
    expect(row.reviewNote).toContain('owed TZS 15000');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('PENDING_PAYMENT');
    expect(deps.mobileMoney.refunds).toHaveLength(0);
  });

  it('matching amount confirms as before', async () => {
    const { booked, payment } = await bookedMobileMoney(15_000);
    await signedCallback({
      transactionId: deps.mobileMoney.collections[0]!.providerReference,
      externalReference: payment.idempotencyKey,
      status: 'success',
      amount: 15_000,
    });
    expect(deps.state.appointments.get(booked.id)!.status).toBe('CONFIRMED');
    expect(deps.state.paymentRows.get(payment.id)!.receivedAmountTzs).toBe(15_000);
  });

  it('checkout OUTCOME_UNKNOWN at booking → PROCESSING without a reference (never FAILED); retry refused; callback settles it', async () => {
    deps.mobileMoney.nextCollectionThrows('OUTCOME_UNKNOWN');
    const { user, booked, payment } = await bookedMobileMoney();
    const row = deps.state.paymentRows.get(payment.id)!;
    expect(row.status).toBe('PROCESSING');
    expect(row.aggregatorTransactionId).toBeNull();
    expect(deps.state.auditEntries.some((entry) => entry.action === 'PAYMENT_OUTCOME_UNKNOWN')).toBe(true);

    const again = await payments.payForAppointment(user.id, booked.id);
    expect(again.status).toBe('PROCESSING'); // no second PIN prompt while the first may be live

    // Reconciliation cannot query without a provider reference — and must not fail it.
    deps.state.paymentRows.set(payment.id, { ...row, updatedAt: new Date(NOW.getTime() - 120_000) });
    await payments.reconcilePendingPayments();
    expect(deps.state.paymentRows.get(payment.id)!.status).toBe('PROCESSING');

    // The callback is matched on OUR reference and settles it normally.
    const result = await signedCallback({
      transactionId: 'azam-late-ref',
      externalReference: payment.idempotencyKey,
      status: 'success',
      amount: payment.amountTzs,
    });
    expect(result.outcome).toBe('applied');
    expect(deps.state.appointments.get(booked.id)!.status).toBe('CONFIRMED');
  });
});

describe('fees & VAT settings (Phase 13a)', () => {
  const admin = () => deps.seedUser({ role: 'PLATFORM_ADMIN' });

  it('defaults to 20% commission + 18% VAT on top; 15,000 → 3,000 / 540 / 11,460 snapshotted on the payment', async () => {
    const { payment } = await bookedMobileMoney(15_000);
    expect(payment).toMatchObject({
      platformFeeTzs: 3_000,
      vatTzs: 540,
      doctorAmountTzs: 11_460,
      commissionBps: 2_000,
      vatBps: 1_800,
      vatMode: 'ON_TOP_OF_COMMISSION',
      feeSettingsId: null,
    });
  });

  it('a rate change applies to NEW payments only; history keeps its snapshot; change is audited', async () => {
    const before = await bookedMobileMoney(15_000);
    const adminUser = admin();
    const saved = await fees.update(adminUser.id, {
      commissionPercent: 15,
      vatEnabled: false,
      vatPercent: 18,
      vatMode: 'ON_TOP_OF_COMMISSION',
      minPayoutTzs: 5_000,
      note: 'Promo rate',
    });
    expect(saved.commissionBps).toBe(1_500);
    const audit = deps.state.auditEntries.find((entry) => entry.action === 'FEE_SETTINGS_CHANGED')!;
    expect(audit.actorUserId).toBe(adminUser.id);
    expect(JSON.stringify(audit.metadata)).toContain('"before"');

    // Old payment untouched.
    expect(deps.state.paymentRows.get(before.payment.id)!.platformFeeTzs).toBe(3_000);

    // New booking with another doctor uses the new rate, VAT off.
    const { doctor } = deps.seedDoctor({}, { verificationStatus: 'APPROVED', consultationFeeTzs: 20_000 });
    const { user } = deps.seedPatient({ phone: '+255712000111' });
    const booked = await appointments.book(user.id, {
      doctorId: doctor.id,
      type: 'VIDEO',
      scheduledAt: new Date(SLOT.getTime() + 3_600_000),
      reason: 'Kikohozi',
      paymentIntent: 'MOBILE_MONEY',
    });
    const row = [...deps.state.paymentRows.values()].find((p) => p.appointmentId === booked.id)!;
    expect(row).toMatchObject({ platformFeeTzs: 3_000, vatTzs: 0, doctorAmountTzs: 17_000, feeSettingsId: saved.id });
  });

  it('per-doctor override replaces the commission rate (audited); clearing it restores the platform rate', async () => {
    const adminUser = admin();
    const { doctor } = deps.seedDoctor({}, { verificationStatus: 'APPROVED', consultationFeeTzs: 50_000 });
    await fees.setDoctorOverride(adminUser.id, doctor.id, { commissionPercent: 10, note: 'Partner hospital' });
    expect((await fees.ratesFor(doctor.id)).rates.commissionBps).toBe(1_000);
    const preview = await fees.preview(50_000, doctor.id);
    expect(preview).toMatchObject({ platformCommissionTzs: 5_000, vatTzs: 900, doctorAmountTzs: 44_100 });
    expect(deps.state.auditEntries.some((entry) => entry.action === 'FEE_OVERRIDE_CHANGED')).toBe(true);

    await fees.setDoctorOverride(adminUser.id, doctor.id, { commissionPercent: null, note: 'Ended' });
    expect((await fees.ratesFor(doctor.id)).rates.commissionBps).toBe(2_000);
  });

  it('future-dated rates wait for their date; back-dating is refused', async () => {
    const adminUser = admin();
    await fees.update(adminUser.id, {
      commissionPercent: 25,
      vatEnabled: true,
      vatPercent: 18,
      vatMode: 'INCLUDED_IN_COMMISSION',
      minPayoutTzs: 10_000,
      effectiveFrom: new Date(NOW.getTime() + 24 * 3_600_000),
      note: 'Next month',
    });
    expect((await fees.current()).commissionBps).toBe(2_000); // not yet
    clock.now = new Date(NOW.getTime() + 25 * 3_600_000);
    expect((await fees.current()).commissionBps).toBe(2_500);

    await expectApiError(
      fees.update(adminUser.id, {
        commissionPercent: 20,
        vatEnabled: true,
        vatPercent: 18,
        vatMode: 'ON_TOP_OF_COMMISSION',
        minPayoutTzs: 10_000,
        effectiveFrom: new Date(NOW.getTime() - 3_600_000),
        note: 'Oops',
      }),
      'FEE_SETTINGS_BACKDATED',
    );
  });
});

describe('refunds as disbursements (Phase 13a — AzamPay has no refund API)', () => {
  async function paid() {
    const context = await bookedMobileMoney(15_000);
    await signedCallback({
      transactionId: deps.mobileMoney.collections[0]!.providerReference,
      externalReference: context.payment.idempotencyKey,
      status: 'success',
    });
    return context;
  }

  it('sends payer wallet, name and a ≤30-char per-attempt reference', async () => {
    const { payment, user } = await paid();
    await payments.refundIfPaid(payment.appointmentId!, 'doctor-cancel');
    const sent = deps.mobileMoney.refunds[0]!;
    expect(sent).toMatchObject({ payerPhone: user.phone, amountTzs: 15_000, reference: `r1-${payment.id}` });
    expect(sent.reference.length).toBeLessThanOrEqual(30);
  });

  it('operator the API cannot pay (M-Pesa) → refund FAILED + refundPending for manual handling', async () => {
    const { payment } = await paid();
    deps.mobileMoney.nextRefundThrows('UNSUPPORTED_DESTINATION');
    await payments.refundIfPaid(payment.appointmentId!, 'doctor-cancel');
    const row = deps.state.paymentRows.get(payment.id)!;
    expect(row).toMatchObject({ status: 'COMPLETED', refundState: 'FAILED', refundPending: true });
    expect((await payments.refundsPending()).items.map((item) => item.id)).toContain(payment.id);
  });

  it('refund OUTCOME_UNKNOWN → stays PROCESSING (never failed, never resent); listed for admins after 24h', async () => {
    const { payment } = await paid();
    deps.mobileMoney.nextRefundThrows('OUTCOME_UNKNOWN');
    await payments.refundIfPaid(payment.appointmentId!, 'doctor-cancel');
    expect(deps.state.paymentRows.get(payment.id)!).toMatchObject({ refundState: 'PROCESSING', refundPending: false });
    await payments.refundIfPaid(payment.appointmentId!, 'again');
    expect(deps.mobileMoney.refunds).toHaveLength(0); // the guarded claim refuses a blind resend
    expect((await payments.refundsPending()).items).toHaveLength(0);
    clock.now = new Date(Date.now() + 25 * 60 * 60_000);
    expect((await payments.refundsPending()).items.map((item) => item.id)).toContain(payment.id);
  });

  it('pending refund disbursement is completed by reconciliation (REFUNDED + SMS)', async () => {
    const { payment } = await paid();
    deps.mobileMoney.nextRefund('pending');
    await payments.refundIfPaid(payment.appointmentId!, 'doctor-cancel');
    const row = deps.state.paymentRows.get(payment.id)!;
    deps.mobileMoney.setProviderStatus(row.refundReference!, 'COMPLETED');
    deps.state.paymentRows.set(payment.id, { ...row, updatedAt: new Date(NOW.getTime() - 120_000) });
    await payments.reconcilePendingPayments();
    expect(deps.state.paymentRows.get(payment.id)!).toMatchObject({ status: 'REFUNDED', refundState: 'COMPLETED' });
    expect(deps.sms.sent.some((entry) => entry.body.includes('yamerudishwa'))).toBe(true);
  });

  it('provider fee in a status answer is recorded on the payment (source PROVIDER)', async () => {
    const { payment } = await bookedMobileMoney(15_000);
    const reference = deps.mobileMoney.collections[0]!.providerReference;
    deps.mobileMoney.setProviderStatus(reference, 'COMPLETED', undefined, { amountTzs: 15_000, providerFeeTzs: 300 });
    const row = deps.state.paymentRows.get(payment.id)!;
    deps.state.paymentRows.set(payment.id, { ...row, updatedAt: new Date(NOW.getTime() - 120_000) });
    await payments.reconcilePendingPayments();
    expect(deps.state.paymentRows.get(payment.id)!).toMatchObject({ providerFeeTzs: 300, providerFeeSource: 'PROVIDER' });
  });
});

describe('admin refunds + doctor earning reversal/adjustment (Phase 13a)', () => {
  /** Paid appointment whose consultation completed → a PENDING earning exists. */
  async function paidAndEarned() {
    const context = await bookedMobileMoney(15_000);
    await signedCallback({
      transactionId: deps.mobileMoney.collections[0]!.providerReference,
      externalReference: context.payment.idempotencyKey,
      status: 'success',
    });
    await payments.accrueForConsultation({
      appointmentId: context.booked.id,
      doctorId: context.doctor.id,
      consultationId: 'consult-1',
    });
    const earning = [...deps.state.doctorPaymentRows.values()][0]!;
    return { ...context, earning, admin: deps.seedUser({ role: 'PLATFORM_ADMIN' }) };
  }

  it('refund before payout → the earning is REVERSED (never paid), audited', async () => {
    const { payment, earning, admin } = await paidAndEarned();
    expect(earning.amountTzs).toBe(11_460);
    const view = await payments.adminRefund(admin.id, payment.id, 'Patient complaint upheld');
    expect(view.status).toBe('REFUNDED');
    expect(deps.state.doctorPaymentRows.get(earning.id)!.status).toBe('REVERSED');
    const actions = deps.state.auditEntries.map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(['PAYMENT_REFUND_ADMIN_REQUESTED', 'DOCTOR_EARNING_REVERSED']));
  });

  it('refund after the earning was PAID → one negative adjustment for the next payout; refunding again is refused', async () => {
    const { payment, earning, admin } = await paidAndEarned();
    deps.state.doctorPaymentRows.set(earning.id, { ...earning, status: 'PAID', payoutItemId: 'item-1' });
    await payments.adminRefund(admin.id, payment.id, 'Goodwill');
    const rows = [...deps.state.doctorPaymentRows.values()];
    const adjustment = rows.find((row) => row.kind === 'ADJUSTMENT')!;
    expect(adjustment).toMatchObject({
      amountTzs: -11_460,
      status: 'PENDING',
      payoutItemId: null,
      reference: `refund-adjustment:${payment.id}`,
    });
    expect(deps.state.doctorPaymentRows.get(earning.id)!.status).toBe('PAID'); // history untouched
    await expectApiError(payments.adminRefund(admin.id, payment.id, 'again'), 'NOT_REFUNDABLE');
    expect(rows.filter((row) => row.kind === 'ADJUSTMENT')).toHaveLength(1);
  });

  it('an earning reserved by a draft payout run is adjusted, not reversed (the run already counts it)', async () => {
    const { payment, earning, admin } = await paidAndEarned();
    deps.state.doctorPaymentRows.set(earning.id, { ...earning, payoutItemId: 'draft-item' });
    await payments.adminRefund(admin.id, payment.id, 'Complaint');
    expect(deps.state.doctorPaymentRows.get(earning.id)!.status).toBe('PENDING');
    expect([...deps.state.doctorPaymentRows.values()].some((row) => row.amountTzs === -11_460)).toBe(true);
  });

  it('retry a FAILED refund (only FAILED); manual completion needs a reference and is refused while a disbursement is in flight', async () => {
    const { payment, admin } = await paidAndEarned();
    deps.mobileMoney.nextRefundThrows('UNSUPPORTED_DESTINATION');
    await payments.adminRefund(admin.id, payment.id, 'Complaint');
    expect(deps.state.paymentRows.get(payment.id)!.refundState).toBe('FAILED');

    deps.mobileMoney.nextRefund('pending');
    const retried = await payments.retryRefund(admin.id, payment.id);
    expect(retried.refundState).toBe('PROCESSING');
    expect(deps.mobileMoney.refunds.at(-1)!.reference).toBe(`r2-${payment.id}`);
    await expectApiError(payments.retryRefund(admin.id, payment.id), 'REFUND_NOT_RETRYABLE');
    await expectApiError(
      payments.completeRefundManually(admin.id, payment.id, 'MPESA-1', 'sent'),
      'REFUND_NOT_MANUALLY_COMPLETABLE',
    );
  });

  it('manual completion of a FAILED refund → REFUNDED with the reference, earning reversed, audited', async () => {
    const { payment, earning, admin } = await paidAndEarned();
    deps.mobileMoney.nextRefundThrows('UNSUPPORTED_DESTINATION');
    await payments.refundIfPaid(payment.appointmentId!, 'doctor-cancel');
    const view = await payments.completeRefundManually(admin.id, payment.id, 'MPESA-QX99', 'Sent from company wallet');
    expect(view).toMatchObject({ status: 'REFUNDED', refundState: 'COMPLETED', refundPending: false });
    expect(deps.state.paymentRows.get(payment.id)!.refundReference).toBe('MANUAL:MPESA-QX99');
    expect(deps.state.doctorPaymentRows.get(earning.id)!.status).toBe('REVERSED');
    expect(deps.state.auditEntries.some((entry) => entry.action === 'PAYMENT_REFUND_COMPLETED_MANUALLY')).toBe(true);
  });
});
