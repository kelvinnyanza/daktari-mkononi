import type { Payment, PayoutItem } from '@daktari/db';
import { mapAzamPayStatus, type ProviderPaymentStatus } from '@daktari/payments';
import { ApiError, msg } from '../../lib/errors.js';
import { csvLine, parseCsv } from '../../lib/csv.js';
import { eatDayRangeUtc, utcToEatDate } from '../../lib/eat-time.js';
import type { AuditLogPort, FinanceRepoPort } from '../../lib/ports.js';

/**
 * Payments that never bought a consultation: the platform holds the money
 * only to return it, so it is not commission or VAT revenue.
 */
const UNEARNED_REVIEW = new Set(['LATE_SUCCESS', 'AMOUNT_MISMATCH']);
const isEarned = (payment: Payment): boolean =>
  payment.reviewReason === null || !UNEARNED_REVIEW.has(payment.reviewReason);
const received = (payment: Payment): number => payment.receivedAmountTzs ?? payment.amountTzs;
const MAX_LISTED = 500;

export interface FinanceSummary {
  from: string;
  to: string;
  /** Money received from patients (incl. payments later refunded). */
  collectedTzs: number;
  collectedCount: number;
  /** Of which received for no consultation (late success / amount mismatch). */
  collectedNotEarnedTzs: number;
  refundedTzs: number;
  refundedCount: number;
  /** Platform commission EXCLUDING VAT, net of commission reversed by refunds in the period. */
  commissionTzs: number;
  commissionReversedTzs: number;
  /** VAT on commission owed to TRA, net of VAT reversed by refunds in the period. */
  vatDueTzs: number;
  vatReversedTzs: number;
  /** AzamPay charges we KNOW (from the API or an imported statement). */
  azamPayFeesTzs: number;
  /** Collections / payouts in the period whose AzamPay fee is not known yet. */
  azamPayFeesUnknownCount: number;
  doctorPayoutsTzs: number;
  doctorPayoutsViaAzamPayTzs: number;
  doctorPayoutsManualTzs: number;
  /** commissionTzs − azamPayFeesTzs (AzamPay's charges are absorbed by the platform). */
  netPlatformRevenueTzs: number;
}

export interface StatementRowResult {
  line: number;
  references: string[];
  amountTzs: number | null;
  status: ProviderPaymentStatus;
}

export interface ReconciliationResult {
  period: { from: string | null; to: string | null };
  rows: number;
  matched: number;
  feesRecorded: number;
  inAzamPayNotOurs: StatementRowResult[];
  inOursNotAzamPay: Array<{ kind: 'collection' | 'refund' | 'payout'; id: string; reference: string | null; amountTzs: number; at: Date | null }>;
  amountMismatches: Array<StatementRowResult & { kind: string; id: string; oursTzs: number }>;
  statusMismatches: Array<StatementRowResult & { kind: string; id: string; ours: string }>;
}

function parseStatementAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/tzs|tsh|\s|,/gi, '');
  if (cleaned === '') return null;
  // "15000" and "15000.00" are whole TZS; anything fractional is not comparable.
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

/** Finance totals, CSV export and AzamPay statement reconciliation (admin only). */
export class FinanceService {
  constructor(
    private readonly deps: { finance: FinanceRepoPort; auditLogs: AuditLogPort },
    private readonly now: () => Date = () => new Date(),
  ) {}

  private range(from: string, to: string): { start: Date; end: Date } {
    if (from > to) {
      throw new ApiError(400, 'INVALID_RANGE', msg('Tarehe ya mwanzo iko baada ya mwisho', 'from is after to'));
    }
    return { start: eatDayRangeUtc(from).start, end: eatDayRangeUtc(to).end };
  }

  private async load(from: string, to: string) {
    const { start, end } = this.range(from, to);
    const [paid, refunded, payouts] = await Promise.all([
      this.deps.finance.paymentsPaidBetween(start, end),
      this.deps.finance.paymentsRefundedBetween(start, end),
      this.deps.finance.payoutItemsPaidBetween(start, end),
    ]);
    return { paid, refunded, payouts };
  }

