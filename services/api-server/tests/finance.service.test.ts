import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Payment, PayoutItem } from '@daktari/db';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import { FinanceService } from '../src/modules/reports/finance.service.js';
import { parseCsv } from '../src/lib/csv.js';
import { ApiError } from '../src/lib/errors.js';

let deps: FakeDeps;
let finance: FinanceService;

beforeAll(() => {
  applyTestEnv();
});

beforeEach(() => {
  deps = makeFakeDeps();
  finance = new FinanceService({ finance: deps.finance, auditLogs: deps.auditLogs }, () => new Date('2026-11-03T09:00:00Z'));
});

async function payment(overrides: Partial<Payment>): Promise<Payment> {
  const created = await deps.paymentsRepo.create({
    patientId: 'patient-1',
    appointmentId: `appt-${Math.random()}`,
    amountTzs: overrides.amountTzs ?? 15_000,
    platformFeeTzs: 3_000,
    vatTzs: 540,
    doctorAmountTzs: 11_460,
    commissionBps: 2_000,
    vatBps: 1_800,
    vatMode: 'ON_TOP_OF_COMMISSION',
    feeSettingsId: null,
    method: 'MPESA',
    idempotencyKey: `key-${Math.random()}`,
    payerPhone: '+255742345678',
  });
  const row = { ...created, status: 'COMPLETED' as const, ...overrides };
  deps.state.paymentRows.set(row.id, row);
  return row;
}

function payoutItem(overrides: Partial<PayoutItem>): PayoutItem {
  const item: PayoutItem = {
    id: `item-${Math.random()}`,
    batchId: 'batch-1',
    doctorId: 'doctor-1',
    amountTzs: 11_460,
    status: 'PAID',
    attempt: 1,
    reference: `p1-${Math.random()}`,
    providerReference: `pg-${Math.random()}`,
    providerFeeTzs: null,
    failureReason: null,
    method: 'AZAMPAY',
    manualReference: null,
    accountSnapshot: null,
    paidAt: new Date('2026-11-02T08:00:00Z'),
    lastStatusCheckAt: null,
    createdAt: new Date('2026-11-02T08:00:00Z'),
    updatedAt: new Date('2026-11-02T08:00:00Z'),
    ...overrides,
  };
  deps.state.payoutItems.set(item.id, item);
  return item;
}

describe('finance summary', () => {
  it('collected, refunded, commission/VAT net of refunds, known AzamPay fees, payouts, net revenue', async () => {
    const day1 = new Date('2026-11-01T07:00:00Z'); // 10:00 EAT
    const day2 = new Date('2026-11-02T07:00:00Z');
    await payment({ paidAt: day1, providerFeeTzs: 300, providerFeeSource: 'PROVIDER' });
    await payment({
      amountTzs: 20_000,
      platformFeeTzs: 4_000,
      vatTzs: 720,
      doctorAmountTzs: 15_280,
      paidAt: day1,
      status: 'REFUNDED',
      refundedAt: day2,
      refundAmountTzs: 20_000,
    });
    // Late success: money held only to return it — not commission/VAT revenue.
    await payment({ paidAt: day1, status: 'REFUNDED', refundedAt: day2, refundAmountTzs: 15_000, reviewReason: 'LATE_SUCCESS' });
    // Paid at 21:30 UTC on Nov 2 = 00:30 EAT on Nov 3 → outside the range.
    await payment({ paidAt: new Date('2026-11-02T21:30:00Z') });
    payoutItem({ amountTzs: 11_460, providerFeeTzs: 500 });
    payoutItem({ amountTzs: 5_000, method: 'MANUAL', providerReference: null, manualReference: 'MPESA-1' });

    const summary = await finance.summary('2026-11-01', '2026-11-02');
    expect(summary).toMatchObject({
      collectedTzs: 50_000,
      collectedCount: 3,
      collectedNotEarnedTzs: 15_000,
      refundedTzs: 35_000,
      refundedCount: 2,
      commissionTzs: 3_000, // 3,000 + 4,000 earned − 4,000 reversed by the refund
      commissionReversedTzs: 4_000,
      vatDueTzs: 540,
      vatReversedTzs: 720,
      azamPayFeesTzs: 800, // 300 on a collection + 500 on the AzamPay payout
      azamPayFeesUnknownCount: 2,
      doctorPayoutsTzs: 16_460,
      doctorPayoutsViaAzamPayTzs: 11_460,
      doctorPayoutsManualTzs: 5_000,
      netPlatformRevenueTzs: 2_200,
    });
  });

  it('rejects an inverted range', async () => {
    await expect(finance.summary('2026-11-05', '2026-11-01')).rejects.toBeInstanceOf(ApiError);
  });

  it('CSV export: summary block + one line per payment; text cells cannot become spreadsheet formulas', async () => {
    await payment({ paidAt: new Date('2026-11-01T07:00:00Z'), aggregatorTransactionId: '=HYPERLINK("http://x")' });
    const csv = await finance.csv('2026-11-01', '2026-11-02');
    const rows = parseCsv(csv);
    expect(rows[1]).toEqual(['metric', 'value']);
    expect(rows.some((row) => row[0] === 'collectedTzs' && row[1] === '15000')).toBe(true);
    const line = rows.find((row) => row[0] === 'payment')!;
    expect(line).toContain(`'=HYPERLINK("http://x")`);
  });
});

