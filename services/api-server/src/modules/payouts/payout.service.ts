import type { DoctorPayoutAccount, PayoutBatch, PayoutItem, Prisma } from '@daktari/db';
import {
  MobileMoneyError,
  azamPayDisburseBankName,
  type AzamPayDisbursementCallbackBody,
  type MobileMoneyPort,
  type PayoutDestinationOperator,
  type QueryStatusResult,
} from '@daktari/payments';
import type { PayoutAccountInput } from '@daktari/schemas';
import type { SmsPort } from '@daktari/notifications';
import { ApiError, msg } from '../../lib/errors.js';
import type { AuditLogPort, DoctorRepoPort, PayoutRepoPort } from '../../lib/ports.js';
import type { FeeSettingsService } from '../payments/fee-settings.service.js';

/** In-flight disbursements younger than this are not queried yet. */
const STATUS_CHECK_AFTER_MS = 90_000;

const DOCTOR_NOT_FOUND = (): ApiError =>
  new ApiError(404, 'DOCTOR_NOT_FOUND', msg('Daktari hajapatikana', 'Doctor not found'));
const ITEM_NOT_FOUND = (): ApiError =>
  new ApiError(404, 'PAYOUT_ITEM_NOT_FOUND', msg('Malipo hayajapatikana', 'Payout item not found'));
const BATCH_NOT_FOUND = (): ApiError =>
  new ApiError(404, 'PAYOUT_RUN_NOT_FOUND', msg('Mzunguko wa malipo haujapatikana', 'Payout run not found'));

export interface PayoutAccountView {
  type: DoctorPayoutAccount['type'];
  operator: DoctorPayoutAccount['operator'];
  bankName: string | null;
  /** Masked: only the last 4 characters are shown. */
  accountNumberMasked: string;
  accountName: string | null;
  lookupName: string | null;
  status: DoctorPayoutAccount['status'];
  verifiedAt: Date | null;
  /** True when AzamPay can pay this account automatically; false ⇒ paid manually by an admin. */
  automaticPayout: boolean;
}

interface AccountSnapshot {
  type: DoctorPayoutAccount['type'];
  operator: DoctorPayoutAccount['operator'];
  bankName: string | null;
  accountNumber: string;
  name: string | null;
}

export interface PayoutServiceDeps {
  payouts: PayoutRepoPort;
  doctors: DoctorRepoPort;
  mobileMoney: MobileMoneyPort;
  fees: Pick<FeeSettingsService, 'ratesFor'>;
  sms: SmsPort;
  auditLogs: AuditLogPort;
}

export function maskAccount(accountNumber: string): string {
  return accountNumber.length <= 4 ? '••••' : `••••${accountNumber.slice(-4)}`;
}

function canPayAutomatically(account: Pick<DoctorPayoutAccount, 'type' | 'operator'>): boolean {
  return account.type === 'MOBILE_MONEY' && account.operator !== null && azamPayDisburseBankName(account.operator) !== null;
}

/**
 * Doctor payouts. Money-safety invariants:
 *  - an earning is reserved by at most ONE payout item (guarded updateMany on
 *    payoutItemId = null, inside the draft transaction);
 *  - an item is only SENT from PENDING (first send) or FAILED (retry), via a
 *    guarded transition that also mints a fresh reference p<attempt>-<itemId>
 *    — a PROCESSING item (sent, or outcome unknown) is never resent;
 *  - FAILED means AzamPay definitively refused (or cannot pay that
 *    destination); a timeout leaves the item PROCESSING for the status check;
 *  - "mark paid manually" requires a reference and is refused while a
 *    disbursement with a provider reference is still in flight.
 */