  /** Totals for EAT dates [from, to] inclusive. */
  async summary(from: string, to: string): Promise<FinanceSummary> {
    const { paid, refunded, payouts } = await this.load(from, to);
    return FinanceService.summarise(from, to, paid, refunded, payouts);
  }

  private static summarise(
    from: string,
    to: string,
    paid: Payment[],
    refunded: Payment[],
    payouts: PayoutItem[],
  ): FinanceSummary {
    const sum = <T>(rows: T[], pick: (row: T) => number): number => rows.reduce((total, row) => total + pick(row), 0);
    const earnedPaid = paid.filter(isEarned);
    const earnedRefunded = refunded.filter(isEarned);
    const commissionGross = sum(earnedPaid, (p) => p.platformFeeTzs);
    const commissionReversedTzs = sum(earnedRefunded, (p) => p.platformFeeTzs);
    const vatGross = sum(earnedPaid, (p) => p.vatTzs);
    const vatReversedTzs = sum(earnedRefunded, (p) => p.vatTzs);
    const azamPayFeesTzs = sum(paid, (p) => p.providerFeeTzs ?? 0) + sum(payouts, (i) => i.method === 'AZAMPAY' ? (i.providerFeeTzs ?? 0) : 0);
    const commissionTzs = commissionGross - commissionReversedTzs;
    return {
      from,
      to,
      collectedTzs: sum(paid, received),
      collectedCount: paid.length,
      collectedNotEarnedTzs: sum(paid.filter((p) => !isEarned(p)), received),
      refundedTzs: sum(refunded, (p) => p.refundAmountTzs ?? received(p)),
      refundedCount: refunded.length,
      commissionTzs,
      commissionReversedTzs,
      vatDueTzs: vatGross - vatReversedTzs,
      vatReversedTzs,
      azamPayFeesTzs,
      azamPayFeesUnknownCount:
        paid.filter((p) => p.providerFeeTzs === null).length +
        payouts.filter((i) => i.method === 'AZAMPAY' && i.providerFeeTzs === null).length,
      doctorPayoutsTzs: sum(payouts, (i) => i.amountTzs),
      doctorPayoutsViaAzamPayTzs: sum(payouts.filter((i) => i.method === 'AZAMPAY'), (i) => i.amountTzs),
      doctorPayoutsManualTzs: sum(payouts.filter((i) => i.method === 'MANUAL'), (i) => i.amountTzs),
      netPlatformRevenueTzs: commissionTzs - azamPayFeesTzs,
    };
  }

