import { randomBytes } from 'node:crypto';
import type { Appointment, Payment, PaymentMethod } from '@daktari/db';
import {
  MobileMoneyError,
  deriveMno,
  splitFee,
  type MobileMoneyPort,
} from '@daktari/payments';
import type { AdminPaymentsQuery, Pagination } from '@daktari/schemas';
import type { SmsPort } from '@daktari/notifications';
import { ApiError, msg } from '../../lib/errors.js';
import type {
  AppointmentRepoPort,
  AuditLogPort,
  DoctorPaymentRepoPort,
  DoctorRepoPort,
  PatientRepoPort,
  PaymentPort,
  PaymentRepoPort,
} from '../../lib/ports.js';
import { findAppointmentTransition } from '../appointments/appointment.machine.js';

const PAYMENT_NOT_FOUND = (): ApiError =>
  new ApiError(404, 'PAYMENT_NOT_FOUND', msg('Malipo hayajapatikana', 'Payment not found'));

export interface PaymentView {
  id: string;
  appointmentId: string | null;
  amountTzs: number;
  platformFeeTzs: number;
  doctorAmountTzs: number;
  method: Payment['method'];
  status: Payment['status'];
  attempt: number;
  failureReason: string | null;
  refundPending: boolean;
  refundState: Payment['refundState'];
  refundAmountTzs: number | null;
  receivedAmountTzs: number | null;
  reviewReason: Payment['reviewReason'];
  reviewNote: string | null;
  reviewFlaggedAt: Date | null;
  reviewResolvedAt: Date | null;
  abandonedAt: Date | null;
  paidAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
}

export interface PaymentResultInput {
  status: 'COMPLETED' | 'FAILED';
  providerReference: string;
  failureReason?: string;
  /** Whole TZS the provider says it collected, when it says. */
  amountTzs?: number;
}

/** Appointment states that mean "this payment already bought something". */
const SETTLED_APPOINTMENT_STATUSES: ReadonlySet<string> = new Set([
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
]);

/** Abandoned payments still not final after this long go to the admin review queue. */
const ABANDONED_ALERT_AFTER_MS = 24 * 60 * 60_000;

export interface PaymentServiceDeps {
  payments: PaymentRepoPort;
  doctorPayments: DoctorPaymentRepoPort;
  appointments: AppointmentRepoPort;
  patients: PatientRepoPort;
  doctors: DoctorRepoPort;
  mobileMoney: MobileMoneyPort;
  sms: SmsPort;
  auditLogs: AuditLogPort;
}

const METHOD_BY_NETWORK: Record<string, PaymentMethod> = {
  VODACOM: 'MPESA',
  TIGO: 'TIGO_PESA',
  AIRTEL: 'AIRTEL_MONEY',
  HALOTEL: 'HALOPESA',
};

/**
 * All money flows go through this service. Idempotency invariants:
 * one Payment row per appointment; `idempotencyKey = appointmentId:attempt`;
 * every status change is a guarded transition, so webhook replays and
 * reconciliation races collapse to no-ops instead of double-applying.
 */