export class PayoutService {
  constructor(
    private readonly deps: PayoutServiceDeps,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── Doctor: payout account ─────────────────────────────────────────────────

  async getMyAccount(userId: string): Promise<{ account: PayoutAccountView | null }> {
    const doctor = await this.ownDoctor(userId);
    const account = await this.deps.payouts.findAccount(doctor.id);
    return { account: account === null ? null : PayoutService.accountView(account) };
  }

  /**
   * Save / change the payout account. ANY change resets verification: the
   * holder name is looked up with AzamPay and the doctor must confirm it; if
   * AzamPay cannot confirm it, an admin verifies by hand.
   */
  async setMyAccount(userId: string, input: PayoutAccountInput): Promise<{ account: PayoutAccountView }> {
    const doctor = await this.ownDoctor(userId);
    const before = await this.deps.payouts.findAccount(doctor.id);
    const operator = input.type === 'MOBILE_MONEY' ? input.operator : null;
    const bankName = input.type === 'BANK' ? input.bankName : null;
    const lookup = await this.lookup({ operator, bankName, accountNumber: input.accountNumber });
    const account = await this.deps.payouts.upsertAccount(doctor.id, {
      type: input.type,
      operator,
      bankName,
      accountNumber: input.accountNumber,
      accountName: input.type === 'BANK' ? input.accountName : null,
      lookupName: lookup.name,
      status: lookup.name !== null ? 'NAME_PENDING_CONFIRMATION' : 'LOOKUP_FAILED',
      verifiedAt: null,
      verifiedByUserId: null,
    });
    await this.audit(userId, 'PAYOUT_ACCOUNT_CHANGED', 'DoctorPayoutAccount', account.id, {
      before:
        before === null
          ? null
          : { type: before.type, operator: before.operator, bankName: before.bankName, account: maskAccount(before.accountNumber) },
      after: { type: account.type, operator, bankName, account: maskAccount(account.accountNumber) },
      lookup: lookup.name !== null ? 'found' : lookup.reason,
    });
    return { account: PayoutService.accountView(account) };
  }

  /** Retry the AzamPay name lookup (e.g. it was unavailable when the account was saved). */
  async retryMyLookup(userId: string): Promise<{ account: PayoutAccountView }> {
    const doctor = await this.ownDoctor(userId);
    const account = await this.deps.payouts.findAccount(doctor.id);
    if (!account) throw PayoutService.noAccount();
    if (account.status === 'VERIFIED') return { account: PayoutService.accountView(account) };
    const lookup = await this.lookup(account);
    const updated = await this.deps.payouts.updateAccount(doctor.id, {
      lookupName: lookup.name,
      status: lookup.name !== null ? 'NAME_PENDING_CONFIRMATION' : 'LOOKUP_FAILED',
    });
    return { account: PayoutService.accountView(updated) };
  }

  /** The doctor confirms that the name AzamPay returned is theirs. */
  async confirmMyAccount(userId: string, confirmedName: string): Promise<{ account: PayoutAccountView }> {
    const doctor = await this.ownDoctor(userId);
    const account = await this.deps.payouts.findAccount(doctor.id);
    if (!account) throw PayoutService.noAccount();
    const normalise = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();
    if (
      account.status !== 'NAME_PENDING_CONFIRMATION' ||
      account.lookupName === null ||
      normalise(account.lookupName) !== normalise(confirmedName)
    ) {
      throw new ApiError(
        409,
        'PAYOUT_ACCOUNT_NOT_CONFIRMABLE',
        msg(
          'Jina halilingani na lililothibitishwa na mtoa huduma — hifadhi akaunti tena',
          'The name does not match the provider lookup — save the account again',
        ),
      );
    }
    const updated = await this.deps.payouts.updateAccount(doctor.id, { status: 'VERIFIED', verifiedAt: this.now() });
    await this.audit(userId, 'PAYOUT_ACCOUNT_CONFIRMED', 'DoctorPayoutAccount', account.id, {
      account: maskAccount(account.accountNumber),
    });
    return { account: PayoutService.accountView(updated) };
  }

  // ── Admin: account verification ────────────────────────────────────────────

  async accountsNeedingReview(): Promise<{
    items: Array<PayoutAccountView & { doctorId: string; doctorName: string | null }>;
  }> {
    const accounts = await this.deps.payouts.listAccountsNeedingReview();
    const items = [];
    for (const account of accounts) {
      const doctor = await this.deps.doctors.findByIdWithUser(account.doctorId);
      items.push({ ...PayoutService.accountView(account), doctorId: account.doctorId, doctorName: doctor?.user.fullName ?? null });
    }
    return { items };
  }

  /** Manual verification when AzamPay could not confirm the holder (audited). */
  async adminVerifyAccount(adminUserId: string, doctorId: string, note: string): Promise<{ account: PayoutAccountView }> {
    const account = await this.deps.payouts.findAccount(doctorId);
    if (!account) throw PayoutService.noAccount();
    const updated = await this.deps.payouts.updateAccount(doctorId, {
      status: 'VERIFIED',
      verifiedAt: this.now(),
      verifiedByUserId: adminUserId,
    });
    await this.audit(adminUserId, 'PAYOUT_ACCOUNT_VERIFIED_MANUALLY', 'DoctorPayoutAccount', account.id, {
      note,
      account: maskAccount(account.accountNumber),
      previousStatus: account.status,
    });
    return { account: PayoutService.accountView(updated) };
  }

  // ── Admin: payout runs ─────────────────────────────────────────────────────

  /** Per-doctor totals of owed (PENDING, unreserved) earnings before the cutoff. */
  async preview(cutoff: Date | undefined): Promise<{
    cutoff: Date;
    minPayoutTzs: number;
    rows: Array<{
      doctorId: string;
      doctorName: string | null;
      netTzs: number;
      earningsCount: number;
      accountStatus: DoctorPayoutAccount['status'] | null;
      automaticPayout: boolean;
      eligible: boolean;
      reason: 'OK' | 'NO_ACCOUNT' | 'ACCOUNT_NOT_VERIFIED' | 'BELOW_MINIMUM';
    }>;
    eligibleTotalTzs: number;
  }> {
    const at = cutoff ?? this.now();
    const { minPayoutTzs } = await this.deps.fees.ratesFor(null);
    const summaries = await this.deps.payouts.pendingEarningsByDoctor(at);
    const rows = [];
    let eligibleTotalTzs = 0;
    for (const summary of summaries) {
      const [doctor, account] = await Promise.all([
        this.deps.doctors.findByIdWithUser(summary.doctorId),
        this.deps.payouts.findAccount(summary.doctorId),
      ]);
      const reason =
        account === null
          ? 'NO_ACCOUNT'
          : account.status !== 'VERIFIED'
            ? 'ACCOUNT_NOT_VERIFIED'
            : summary.netTzs < minPayoutTzs
              ? 'BELOW_MINIMUM'
              : 'OK';
      if (reason === 'OK') eligibleTotalTzs += summary.netTzs;
      rows.push({
        doctorId: summary.doctorId,
        doctorName: doctor?.user.fullName ?? null,
        netTzs: summary.netTzs,
        earningsCount: summary.count,
        accountStatus: account?.status ?? null,
        automaticPayout: account !== null && canPayAutomatically(account),
        eligible: reason === 'OK',
        reason,
      } as const);
    }
    rows.sort((a, b) => b.netTzs - a.netTzs);
    return { cutoff: at, minPayoutTzs, rows, eligibleTotalTzs };
  }

  /** DRAFT run: reserves eligible doctors' earnings; nothing is sent until approval. */
  async createRun(adminUserId: string, cutoff: Date | undefined, note: string | undefined) {
    const preview = await this.preview(cutoff);
    const eligible = preview.rows.filter((row) => row.eligible);
    if (eligible.length === 0) {
      throw new ApiError(
        409,
        'NOTHING_TO_PAY',
        msg('Hakuna daktari anayestahili kulipwa kwa sasa', 'No doctor is eligible for a payout right now'),
      );
    }
    const doctors = [];
    for (const row of eligible) {
      const account = await this.deps.payouts.findAccount(row.doctorId);
      if (account) doctors.push({ doctorId: row.doctorId, accountSnapshot: PayoutService.snapshot(account) as unknown as Prisma.InputJsonValue });
    }
    const batch = await this.deps.payouts.createDraftBatch({
      cutoff: preview.cutoff,
      createdByUserId: adminUserId,
      note: note ?? null,
      doctors,
      minPayoutTzs: preview.minPayoutTzs,
    });
    await this.audit(adminUserId, 'PAYOUT_RUN_CREATED', 'PayoutBatch', batch.id, {
      cutoff: preview.cutoff.toISOString(),
      totalTzs: batch.totalTzs,
      itemCount: batch.itemCount,
    });
    return this.batchView(batch.id);
  }

  async cancelRun(adminUserId: string, batchId: string) {
    const cancelled = await this.deps.payouts.transitionBatch(batchId, ['DRAFT'], { status: 'CANCELLED' });
    if (!cancelled) throw PayoutService.batchState();
    await this.deps.payouts.releaseBatch(batchId);
    await this.audit(adminUserId, 'PAYOUT_RUN_CANCELLED', 'PayoutBatch', batchId, {});
    return this.batchView(batchId);
  }

  /** Approve a DRAFT run and send every item through AzamPay disbursement. */
  async approveRun(adminUserId: string, batchId: string) {
    const approved = await this.deps.payouts.transitionBatch(batchId, ['DRAFT'], {
      status: 'PROCESSING',
      approvedByUserId: adminUserId,
      approvedAt: this.now(),
    });
    if (!approved) throw PayoutService.batchState();
    await this.audit(adminUserId, 'PAYOUT_RUN_APPROVED', 'PayoutBatch', batchId, {
      totalTzs: approved.totalTzs,
      itemCount: approved.itemCount,
    });
    const batch = await this.deps.payouts.findBatch(batchId);
    for (const item of batch?.items ?? []) {
      await this.sendItem(item, adminUserId);
    }
    return this.batchView(batchId);
  }

  async retryItem(adminUserId: string, itemId: string) {
    const item = await this.deps.payouts.findItem(itemId);
    if (!item) throw ITEM_NOT_FOUND();
    if (item.status !== 'FAILED') {
      throw new ApiError(
        409,
        'PAYOUT_NOT_RETRYABLE',
        msg('Malipo haya hayawezi kujaribiwa tena', 'Only a FAILED payout can be retried'),
        { status: item.status },
      );
    }
    await this.sendItem(item, adminUserId);
    return this.batchView(item.batchId);
  }

  /**
   * Paid outside AzamPay (M-Pesa / bank / confirmed by phone with AzamPay).
   * Allowed from FAILED, or from PROCESSING only when no disbursement
   * reference exists (outcome unknown) — never while a known disbursement is
   * in flight, which could otherwise pay the doctor twice.
   */
  async markItemPaid(adminUserId: string, itemId: string, reference: string, note: string) {
    const item = await this.deps.payouts.findItem(itemId);
    if (!item) throw ITEM_NOT_FOUND();
    const allowed = item.status === 'FAILED' || (item.status === 'PROCESSING' && item.providerReference === null);
    if (!allowed) {
      throw new ApiError(
        409,
        'PAYOUT_NOT_MARKABLE',
        msg(
          'Malipo haya hayawezi kuwekwa kuwa yamelipwa kwa mkono kwa sasa',
          'This payout cannot be marked paid manually in its current state',
        ),
        { status: item.status },
      );
    }
    const paid = await this.deps.payouts.transitionItem(item.id, [item.status], {
      status: 'PAID',
      method: 'MANUAL',
      manualReference: reference,
      failureReason: null,
      paidAt: this.now(),
    });
    if (!paid) throw ITEM_NOT_FOUND();
    await this.deps.payouts.setItemEarnings(item.id, { status: 'PAID', paidAt: this.now(), failureReason: null });
    await this.audit(adminUserId, 'PAYOUT_MARKED_PAID', 'PayoutItem', item.id, {
      reference,
      note,
      amountTzs: item.amountTzs,
      previousStatus: item.status,
    });
    await this.afterPaid(paid);
    return this.batchView(item.batchId);
  }

  async listRuns(): Promise<{ items: PayoutBatch[] }> {
    return { items: await this.deps.payouts.listBatches(30) };
  }

  async batchView(batchId: string) {
    const batch = await this.deps.payouts.findBatch(batchId);
    if (!batch) throw BATCH_NOT_FOUND();
    const items = [];
    for (const item of batch.items) {
      const doctor = await this.deps.doctors.findByIdWithUser(item.doctorId);
      const snapshot = item.accountSnapshot as unknown as AccountSnapshot | null;
      items.push({
        id: item.id,
        doctorId: item.doctorId,
        doctorName: doctor?.user.fullName ?? null,
        amountTzs: item.amountTzs,
        status: item.status,
        attempt: item.attempt,
        reference: item.reference,
        providerReference: item.providerReference,
        failureReason: item.failureReason,
        method: item.method,
        manualReference: item.manualReference,
        paidAt: item.paidAt,
        account:
          snapshot === null
            ? null
            : {
                type: snapshot.type,
                operator: snapshot.operator,
                bankName: snapshot.bankName,
                accountNumberMasked: maskAccount(snapshot.accountNumber),
                name: snapshot.name,
                automaticPayout: canPayAutomatically(snapshot),
              },
      });
    }
    const { items: _items, ...summary } = batch;
    return { ...summary, items };
  }

  // ── Doctor: payout history ─────────────────────────────────────────────────

  async myPayouts(userId: string) {
    const doctor = await this.ownDoctor(userId);
    const items = await this.deps.payouts.listItemsForDoctor(doctor.id, 20);
    return {
      items: items.map((item) => ({
        id: item.id,
        amountTzs: item.amountTzs,
        status: item.status,
        method: item.method,
        failureReason: item.failureReason,
        paidAt: item.paidAt,
        createdAt: item.createdAt,
      })),
    };
  }

  // ── Sending + reconciliation ───────────────────────────────────────────────

  private async sendItem(item: PayoutItem, actorUserId: string | null): Promise<void> {
    const attempt = item.attempt + 1;
    const reference = `p${attempt}-${item.id}`;
    const account = await this.deps.payouts.findAccount(item.doctorId);
    const claimed = await this.deps.payouts.transitionItem(item.id, ['PENDING', 'FAILED'], {
      status: 'PROCESSING',
      attempt,
      reference,
      providerReference: null,
      failureReason: null,
      method: 'AZAMPAY',
      ...(account !== null ? { accountSnapshot: PayoutService.snapshot(account) as unknown as Prisma.InputJsonValue } : {}),
    });
    if (!claimed) return; // already sending / paid — never twice
    await this.deps.payouts.setItemEarnings(item.id, { status: 'PROCESSING', failureReason: null });

    if (account === null || account.status !== 'VERIFIED') {
      await this.failItem(claimed, 'payout account not verified', actorUserId);
      return;
    }
    if (!canPayAutomatically(account) || account.operator === null) {
      await this.failItem(
        claimed,
        `MANUAL_REQUIRED: AzamPay disbursement cannot pay ${account.type === 'BANK' ? 'bank accounts' : account.operator}; pay manually and mark paid`,
        actorUserId,
      );
      return;
    }
    try {
      const result = await this.deps.mobileMoney.disburse({
        operator: account.operator as PayoutDestinationOperator,
        accountNumber: account.accountNumber,
        accountName: account.lookupName ?? account.accountName ?? '',
        amountTzs: item.amountTzs,
        reference,
        remarks: 'Daktari Mkononi doctor payout',
      });
      if (result.status === 'FAILED' || result.providerReference === null) {
        await this.failItem(claimed, result.message ?? 'disbursement rejected by provider', actorUserId);
        return;
      }
      await this.deps.payouts.transitionItem(item.id, ['PROCESSING'], { providerReference: result.providerReference });
      await this.audit(actorUserId, 'PAYOUT_SENT', 'PayoutItem', item.id, { attempt, amountTzs: item.amountTzs });
    } catch (error) {
      if (error instanceof MobileMoneyError && error.code === 'OUTCOME_UNKNOWN') {
        // May have been paid: stays PROCESSING, never resent; the callback
        // (matched on our reference) or an admin with AzamPay's answer settles it.
        await this.audit(actorUserId, 'PAYOUT_OUTCOME_UNKNOWN', 'PayoutItem', item.id, { attempt });
        return;
      }
      const reason =
        error instanceof MobileMoneyError
          ? error.code === 'UNSUPPORTED_DESTINATION' || error.code === 'NOT_CONFIGURED'
            ? `MANUAL_REQUIRED: ${error.code}`
            : error.code
          : 'UNKNOWN';
      await this.failItem(claimed, reason, actorUserId);
    }
  }

  private async failItem(item: PayoutItem, reason: string, actorUserId: string | null): Promise<void> {
    const failed = await this.deps.payouts.transitionItem(item.id, ['PROCESSING'], {
      status: 'FAILED',
      failureReason: reason,
    });
    if (!failed) return;
    await this.deps.payouts.setItemEarnings(item.id, { status: 'FAILED', failureReason: reason });
    await this.audit(actorUserId, 'PAYOUT_FAILED', 'PayoutItem', item.id, { reason, attempt: item.attempt });
  }

  private async markProviderPaid(item: PayoutItem, status: QueryStatusResult): Promise<boolean> {
    const paid = await this.deps.payouts.transitionItem(item.id, ['PROCESSING'], {
      status: 'PAID',
      paidAt: this.now(),
      ...(status.providerFeeTzs !== undefined ? { providerFeeTzs: status.providerFeeTzs } : {}),
    });
    if (!paid) return false;
    await this.deps.payouts.setItemEarnings(item.id, { status: 'PAID', paidAt: this.now() });
    await this.audit(null, 'PAYOUT_PAID', 'PayoutItem', item.id, { amountTzs: item.amountTzs });
    await this.afterPaid(paid);
    return true;
  }

  private async reconcileItem(item: PayoutItem): Promise<boolean> {
    if (item.status !== 'PROCESSING' || item.providerReference === null) return false;
    const snapshot = item.accountSnapshot as unknown as AccountSnapshot | null;
    const bankName = snapshot?.operator ? azamPayDisburseBankName(snapshot.operator) : null;
    let status: QueryStatusResult;
    try {
      status = await this.deps.mobileMoney.queryDisbursementStatus(
        item.providerReference,
        bankName !== null ? { bankName } : {},
      );
    } catch {
      await this.deps.payouts.transitionItem(item.id, ['PROCESSING'], { lastStatusCheckAt: this.now() });
      return false;
    }
    if (status.status === 'PENDING') {
      await this.deps.payouts.transitionItem(item.id, ['PROCESSING'], { lastStatusCheckAt: this.now() });
      return false;
    }
    if (status.status === 'COMPLETED') return this.markProviderPaid(item, status);
    await this.failItem(item, status.failureReason ?? 'reported failed by provider', null);
    return true;
  }

  /** Sweep: query in-flight disbursements (same rule as payments: status API decides). */
  async reconcilePayouts(): Promise<number> {
    const items = await this.deps.payouts.listItemsInFlight(new Date(this.now().getTime() - STATUS_CHECK_AFTER_MS));
    let settled = 0;
    for (const item of items) {
      if (await this.reconcileItem(item).catch(() => false)) settled += 1;
    }
    return settled;
  }

  /**
   * Disbursement callback for a payout. The body is never trusted (AzamPay
   * documents no signature for it): it only triggers a status query.
   */
  async handleDisbursementCallback(
    body: AzamPayDisbursementCallbackBody,
  ): Promise<{ outcome: 'applied' | 'pending' | 'unknown-reference' }> {
    let item = body.pgReferenceId !== undefined ? await this.deps.payouts.findItemByProviderReference(body.pgReferenceId) : null;
    if (!item && body.initiatorReferenceId !== undefined) {
      item = await this.deps.payouts.findItemByReference(body.initiatorReferenceId);
      if (item && item.providerReference === null && body.pgReferenceId !== undefined) {
        item = await this.deps.payouts.transitionItem(item.id, ['PROCESSING'], { providerReference: body.pgReferenceId });
      }
    }
    if (!item) {
      await this.audit(null, 'WEBHOOK_UNKNOWN_REFERENCE', 'PayoutItem', null, {
        pgReferenceId: body.pgReferenceId ?? null,
        initiatorReferenceId: body.initiatorReferenceId ?? null,
      });
      return { outcome: 'unknown-reference' };
    }
    return { outcome: (await this.reconcileItem(item)) ? 'applied' : 'pending' };
  }

  private async afterPaid(item: PayoutItem): Promise<void> {
    if ((await this.deps.payouts.countUnpaidItems(item.batchId)) === 0) {
      await this.deps.payouts.transitionBatch(item.batchId, ['PROCESSING'], { status: 'COMPLETED' });
    }
    const doctor = await this.deps.doctors.findByIdWithUser(item.doctorId);
    if (doctor) {
      await this.deps.sms.sendSms(
        doctor.user.phone,
        doctor.user.language === 'EN'
          ? `Daktari Mkononi: your payout of TZS ${item.amountTzs} has been sent.`
          : `Daktari Mkononi: malipo yako ya TZS ${item.amountTzs} yametumwa.`,
      );
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async lookup(account: {
    operator: DoctorPayoutAccount['operator'];
    bankName: string | null;
    accountNumber: string;
  }): Promise<{ name: string | null; reason: string }> {
    try {
      const result = await this.deps.mobileMoney.nameLookup({
        operator: account.operator,
        bankName: account.bankName,
        accountNumber: account.accountNumber,
      });
      return result.found && result.name !== null ? { name: result.name, reason: 'found' } : { name: null, reason: 'not-found' };
    } catch (error) {
      return { name: null, reason: error instanceof MobileMoneyError ? error.code : 'UNKNOWN' };
    }
  }

  private async ownDoctor(userId: string) {
    const doctor = await this.deps.doctors.findByUserId(userId);
    if (!doctor) throw DOCTOR_NOT_FOUND();
    return doctor;
  }

  private static snapshot(account: DoctorPayoutAccount): AccountSnapshot {
    return {
      type: account.type,
      operator: account.operator,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      name: account.lookupName ?? account.accountName,
    };
  }

  private static accountView(account: DoctorPayoutAccount): PayoutAccountView {
    return {
      type: account.type,
      operator: account.operator,
      bankName: account.bankName,
      accountNumberMasked: maskAccount(account.accountNumber),
      accountName: account.accountName,
      lookupName: account.lookupName,
      status: account.status,
      verifiedAt: account.verifiedAt,
      automaticPayout: canPayAutomatically(account),
    };
  }

  private static noAccount(): ApiError {
    return new ApiError(
      404,
      'PAYOUT_ACCOUNT_NOT_FOUND',
      msg('Hujaweka akaunti ya kupokea malipo', 'No payout account saved yet'),
    );
  }

  private static batchState(): ApiError {
    return new ApiError(
      409,
      'PAYOUT_RUN_STATE',
      msg('Mzunguko huu wa malipo hauko katika hali ya rasimu', 'This payout run is not a draft'),
    );
  }

  private audit(
    actorUserId: string | null,
    action: string,
    resourceType: string,
    resourceId: string | null,
    metadata: Record<string, unknown>,
  ): Promise<unknown> {
    return this.deps.auditLogs.append({
      actorUserId,
      action,
      resourceType,
      resourceId,
      ipAddress: null,
      userAgent: null,
      metadata: metadata as Prisma.InputJsonValue,
    });
  }
}

/** Interval wiring for payout status checks — production only; tests call directly. */
export function startPayoutReconciliation(
  service: PayoutService,
  intervalMs = 60_000,
  onError: (error: unknown) => void = () => undefined,
): () => void {
  const timer = setInterval(() => {
    service.reconcilePayouts().catch(onError);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
