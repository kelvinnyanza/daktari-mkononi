import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DoctorPayment } from '@daktari/db';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import { FeeSettingsService } from '../src/modules/payments/fee-settings.service.js';
import { PaymentService } from '../src/modules/payments/payment.service.js';
import { PayoutService } from '../src/modules/payouts/payout.service.js';
import { ApiError } from '../src/lib/errors.js';

const NOW = new Date('2026-11-02T09:00:00.000Z');
const EARNED_AT = new Date('2026-10-28T09:00:00.000Z');

let deps: FakeDeps;
let clock: { now: Date };
let payouts: PayoutService;
let payments: PaymentService;

beforeAll(() => {
  applyTestEnv();
});

beforeEach(() => {
  deps = makeFakeDeps();
  clock = { now: new Date(NOW) };
  const fees = new FeeSettingsService(
    { feeSettings: deps.feeSettings, doctors: deps.doctors, auditLogs: deps.auditLogs },
    () => clock.now,
  );
  payouts = new PayoutService(
    { payouts: deps.payouts, doctors: deps.doctors, mobileMoney: deps.mobileMoney, fees, sms: deps.sms, auditLogs: deps.auditLogs },
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
});

async function expectApiError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => new Error(`expected ${code}`),
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe(code);
}

function earning(doctorId: string, amountTzs: number, overrides: Partial<DoctorPayment> = {}): DoctorPayment {
  const row: DoctorPayment = {
    id: `c${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    doctorId,
    amountTzs,
    periodStart: EARNED_AT,
    periodEnd: EARNED_AT,
    status: 'PENDING',
    reference: `consultation:${randomUUID()}`,
    paymentId: null,
    kind: 'EARNING',
    note: null,
    failureReason: null,
    payoutItemId: null,
    paidAt: null,
    createdAt: EARNED_AT,
    updatedAt: EARNED_AT,
    ...overrides,
  };
  deps.state.doctorPaymentRows.set(row.id, row);
  return row;
}

/** Doctor with a VERIFIED Airtel payout account (auto-payable) and earnings. */
async function verifiedDoctor(phone = '+255682345678', operator: 'AIRTEL_MONEY' | 'MPESA' = 'AIRTEL_MONEY') {
  const { user, doctor } = deps.seedDoctor({ fullName: 'Dr Amina Juma' }, { verificationStatus: 'APPROVED' });
  deps.mobileMoney.accountNames.set(phone, 'AMINA JUMA');
  await payouts.setMyAccount(user.id, { type: 'MOBILE_MONEY', operator, accountNumber: phone });
  await payouts.confirmMyAccount(user.id, 'amina  juma');
  return { user, doctor };
}

const admin = () => deps.seedUser({ role: 'PLATFORM_ADMIN' });

describe('payout account (name lookup → doctor confirms; changes re-verify)', () => {
  it('lookup returns a name → doctor confirms it → VERIFIED; a wrong name is refused', async () => {
    const { user } = deps.seedDoctor({}, { verificationStatus: 'APPROVED' });
    deps.mobileMoney.accountNames.set('+255682345678', 'AMINA JUMA');
    const saved = await payouts.setMyAccount(user.id, {
      type: 'MOBILE_MONEY',
      operator: 'AIRTEL_MONEY',
      accountNumber: '+255682345678',
    });
    expect(saved.account).toMatchObject({
      status: 'NAME_PENDING_CONFIRMATION',
      lookupName: 'AMINA JUMA',
      accountNumberMasked: '••••5678',
      automaticPayout: true,
    });
    await expectApiError(payouts.confirmMyAccount(user.id, 'Someone Else'), 'PAYOUT_ACCOUNT_NOT_CONFIRMABLE');
    expect((await payouts.confirmMyAccount(user.id, 'Amina Juma')).account.status).toBe('VERIFIED');
  });

  it('any change resets verification and is audited with masked numbers only', async () => {
    const { user } = await verifiedDoctor();
    deps.mobileMoney.accountNames.set('+255712345678', 'AMINA JUMA');
    const changed = await payouts.setMyAccount(user.id, {
      type: 'MOBILE_MONEY',
      operator: 'TIGO_PESA',
      accountNumber: '+255712345678',
    });
    expect(changed.account.status).toBe('NAME_PENDING_CONFIRMATION');
    const audits = deps.state.auditEntries.filter((entry) => entry.action === 'PAYOUT_ACCOUNT_CHANGED');
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain('682345678');
    expect(JSON.stringify(audits)).toContain('••••5678');
  });

  it('lookup cannot confirm → LOOKUP_FAILED → admin verifies manually (audited)', async () => {
    const { user, doctor } = deps.seedDoctor({}, { verificationStatus: 'APPROVED' });
    const saved = await payouts.setMyAccount(user.id, {
      type: 'BANK',
      bankName: 'CRDB',
      accountNumber: '0150123456789',
      accountName: 'Amina Juma',
    });
    expect(saved.account).toMatchObject({ status: 'LOOKUP_FAILED', automaticPayout: false });
    expect((await payouts.accountsNeedingReview()).items).toHaveLength(1);
    const verified = await payouts.adminVerifyAccount(admin().id, doctor.id, 'Bank letter checked');
    expect(verified.account.status).toBe('VERIFIED');
    expect(deps.state.auditEntries.some((entry) => entry.action === 'PAYOUT_ACCOUNT_VERIFIED_MANUALLY')).toBe(true);
  });
});

describe('payout runs', () => {
  it('preview: eligibility per doctor (no account / unverified / below minimum), negative adjustments net in', async () => {
    const ready = await verifiedDoctor();
    earning(ready.doctor.id, 11_460);
    earning(ready.doctor.id, 15_280);
    earning(ready.doctor.id, -1_000, { kind: 'ADJUSTMENT', reference: 'refund-adjustment:x' });
    const small = await verifiedDoctor('+255692345678');
    earning(small.doctor.id, 5_000); // below the 10,000 default minimum
    const noAccount = deps.seedDoctor({}, { verificationStatus: 'APPROVED' });
    earning(noAccount.doctor.id, 20_000);

    const preview = await payouts.preview(NOW);
    const byDoctor = Object.fromEntries(preview.rows.map((row) => [row.doctorId, row]));
    expect(byDoctor[ready.doctor.id]).toMatchObject({ netTzs: 25_740, earningsCount: 3, eligible: true, reason: 'OK' });
    expect(byDoctor[small.doctor.id]).toMatchObject({ eligible: false, reason: 'BELOW_MINIMUM' });
    expect(byDoctor[noAccount.doctor.id]).toMatchObject({ eligible: false, reason: 'NO_ACCOUNT' });
    expect(preview.eligibleTotalTzs).toBe(25_740);
    expect(preview.minPayoutTzs).toBe(10_000);
  });

  it('happy path: draft reserves → approve sends via disbursement → status PAID → earnings PAID, run COMPLETED, SMS', async () => {
    const { doctor, user } = await verifiedDoctor();
    const a = earning(doctor.id, 11_460);
    const b = earning(doctor.id, 15_280);
    const adminUser = admin();
    const draft = await payouts.createRun(adminUser.id, NOW, 'Weekly');
    expect(draft).toMatchObject({ status: 'DRAFT', totalTzs: 26_740, itemCount: 1 });
    expect(deps.mobileMoney.disbursements).toHaveLength(0); // nothing sent before approval
    // A second run cannot take the same earnings.
    await expectApiError(payouts.createRun(adminUser.id, NOW, undefined), 'NOTHING_TO_PAY');

    const approved = await payouts.approveRun(adminUser.id, draft.id);
    const item = approved.items[0]!;
    expect(item).toMatchObject({ status: 'PROCESSING', reference: `p1-${item.id}`, attempt: 1 });
    expect(deps.mobileMoney.disbursements[0]).toMatchObject({
      operator: 'AIRTEL_MONEY',
      accountNumber: '+255682345678',
      accountName: 'AMINA JUMA',
      amountTzs: 26_740,
      reference: `p1-${item.id}`,
    });
    expect(deps.state.doctorPaymentRows.get(a.id)!.status).toBe('PROCESSING');

    deps.mobileMoney.setProviderStatus(item.providerReference!, 'COMPLETED', undefined, { providerFeeTzs: 500 });
    clock.now = new Date(Date.now() + 120_000);
    expect(await payouts.reconcilePayouts()).toBe(1);
    const done = await payouts.batchView(draft.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.items[0]!.status).toBe('PAID');
    expect([a.id, b.id].map((id) => deps.state.doctorPaymentRows.get(id)!.status)).toEqual(['PAID', 'PAID']);
    expect(deps.sms.sent.some((entry) => entry.to === user.phone && entry.body.includes('26740'))).toBe(true);
  });

  it('definitive failure → item + earnings FAILED with reason; retry sends ONCE more with a new reference', async () => {
    const { doctor } = await verifiedDoctor();
    const e = earning(doctor.id, 20_000);
    const adminUser = admin();
    const draft = await payouts.createRun(adminUser.id, NOW, undefined);
    deps.mobileMoney.nextDisbursement('failed');
    const run = await payouts.approveRun(adminUser.id, draft.id);
    const item = run.items[0]!;
    expect(item.status).toBe('FAILED');
    expect(deps.state.doctorPaymentRows.get(e.id)!).toMatchObject({ status: 'FAILED', failureReason: 'scripted failure' });

    const retried = await payouts.retryItem(adminUser.id, item.id);
    expect(retried.items[0]).toMatchObject({ status: 'PROCESSING', attempt: 2, reference: `p2-${item.id}` });
    expect(deps.mobileMoney.disbursements).toHaveLength(2);
    // PROCESSING is never retried.
    await expectApiError(payouts.retryItem(adminUser.id, item.id), 'PAYOUT_NOT_RETRYABLE');
    expect(deps.mobileMoney.disbursements).toHaveLength(2);
  });

  it('timeout (OUTCOME_UNKNOWN) → stays PROCESSING, never resent; the callback on OUR reference settles it via status', async () => {
    const { doctor } = await verifiedDoctor();
    earning(doctor.id, 20_000);
    const adminUser = admin();
    const draft = await payouts.createRun(adminUser.id, NOW, undefined);
    deps.mobileMoney.nextDisbursementThrows('OUTCOME_UNKNOWN');
    const item = (await payouts.approveRun(adminUser.id, draft.id)).items[0]!;
    expect(item).toMatchObject({ status: 'PROCESSING', providerReference: null });
    await expectApiError(payouts.retryItem(adminUser.id, item.id), 'PAYOUT_NOT_RETRYABLE');

    deps.mobileMoney.setProviderStatus('pg-late', 'COMPLETED');
    const outcome = await payouts.handleDisbursementCallback({
      initiatorReferenceId: item.reference!,
      pgReferenceId: 'pg-late',
      status: 'success',
    });
    expect(outcome.outcome).toBe('applied');
    expect((await payouts.batchView(draft.id)).items[0]!.status).toBe('PAID');
  });

  it('M-Pesa account: AzamPay cannot pay it → FAILED MANUAL_REQUIRED (no API call) → admin marks paid with a reference', async () => {
    const { doctor } = await verifiedDoctor('+255742345678', 'MPESA');
    const e = earning(doctor.id, 20_000);
    const adminUser = admin();
    const draft = await payouts.createRun(adminUser.id, NOW, undefined);
    const item = (await payouts.approveRun(adminUser.id, draft.id)).items[0]!;
    expect(item.status).toBe('FAILED');
    expect(item.failureReason).toContain('MANUAL_REQUIRED');
    expect(deps.mobileMoney.disbursements).toHaveLength(0);

    const paid = await payouts.markItemPaid(adminUser.id, item.id, 'MPESA-QX12345', 'Sent from company M-Pesa');
    expect(paid.items[0]).toMatchObject({ status: 'PAID', method: 'MANUAL', manualReference: 'MPESA-QX12345' });
    expect(deps.state.doctorPaymentRows.get(e.id)!.status).toBe('PAID');
    expect(paid.status).toBe('COMPLETED');
    // Paid is final: neither retry nor a second manual mark.
    await expectApiError(payouts.markItemPaid(adminUser.id, item.id, 'X-1', 'again'), 'PAYOUT_NOT_MARKABLE');
  });

  it('mark-paid is refused while a known disbursement is in flight (would pay twice)', async () => {
    const { doctor } = await verifiedDoctor();
    earning(doctor.id, 20_000);
    const adminUser = admin();
    const draft = await payouts.createRun(adminUser.id, NOW, undefined);
    const item = (await payouts.approveRun(adminUser.id, draft.id)).items[0]!;
    expect(item.providerReference).not.toBeNull();
    await expectApiError(payouts.markItemPaid(adminUser.id, item.id, 'REF-1', 'manual'), 'PAYOUT_NOT_MARKABLE');
  });

  it('cancelling a draft releases the earnings for the next run', async () => {
    const { doctor } = await verifiedDoctor();
    const e = earning(doctor.id, 20_000);
    const adminUser = admin();
    const draft = await payouts.createRun(adminUser.id, NOW, undefined);
    expect(deps.state.doctorPaymentRows.get(e.id)!.payoutItemId).not.toBeNull();
    await payouts.cancelRun(adminUser.id, draft.id);
    expect(deps.state.doctorPaymentRows.get(e.id)!.payoutItemId).toBeNull();
    await expectApiError(payouts.approveRun(adminUser.id, draft.id), 'PAYOUT_RUN_STATE');
    expect((await payouts.createRun(adminUser.id, NOW, undefined)).totalTzs).toBe(20_000);
  });
});

describe('doctor earnings totals', () => {
  it('per-status totals cover ALL rows, not just the page shown', async () => {
    const { doctor, user } = await verifiedDoctor();
    earning(doctor.id, 10_000);
    earning(doctor.id, 20_000);
    earning(doctor.id, 30_000, { status: 'PAID' });
    earning(doctor.id, 5_000, { status: 'PROCESSING' });
    const page = await payments.doctorEarnings(user.id, { page: 1, pageSize: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.totals).toEqual({ pendingTzs: 30_000, processingTzs: 5_000, paidTzs: 30_000, failedTzs: 0, reversedTzs: 0 });
  });
});