describe('AzamPay statement reconciliation', () => {
  it('lists missing on either side, amount and status mismatches; records statement fees when asked', async () => {
    const day = new Date('2026-11-01T07:00:00Z');
    const p1 = await payment({ paidAt: day, aggregatorTransactionId: 'AZ-1' });
    const p2 = await payment({ paidAt: day, aggregatorTransactionId: 'AZ-2', amountTzs: 20_000 });
    const p3 = await payment({ paidAt: day, aggregatorTransactionId: 'AZ-3' }); // not in the statement
    const p4 = await payment({ status: 'FAILED', aggregatorTransactionId: 'AZ-4' }); // statement says success
    const statement = [
      'Date,Transaction ID,Merchant Reference,Amount,Fee,Status',
      `2026-11-01 10:00,AZ-1,${p1.idempotencyKey},"15,000",300,Success`,
      `2026-11-01 11:00,AZ-2,${p2.idempotencyKey},19000,380,Success`,
      '2026-11-01 12:00,AZ-GHOST,ghost:1,5000,100,Success',
      `2026-11-01 13:00,AZ-4,${p4.idempotencyKey},15000,300,Success`,
      '2026-11-01 14:00,AZ-FAILED,other:1,5000,0,Failed',
    ].join('\n');
    const admin = deps.seedUser({ role: 'PLATFORM_ADMIN' });
    const result = await finance.reconcile(admin.id, statement, { applyFees: true });

    expect(result.rows).toBe(5);
    expect(result.matched).toBe(3);
    expect(result.inAzamPayNotOurs.map((row) => row.references)).toEqual([['AZ-GHOST', 'ghost:1']]); // failed rows ignored
    expect(result.amountMismatches).toEqual([
      expect.objectContaining({ id: p2.id, amountTzs: 19_000, oursTzs: 20_000 }),
    ]);
    expect(result.statusMismatches).toEqual([expect.objectContaining({ id: p4.id, ours: 'FAILED' })]);
    expect(result.inOursNotAzamPay.map((row) => row.id)).toEqual([p3.id]);
    expect(result.period).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(result.feesRecorded).toBe(3);
    expect(deps.state.paymentRows.get(p1.id)).toMatchObject({ providerFeeTzs: 300, providerFeeSource: 'STATEMENT' });
    expect(deps.state.auditEntries.some((entry) => entry.action === 'RECONCILIATION_IMPORTED')).toBe(true);
  });

  it('a statement without recognisable reference/amount columns is refused with the headers it saw', async () => {
    const admin = deps.seedUser({ role: 'PLATFORM_ADMIN' });
    await expect(finance.reconcile(admin.id, 'foo,bar\n1,2', { applyFees: false })).rejects.toMatchObject({
      code: 'STATEMENT_UNRECOGNIZED',
    });
  });

  it('CSV parser: quoted commas, escaped quotes, CRLF and BOM', () => {
    expect(parseCsv('﻿a,"b,c","d ""e"""\r\n1,2,3\r\n')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });
});