  /** CSV: summary block, then one line per payment and per payout in the period. */
  async csv(from: string, to: string): Promise<string> {
    const { paid, refunded, payouts } = await this.load(from, to);
    const summary = FinanceService.summarise(from, to, paid, refunded, payouts);
    const lines: string[] = [
      csvLine([`Daktari Mkononi finance report ${from} to ${to} (EAT), whole TZS`]),
      csvLine(['metric', 'value']),
      ...Object.entries(summary)
        .filter(([key]) => key !== 'from' && key !== 'to')
        .map(([key, value]) => csvLine([key, value as number])),
      '',
      csvLine([
        'section', 'paymentId', 'status', 'paidAtUtc', 'refundedAtUtc', 'amountTzs', 'receivedTzs',
        'commissionTzs', 'vatTzs', 'doctorAmountTzs', 'commissionBps', 'vatBps', 'vatMode',
        'azamPayFeeTzs', 'refundAmountTzs', 'earned', 'reviewReason', 'ourReference', 'azamPayReference',
      ]),
    ];
    const byId = new Map<string, Payment>();
    for (const payment of [...paid, ...refunded]) byId.set(payment.id, payment);
    for (const p of byId.values()) {
      lines.push(
        csvLine([
          'payment', p.id, p.status, p.paidAt, p.refundedAt, p.amountTzs, received(p), p.platformFeeTzs, p.vatTzs,
          p.doctorAmountTzs, p.commissionBps, p.vatBps, p.vatMode, p.providerFeeTzs, p.refundAmountTzs,
          isEarned(p), p.reviewReason, p.idempotencyKey, p.aggregatorTransactionId,
        ]),
      );
    }
    lines.push('', csvLine(['section', 'payoutItemId', 'doctorId', 'paidAtUtc', 'amountTzs', 'method', 'reference', 'azamPayReference', 'manualReference', 'azamPayFeeTzs']));
    for (const i of payouts) {
      lines.push(csvLine(['payout', i.id, i.doctorId, i.paidAt, i.amountTzs, i.method, i.reference, i.providerReference, i.manualReference, i.providerFeeTzs]));
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  /**
   * Compare an AzamPay statement CSV with our records. AzamPay does not
   * publish the statement layout, so columns are recognised by name: every
   * reference-like column is matched against ALL our references (our keys,
   * AzamPay transaction / refund / payout ids); amount, fee, status and date
   * columns by keyword. Optionally records AzamPay's fee per collection.
   */
  async reconcile(
    adminUserId: string,
    text: string,
    options: { from?: string; to?: string; applyFees: boolean },
  ): Promise<ReconciliationResult> {
    const rows = parseCsv(text);
    const header = (rows[0] ?? []).map((cell) => cell.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const find = (test: (name: string) => boolean): number[] =>
      header.flatMap((name, index) => (test(name) ? [index] : []));
    const refCols = find((n) => /(ref|id$|transaction|receipt|txn)/.test(n) && !/(date|time|amount|fee|charge|status|msisdn|phone|name)/.test(n));
    const amountCol = find((n) => /amount/.test(n) && !/(fee|charge|commission)/.test(n))[0];
    const feeCol = find((n) => /(fee|charge)/.test(n))[0];
    const statusCol = find((n) => /status/.test(n))[0];
    const dateCol = find((n) => /(date|time)/.test(n))[0];
    if (refCols.length === 0 || amountCol === undefined) {
      throw new ApiError(
        400,
        'STATEMENT_UNRECOGNIZED',
        msg(
          'Safu za kumbukumbu na kiasi hazikutambuliwa kwenye taarifa',
          'Could not find reference and amount columns in the statement',
        ),
        { headers: rows[0] ?? [] },
      );
    }

    const statement = rows.slice(1).map((cells, index) => {
      const refs = [...new Set(refCols.map((col) => (cells[col] ?? '').trim()).filter((ref) => ref !== ''))];
      const date = dateCol === undefined ? Number.NaN : Date.parse(cells[dateCol] ?? '');
      return {
        line: index + 2,
        references: refs,
        amountTzs: parseStatementAmount(cells[amountCol]),
        fee: feeCol === undefined ? null : parseStatementAmount(cells[feeCol]),
        status: statusCol === undefined ? ('COMPLETED' as ProviderPaymentStatus) : mapAzamPayStatus(cells[statusCol]),
        date: Number.isNaN(date) ? null : new Date(date),
      };
    });

    const { payments, payoutItems } = await this.deps.finance.findByAnyReference(statement.flatMap((row) => row.references));
    const paymentByRef = new Map<string, { payment: Payment; kind: 'collection' | 'refund' }>();
    for (const payment of payments) {
      for (const ref of [payment.idempotencyKey, payment.aggregatorTransactionId, payment.externalReference]) {
        if (ref) paymentByRef.set(ref, { payment, kind: 'collection' });
      }
      if (payment.refundReference) paymentByRef.set(payment.refundReference, { payment, kind: 'refund' });
    }
    const itemByRef = new Map<string, PayoutItem>();
    for (const item of payoutItems) {
      if (item.reference) itemByRef.set(item.reference, item);
      if (item.providerReference) itemByRef.set(item.providerReference, item);
    }

    const result: ReconciliationResult = {
      period: { from: options.from ?? null, to: options.to ?? null },
      rows: statement.length,
      matched: 0,
      feesRecorded: 0,
      inAzamPayNotOurs: [],
      inOursNotAzamPay: [],
      amountMismatches: [],
      statusMismatches: [],
    };
    const seen = { collection: new Set<string>(), refund: new Set<string>(), payout: new Set<string>() };
    const push = <T>(list: T[], value: T): void => {
      if (list.length < MAX_LISTED) list.push(value);
    };

    for (const row of statement) {
      const view: StatementRowResult = { line: row.line, references: row.references, amountTzs: row.amountTzs, status: row.status };
      const paymentHit = row.references.map((ref) => paymentByRef.get(ref)).find((hit) => hit !== undefined);
      const itemHit = row.references.map((ref) => itemByRef.get(ref)).find((hit) => hit !== undefined);
      if (!paymentHit && !itemHit) {
        if (row.status !== 'FAILED') push(result.inAzamPayNotOurs, view);
        continue;
      }
      result.matched += 1;
      if (itemHit) {
        seen.payout.add(itemHit.id);
        if (row.amountTzs !== null && row.amountTzs !== itemHit.amountTzs) {
          push(result.amountMismatches, { ...view, kind: 'payout', id: itemHit.id, oursTzs: itemHit.amountTzs });
        }
        const oursPaid = itemHit.status === 'PAID';
        if ((row.status === 'COMPLETED') !== oursPaid && row.status !== 'PENDING') {
          push(result.statusMismatches, { ...view, kind: 'payout', id: itemHit.id, ours: itemHit.status });
        }
        continue;
      }
      const { payment, kind } = paymentHit!;
      seen[kind].add(payment.id);
      const ours = kind === 'refund' ? (payment.refundAmountTzs ?? received(payment)) : received(payment);
      if (row.amountTzs !== null && row.amountTzs !== ours) {
        push(result.amountMismatches, { ...view, kind, id: payment.id, oursTzs: ours });
      }
      const oursDone = kind === 'refund' ? payment.status === 'REFUNDED' : payment.status === 'COMPLETED' || payment.status === 'REFUNDED';
      if ((row.status === 'COMPLETED') !== oursDone && row.status !== 'PENDING') {
        push(result.statusMismatches, { ...view, kind, id: payment.id, ours: kind === 'refund' ? (payment.refundState ?? payment.status) : payment.status });
      }
      if (options.applyFees && kind === 'collection' && row.fee !== null && row.fee >= 0) {
        if (await this.deps.finance.recordStatementFee(payment.id, row.fee)) result.feesRecorded += 1;
      }
    }

    // Period for "in ours, not in the statement": given, or the statement's own date span.
    const dates = statement.flatMap((row) => (row.date === null ? [] : [row.date]));
    const from = options.from ?? (dates.length > 0 ? utcToEatDate(new Date(Math.min(...dates.map((d) => d.getTime())))) : null);
    const to = options.to ?? (dates.length > 0 ? utcToEatDate(new Date(Math.max(...dates.map((d) => d.getTime())))) : null);
    result.period = { from, to };
    if (from !== null && to !== null) {
      const { paid, refunded, payouts } = await this.load(from, to);
      for (const p of paid) {
        if (!seen.collection.has(p.id)) push(result.inOursNotAzamPay, { kind: 'collection', id: p.id, reference: p.aggregatorTransactionId, amountTzs: received(p), at: p.paidAt });
      }
      for (const p of refunded) {
        if (!seen.refund.has(p.id) && !(p.refundReference ?? '').startsWith('MANUAL:')) {
          push(result.inOursNotAzamPay, { kind: 'refund', id: p.id, reference: p.refundReference, amountTzs: p.refundAmountTzs ?? received(p), at: p.refundedAt });
        }
      }
      for (const i of payouts) {
        if (!seen.payout.has(i.id) && i.method === 'AZAMPAY') {
          push(result.inOursNotAzamPay, { kind: 'payout', id: i.id, reference: i.providerReference, amountTzs: i.amountTzs, at: i.paidAt });
        }
      }
    }

    await this.deps.auditLogs.append({
      actorUserId: adminUserId,
      action: 'RECONCILIATION_IMPORTED',
      resourceType: 'Payment',
      resourceId: null,
      ipAddress: null,
      userAgent: null,
      metadata: {
        rows: result.rows,
        matched: result.matched,
        inAzamPayNotOurs: result.inAzamPayNotOurs.length,
        inOursNotAzamPay: result.inOursNotAzamPay.length,
        amountMismatches: result.amountMismatches.length,
        statusMismatches: result.statusMismatches.length,
        feesRecorded: result.feesRecorded,
        importedAt: this.now().toISOString(),
      },
    });
    return result;
  }
}