export class PaymentService implements PaymentPort {
  constructor(
    private readonly deps: PaymentServiceDeps,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── Initiation ─────────────────────────────────────────────────────────────

  /**
   * PaymentPort entry point used by the booking flow: create the Payment row
   * and start collection attempt 1. Initiation failures never fail the
   * booking — the patient retries via POST /appointments/:id/pay.
   */
  async initiateMobileMoney(input: {
    appointmentId: string;
    patientId: string;
    amountTzs: number;
    payerPhone: string;
  }): Promise<{ reference: string }> {
    let payment = await this.deps.payments.findByAppointmentId(input.appointmentId);
    if (!payment) {
      const split = splitFee(input.amountTzs);
      payment = await this.deps.payments.create({
        patientId: input.patientId,
        appointmentId: input.appointmentId,
        amountTzs: input.amountTzs,
        platformFeeTzs: split.platformFeeTzs,
        doctorAmountTzs: split.doctorAmountTzs,
        method: METHOD_BY_NETWORK[deriveMno(input.payerPhone)?.network ?? ''] ?? 'MPESA',
        idempotencyKey: `${input.appointmentId}:1`,
        payerPhone: input.payerPhone,
      });
    }
    try {
      await this.collect(payment);
    } catch (error) {
      // Booking must not fail because the wallet call did; audit and move on.
      const code = error instanceof MobileMoneyError ? error.code : 'PROVIDER_ERROR';
      await this.audit(null, 'PAYMENT_INITIATION_FAILED', payment.id, { code });
    }
    return { reference: payment.id };
  }

  /**
   * POST /appointments/:id/pay — explicit (re-)initiation by the patient.
   * PROCESSING → returns the current state with no new collection call.
   * FAILED → a fresh attempt while the appointment is still payable.
   */
  async payForAppointment(userId: string, appointmentId: string): Promise<PaymentView> {
    const patient = await this.deps.patients.findByUserId(userId);
    const appointment = await this.deps.appointments.findById(appointmentId);
    if (!patient || !appointment || appointment.patientId !== patient.id) {
      throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', msg('Miadi haijapatikana', 'Appointment not found'));
    }
    if (appointment.paymentIntent !== 'MOBILE_MONEY' || appointment.status !== 'PENDING_PAYMENT') {
      throw new ApiError(
        409,
        'NOT_PAYABLE',
        msg('Miadi hii hailipiki kwa sasa', 'This appointment is not payable right now'),
        { status: appointment.status, paymentIntent: appointment.paymentIntent },
      );
    }
    if (appointment.expiresAt !== null && appointment.expiresAt.getTime() <= this.now().getTime()) {
      throw new ApiError(
        409,
        'APPOINTMENT_EXPIRED',
        msg('Muda wa kulipia miadi hii umeisha', 'The payment window for this appointment has expired'),
      );
    }

    let payment = await this.deps.payments.findByAppointmentId(appointmentId);
    if (payment && payment.status === 'PROCESSING') {
      return this.toView(payment); // idempotent: no second collection
    }
    if (payment && (payment.status === 'COMPLETED' || payment.status === 'REFUNDED')) {
      return this.toView(payment);
    }

    const user = await this.deps.patients.findByIdWithUser(patient.id);
    const payerPhone = user?.user.phone ?? '';
    if (!payment) {
      const doctor = await this.deps.doctors.findById(appointment.doctorId);
      const amountTzs = doctor?.consultationFeeTzs ?? 0;
      const split = splitFee(amountTzs);
      payment = await this.deps.payments.create({
        patientId: patient.id,
        appointmentId,
        amountTzs,
        platformFeeTzs: split.platformFeeTzs,
        doctorAmountTzs: split.doctorAmountTzs,
        method: METHOD_BY_NETWORK[deriveMno(payerPhone)?.network ?? ''] ?? 'MPESA',
        idempotencyKey: `${appointmentId}:1`,
        payerPhone,
      });
    } else if (payment.status === 'FAILED') {
      // New attempt: bump the attempt counter and clear the failure.
      payment = await this.deps.payments.update(payment.id, {
        status: 'PENDING',
        attempt: payment.attempt + 1,
        idempotencyKey: `${appointmentId}:${payment.attempt + 1}`,
        failureReason: null,
        aggregatorTransactionId: null,
      });
    }

    try {
      payment = await this.collect(payment);
    } catch (error) {
      if (error instanceof MobileMoneyError) {
        await this.audit(userId, 'PAYMENT_INITIATION_FAILED', payment.id, { code: error.code });
        throw new ApiError(
          error.code === 'INVALID_MSISDN' ? 400 : 503,
          error.code,
          msg(
            'Malipo hayakuweza kuanzishwa — jaribu tena baadaye',
            'The payment could not be initiated — try again later',
          ),
        );
      }
      throw error;
    }
    return this.toView(payment);
  }

  /** Start the wallet collection and move the Payment to PROCESSING. */
  private async collect(payment: Payment): Promise<Payment> {
    const result = await this.deps.mobileMoney.initiateCollection({
      phoneE164: payment.payerPhone ?? '',
      amountTzs: payment.amountTzs,
      currency: 'TZS',
      externalReference: payment.idempotencyKey,
      description: 'Daktari Mkononi consultation',
    });
    if (result.status === 'FAILED') {
      return (
        (await this.deps.payments.transitionStatus(payment.id, ['PENDING', 'PROCESSING'], {
          status: 'FAILED',
          aggregatorTransactionId: result.providerReference,
          failureReason: 'collection rejected by provider',
        })) ?? payment
      );
    }
    return (
      (await this.deps.payments.transitionStatus(payment.id, ['PENDING', 'FAILED'], {
        status: 'PROCESSING',
        aggregatorTransactionId: result.providerReference,
      })) ?? payment
    );
  }

  // ── Terminal results (webhook + reconciliation share this path) ────────────

  /**
   * Apply a terminal provider answer. SHARED by the webhook and the
   * reconciliation job so the two paths cannot diverge. Idempotent: replays
   * of a terminal event find the guard already consumed and no-op.
   *
   * A success is recorded as COMPLETED whatever happens next — the money DID
   * move — but it only confirms the appointment while that appointment is
   * still payable. Otherwise (expired, cancelled, gone) it is a LATE SUCCESS:
   * flagged for admins, the patient is told, and a full refund starts.
   */
  async applyPaymentResult(
    payment: Payment,
    result: PaymentResultInput,
    source: 'webhook' | 'reconciliation',
  ): Promise<{ applied: boolean }> {
    if (result.status === 'COMPLETED') {
      const applied = await this.deps.payments.transitionStatus(
        payment.id,
        ['PENDING', 'PROCESSING'],
        {
          status: 'COMPLETED',
          paidAt: this.now(),
          externalReference: result.providerReference,
          receivedAmountTzs: result.amountTzs ?? payment.amountTzs,
        },
      );
      if (!applied) return { applied: false }; // replay / race → no-op

      await this.audit(null, 'PAYMENT_COMPLETED', payment.id, { source });
      await this.settle(applied);
      return { applied: true };
    }

    const applied = await this.deps.payments.transitionStatus(payment.id, ['PENDING', 'PROCESSING'], {
      status: 'FAILED',
      failureReason: result.failureReason ?? 'reported failed by provider',
    });
    if (!applied) return { applied: false };
    await this.audit(null, 'PAYMENT_FAILED', payment.id, {
      source,
      reason: result.failureReason ?? null,
    });
    // The appointment stays PENDING_PAYMENT; the expiry sweep remains the cleanup.
    return { applied: true };
  }

  /** Decide what a freshly COMPLETED payment buys: a confirmation, or a refund. */
  private async settle(payment: Payment): Promise<void> {
    if (payment.appointmentId === null) return;
    const appointment = await this.deps.appointments.findById(payment.appointmentId);
    if (appointment && SETTLED_APPOINTMENT_STATUSES.has(appointment.status)) return;

    const payable =
      appointment !== null &&
      appointment.status === 'PENDING_PAYMENT' &&
      appointment.paymentIntent === 'MOBILE_MONEY' &&
      (appointment.expiresAt === null || appointment.expiresAt.getTime() > this.now().getTime());
    if (payable && (await this.confirmAppointment(appointment))) return;

    // Lost a race with the expiry sweep / a cancel, or never payable at all.
    const current = payable ? await this.deps.appointments.findById(appointment.id) : appointment;
    if (current && SETTLED_APPOINTMENT_STATUSES.has(current.status)) return;
    await this.handleLateSuccess(payment, current);
  }

  private async handleLateSuccess(payment: Payment, appointment: Appointment | null): Promise<void> {
    const why =
      appointment === null
        ? 'APPOINTMENT_MISSING'
        : appointment.status === 'PENDING_PAYMENT'
          ? 'APPOINTMENT_EXPIRED'
          : `APPOINTMENT_${appointment.status}`;
    const flagged = await this.flagForReview(payment, 'LATE_SUCCESS', why);
    await this.notifyLateSuccess(flagged);
    await this.refundPayment(flagged, `late-success: ${why}`, null);
  }

  /**
   * Admin alert: the payment enters the review queue (GET
   * /admin/payments/review) and the audit log records why. Re-flagging an
   * already-open item keeps the first reason.
   */
  private async flagForReview(
    payment: Payment,
    reason: NonNullable<Payment['reviewReason']>,
    note: string,
  ): Promise<Payment> {
    if (payment.reviewReason !== null && payment.reviewResolvedAt === null) return payment;
    const flagged = await this.deps.payments.update(payment.id, {
      reviewReason: reason,
      reviewNote: note,
      reviewFlaggedAt: this.now(),
      reviewResolvedAt: null,
      reviewResolvedByUserId: null,
    });
    await this.audit(null, 'PAYMENT_REVIEW_FLAGGED', payment.id, {
      reason,
      note,
      amountTzs: payment.amountTzs,
      receivedAmountTzs: flagged.receivedAmountTzs,
    });
    return flagged;
  }

  /** Returns true when THIS call moved the appointment to CONFIRMED. */
  private async confirmAppointment(appointment: Appointment): Promise<boolean> {
    const transition = findAppointmentTransition('PAYMENT_COMPLETED', appointment.status);
    if (!transition) return false;
    const applied = await this.deps.appointments.transition(appointment.id, transition.from, {
      status: transition.to,
      confirmedAt: this.now(),
      expiresAt: null,
      pendingReason: null,
      ...(appointment.type === 'IN_PERSON' && appointment.checkInToken === null
        ? { checkInToken: PaymentService.mintCheckInToken() }
        : {}),
    });
    if (!applied) return false;
    await this.deps.auditLogs.append({
      actorUserId: null,
      action: 'APPOINTMENT_TRANSITION',
      resourceType: 'Appointment',
      resourceId: appointment.id,
      ipAddress: null,
      userAgent: null,
      metadata: { event: 'PAYMENT_COMPLETED', from: transition.from, to: transition.to },
    });
    return true;
  }

  private static mintCheckInToken(): string {
    return randomBytes(24).toString('base64url');
  }

  // ── Abandonment (appointment no longer payable) ────────────────────────────

  /**
   * Called when an unpaid booking expires or is cancelled. A PROCESSING
   * payment may still succeed on the patient's phone, so it is never closed
   * here: it is marked abandoned and reconciliation keeps querying it until
   * the provider gives a final answer (late success ⇒ refund). A PENDING
   * payment never reached the provider and can safely be failed.
   */
  async abandonIfUnpaid(appointmentId: string, reason: string): Promise<void> {
    const payment = await this.deps.payments.findByAppointmentId(appointmentId);
    if (!payment) return;
    if (payment.status === 'PROCESSING' && payment.abandonedAt === null) {
      await this.deps.payments.update(payment.id, { abandonedAt: this.now() });
      await this.audit(null, 'PAYMENT_ABANDONED', payment.id, { reason });
      return;
    }
    if (payment.status === 'PENDING') {
      const failed = await this.deps.payments.transitionStatus(payment.id, ['PENDING'], {
        status: 'FAILED',
        failureReason: `abandoned before collection: ${reason}`,
        abandonedAt: this.now(),
      });
      if (failed) await this.audit(null, 'PAYMENT_ABANDONED', payment.id, { reason, closed: true });
    }
  }

  // ── Webhook ────────────────────────────────────────────────────────────────

  /** Body is already signature-verified and Zod-validated by the route. */
  async handleWebhook(body: {
    transactionId: string;
    externalReference: string;
    status: 'success' | 'failure';
    message?: string | undefined;
  }): Promise<{ outcome: 'applied' | 'noop' | 'unknown-reference' }> {
    const payment =
      (await this.deps.payments.findByIdempotencyKey(body.externalReference)) ??
      (await this.deps.payments.findByProviderReference(body.transactionId));
    if (!payment) {
      // 200 regardless — never teach the provider to retry unknowns.
      await this.audit(null, 'WEBHOOK_UNKNOWN_REFERENCE', null, {
        externalReference: body.externalReference,
        transactionId: body.transactionId,
      });
      return { outcome: 'unknown-reference' };
    }
    const { applied } = await this.applyPaymentResult(
      payment,
      {
        status: body.status === 'success' ? 'COMPLETED' : 'FAILED',
        providerReference: body.transactionId,
        ...(body.message !== undefined ? { failureReason: body.message } : {}),
      },
      'webhook',
    );
    return { outcome: applied ? 'applied' : 'noop' };
  }

  // ── Reconciliation ─────────────────────────────────────────────────────────

  /**
   * PROCESSING payments older than 90s get a status query; terminal answers
   * flow through applyPaymentResult — the exact same code path as the
   * webhook. Provider still pending → untouched. Provider errors → skipped.
   * Abandoned payments stay in this loop until final; after 24h without a
   * final answer they are flagged STUCK_PROCESSING for an admin.
   */
  async reconcilePendingPayments(): Promise<number> {
    const now = this.now();
    const cutoff = new Date(now.getTime() - 90_000);
    const stuck = await this.deps.payments.listProcessingOlderThan(cutoff);
    let applied = 0;
    for (const payment of stuck) {
      if (payment.aggregatorTransactionId === null) continue;
      try {
        const status = await this.deps.mobileMoney.queryStatus(payment.aggregatorTransactionId);
        if (status.status === 'PENDING') {
          await this.deps.payments.update(payment.id, { lastStatusCheckAt: now });
          continue;
        }
        const result = await this.applyPaymentResult(
          payment,
          {
            status: status.status,
            providerReference: status.providerReference,
            ...(status.failureReason !== undefined ? { failureReason: status.failureReason } : {}),
          },
          'reconciliation',
        );
        if (result.applied) applied += 1;
      } catch {
        // Provider unreachable — leave for the next sweep (least-recently-checked first).
        await this.deps.payments.update(payment.id, { lastStatusCheckAt: now }).catch(() => null);
      }
    }

    const longAbandoned = await this.deps.payments.listAbandonedUnresolved(
      new Date(now.getTime() - ABANDONED_ALERT_AFTER_MS),
    );
    for (const payment of longAbandoned) {
      await this.flagForReview(payment, 'STUCK_PROCESSING', 'abandoned payment not final after 24h');
    }
    return applied;
  }

  // ── Refunds ────────────────────────────────────────────────────────────────

  /**
   * Automatic full refund when a PAID appointment is cancelled. Failure never
   * blocks the cancellation: the payment stays COMPLETED with refundPending
   * for the admin list.
   */
  async refundIfPaid(appointmentId: string, reason: string): Promise<void> {
    const payment = await this.deps.payments.findByAppointmentId(appointmentId);
    if (!payment || payment.status !== 'COMPLETED') return;
    await this.refundPayment(payment, reason, null);
  }

  /**
   * Full refund of what was actually received. The refund is CLAIMED with a
   * guarded transition first (refundState null/FAILED → PROCESSING), so two
   * triggers — a cancel racing a late success, an admin double-click — can
   * never send the money back twice.
   */
  private async refundPayment(
    payment: Payment,
    reason: string,
    actorUserId: string | null,
  ): Promise<Payment> {
    const amountTzs = payment.receivedAmountTzs ?? payment.amountTzs;
    const claimed = await this.deps.payments.transitionRefundState(payment.id, [null, 'FAILED'], {
      refundState: 'PROCESSING',
      refundAmountTzs: amountTzs,
      refundReason: reason,
      refundPending: false,
    });
    if (!claimed) return payment; // already refunding / refunded / not COMPLETED

    try {
      const result = await this.deps.mobileMoney.refund({
        providerReference: payment.aggregatorTransactionId ?? payment.idempotencyKey,
        amountTzs,
        reason,
      });
      if (result.status === 'FAILED') throw new MobileMoneyError('PROVIDER_UNAVAILABLE', 'refund rejected');
      if (result.status === 'PENDING') {
        const pending = await this.deps.payments.update(payment.id, {
          refundReference: result.refundReference,
        });
        await this.audit(actorUserId, 'PAYMENT_REFUND_REQUESTED', payment.id, { reason, amountTzs });
        return pending;
      }
      return (await this.completeRefund(claimed, result.refundReference, actorUserId, false)) ?? claimed;
    } catch (error) {
      const failed = await this.deps.payments.update(payment.id, {
        refundPending: true,
        refundState: 'FAILED',
      });
      await this.audit(actorUserId, 'PAYMENT_REFUND_FAILED', payment.id, {
        reason,
        code: error instanceof MobileMoneyError ? error.code : 'UNKNOWN',
      });
      return failed;
    }
  }

  /** COMPLETED → REFUNDED, once. Returns null when another path finished it first. */
  private async completeRefund(
    payment: Payment,
    refundReference: string,
    actorUserId: string | null,
    manual: boolean,
  ): Promise<Payment | null> {
    const refunded = await this.deps.payments.transitionStatus(payment.id, ['COMPLETED'], {
      status: 'REFUNDED',
      refundState: 'COMPLETED',
      refundReference,
      refundPending: false,
      refundedAt: this.now(),
    });
    if (!refunded) return null;
    await this.audit(actorUserId, 'PAYMENT_REFUNDED', payment.id, {
      reason: refunded.refundReason,
      amountTzs: refunded.refundAmountTzs,
      manual,
    });
    await this.notifyRefund(refunded);
    return refunded;
  }

  private async notifyRefund(payment: Payment): Promise<void> {
    const amount = payment.refundAmountTzs ?? payment.amountTzs;
    await this.smsPatient(
      payment,
      `Daktari Mkononi: malipo yako ya TZS ${amount} yamerudishwa kwenye mkoba wako wa simu.`,
      `Daktari Mkononi: your payment of TZS ${amount} has been refunded to your mobile money wallet.`,
    );
  }

  /** The patient approved the PIN after the booking was gone: say so before the refund lands. */
  private async notifyLateSuccess(payment: Payment): Promise<void> {
    const amount = payment.receivedAmountTzs ?? payment.amountTzs;
    await this.smsPatient(
      payment,
      `Daktari Mkononi: malipo yako ya TZS ${amount} yamepokelewa baada ya miadi kuisha muda au kughairiwa. Miadi haikuthibitishwa; pesa yako inarudishwa kikamilifu. Tafadhali weka miadi mpya.`,
      `Daktari Mkononi: your payment of TZS ${amount} arrived after the booking had expired or was cancelled. No appointment was confirmed; you are being refunded in full. Please book again.`,
    );
  }

  private async smsPatient(payment: Payment, sw: string, en: string): Promise<void> {
    const patient = await this.deps.patients.findByIdWithUser(payment.patientId);
    if (!patient) return;
    await this.deps.sms.sendSms(patient.user.phone, patient.user.language === 'EN' ? en : sw);
  }

  // ── Accrual (consultation COMPLETED) ───────────────────────────────────────

  /** One PENDING DoctorPayment per consultation, from the paid doctor share. */
  async accrueForConsultation(input: {
    appointmentId: string;
    doctorId: string;
    consultationId: string;
  }): Promise<void> {
    const payment = await this.deps.payments.findByAppointmentId(input.appointmentId);
    if (!payment || payment.status !== 'COMPLETED') return; // NHIF/cash accrue in a later phase
    const created = await this.deps.doctorPayments.createIfMissing({
      doctorId: input.doctorId,
      amountTzs: payment.doctorAmountTzs,
      reference: `consultation:${input.consultationId}`,
      periodStart: this.now(),
      periodEnd: this.now(),
    });
    if (created) {
      await this.audit(null, 'DOCTOR_PAYMENT_ACCRUED', created.id, {
        consultationId: input.consultationId,
        amountTzs: payment.doctorAmountTzs,
      });
    }
  }

  // ── Views ──────────────────────────────────────────────────────────────────

  async listMine(userId: string, query: Pagination): Promise<{
    items: PaymentView[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const patient = await this.deps.patients.findByUserId(userId);
    if (!patient) throw PAYMENT_NOT_FOUND();
    const { items, total } = await this.deps.payments.listForPatient(patient.id, query);
    return {
      items: items.map((payment) => this.toView(payment)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async doctorEarnings(userId: string, query: Pagination): Promise<{
    items: Array<{ id: string; amountTzs: number; status: string; reference: string | null; createdAt: Date }>;
    totalAmountTzs: number;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const doctor = await this.deps.doctors.findByUserId(userId);
    if (!doctor) {
      throw new ApiError(404, 'DOCTOR_NOT_FOUND', msg('Daktari hajapatikana', 'Doctor not found'));
    }
    const { items, total, totalAmountTzs } = await this.deps.doctorPayments.listForDoctor(
      doctor.id,
      query,
    );
    return {
      items: items.map((row) => ({
        id: row.id,
        amountTzs: row.amountTzs,
        status: row.status,
        reference: row.reference,
        createdAt: row.createdAt,
      })),
      totalAmountTzs,
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async adminList(query: AdminPaymentsQuery): Promise<{
    items: PaymentView[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const { items, total } = await this.deps.payments.adminList({
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.to !== undefined ? { to: query.to } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: items.map((payment) => this.toView(payment)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async refundsPending(): Promise<{ items: PaymentView[] }> {
    const items = await this.deps.payments.listRefundPending();
    return { items: items.map((payment) => this.toView(payment)) };
  }

  /**
   * Admin records that a stuck refund was chased manually (called the
   * provider, raised a ticket, …). The note lands in the audit trail — the
   * payment's own state is untouched because the money has not moved.
   */
  async markRefundChased(
    adminUserId: string,
    paymentId: string,
    note: string,
  ): Promise<{ paymentId: string; recorded: true }> {
    const payment = await this.deps.payments.findById(paymentId);
    if (!payment) throw PAYMENT_NOT_FOUND();
    await this.audit(adminUserId, 'REFUND_CHASE_RECORDED', payment.id, {
      note,
      refundPending: payment.refundPending,
    });
    return { paymentId: payment.id, recorded: true };
  }

  /** Admin review queue: late successes, amount mismatches, stuck and stray payments. */
  async reviewQueue(): Promise<{ items: PaymentView[] }> {
    const items = await this.deps.payments.listReviewQueue();
    return { items: items.map((payment) => this.toView(payment)) };
  }

  /** An admin has dealt with a review item; the note lands on the row and in the audit log. */
  async resolveReview(adminUserId: string, paymentId: string, note: string): Promise<PaymentView> {
    const payment = await this.deps.payments.findById(paymentId);
    if (!payment) throw PAYMENT_NOT_FOUND();
    if (payment.reviewReason === null || payment.reviewResolvedAt !== null) {
      throw new ApiError(
        409,
        'REVIEW_NOT_OPEN',
        msg('Malipo haya hayasubiri ukaguzi', 'This payment has no open review'),
      );
    }
    const resolved = await this.deps.payments.update(payment.id, {
      reviewResolvedAt: this.now(),
      reviewResolvedByUserId: adminUserId,
      reviewNote: [payment.reviewNote, `[resolved] ${note}`].filter(Boolean).join('\n'),
    });
    await this.audit(adminUserId, 'PAYMENT_REVIEW_RESOLVED', payment.id, {
      reason: payment.reviewReason,
      note,
    });
    return this.toView(resolved);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private toView(payment: Payment): PaymentView {
    return {
      id: payment.id,
      appointmentId: payment.appointmentId,
      amountTzs: payment.amountTzs,
      platformFeeTzs: payment.platformFeeTzs,
      doctorAmountTzs: payment.doctorAmountTzs,
      method: payment.method,
      status: payment.status,
      attempt: payment.attempt,
      failureReason: payment.failureReason,
      refundPending: payment.refundPending,
      refundState: payment.refundState,
      refundAmountTzs: payment.refundAmountTzs,
      receivedAmountTzs: payment.receivedAmountTzs,
      reviewReason: payment.reviewReason,
      reviewNote: payment.reviewNote,
      reviewFlaggedAt: payment.reviewFlaggedAt,
      reviewResolvedAt: payment.reviewResolvedAt,
      abandonedAt: payment.abandonedAt,
      paidAt: payment.paidAt,
      refundedAt: payment.refundedAt,
      createdAt: payment.createdAt,
    };
  }

  private audit(
    actorUserId: string | null,
    action: string,
    resourceId: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.deps.auditLogs.append({
      actorUserId,
      action,
      resourceType: 'Payment',
      resourceId,
      ipAddress: null,
      userAgent: null,
      ...(metadata !== undefined ? { metadata: metadata as never } : {}),
    });
  }
}

/** Interval wiring for reconciliation — production only; tests call directly. */
export function startPaymentReconciliation(
  service: PaymentService,
  intervalMs = 60_000,
  onError: (error: unknown) => void = () => undefined,
): () => void {
  const timer = setInterval(() => {
    service.reconcilePendingPayments().catch(onError);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
