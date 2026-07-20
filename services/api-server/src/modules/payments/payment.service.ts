import { randomBytes } from 'node:crypto';
import type { Payment, PaymentMethod } from '@daktari/db';
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
  paidAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
}

export interface PaymentResultInput {
  status: 'COMPLETED' | 'FAILED';
  providerReference: string;
  failureReason?: string;
}

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
        },
      );
      if (!applied) return { applied: false }; // replay / race → no-op

      await this.audit(null, 'PAYMENT_COMPLETED', payment.id, { source });
      // Drive the Phase 4 appointment transition (guarded there too).
      if (payment.appointmentId !== null) {
        await this.confirmAppointment(payment.appointmentId);
      }
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

  private async confirmAppointment(appointmentId: string): Promise<void> {
    const appointment = await this.deps.appointments.findById(appointmentId);
    if (!appointment) return;
    const transition = findAppointmentTransition('PAYMENT_COMPLETED', appointment.status);
    if (!transition) return; // already CONFIRMED (or beyond) — idempotent
    const applied = await this.deps.appointments.transition(appointment.id, transition.from, {
      status: transition.to,
      confirmedAt: this.now(),
      expiresAt: null,
      pendingReason: null,
      ...(appointment.type === 'IN_PERSON' && appointment.checkInToken === null
        ? { checkInToken: PaymentService.mintCheckInToken() }
        : {}),
    });
    if (applied) {
      await this.deps.auditLogs.append({
        actorUserId: null,
        action: 'APPOINTMENT_TRANSITION',
        resourceType: 'Appointment',
        resourceId: appointment.id,
        ipAddress: null,
        userAgent: null,
        metadata: { event: 'PAYMENT_COMPLETED', from: transition.from, to: transition.to },
      });
    }
  }

  private static mintCheckInToken(): string {
    return randomBytes(24).toString('base64url');
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
   */
  async reconcilePendingPayments(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - 90_000);
    const stuck = await this.deps.payments.listProcessingOlderThan(cutoff);
    let applied = 0;
    for (const payment of stuck) {
      if (payment.aggregatorTransactionId === null) continue;
      try {
        const status = await this.deps.mobileMoney.queryStatus(payment.aggregatorTransactionId);
        if (status.status === 'PENDING') continue;
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
        // Provider unreachable — leave for the next sweep.
      }
    }
    return applied;
  }

  // ── Refunds ────────────────────────────────────────────────────────────────

  /**
   * Automatic full refund when a PAID appointment is cancelled. Failure never
   * blocks the cancellation: the payment stays COMPLETED with refundPending
   * for the admin chase list.
   */
  async refundIfPaid(appointmentId: string, reason: string): Promise<void> {
    const payment = await this.deps.payments.findByAppointmentId(appointmentId);
    if (!payment || payment.status !== 'COMPLETED') return;

    try {
      const result = await this.deps.mobileMoney.refund({
        providerReference: payment.aggregatorTransactionId ?? payment.idempotencyKey,
        amountTzs: payment.amountTzs,
        reason,
      });
      if (result.status === 'FAILED') throw new MobileMoneyError('PROVIDER_UNAVAILABLE', 'refund rejected');
      await this.deps.payments.transitionStatus(payment.id, ['COMPLETED'], {
        status: 'REFUNDED',
        refundAmountTzs: payment.amountTzs,
        refundReference: result.refundReference,
        refundReason: reason,
        refundPending: false,
        refundedAt: this.now(),
      });
      await this.audit(null, 'PAYMENT_REFUNDED', payment.id, { reason });
      await this.notifyRefund(payment);
    } catch (error) {
      await this.deps.payments.update(payment.id, { refundPending: true, refundReason: reason });
      await this.audit(null, 'PAYMENT_REFUND_FAILED', payment.id, {
        reason,
        code: error instanceof MobileMoneyError ? error.code : 'UNKNOWN',
      });
    }
  }

  private async notifyRefund(payment: Payment): Promise<void> {
    const patient = await this.deps.patients.findByIdWithUser(payment.patientId);
    if (!patient) return;
    const english = patient.user.language === 'EN';
    await this.deps.sms.sendSms(
      patient.user.phone,
      english
        ? `Daktari Mkononi: your payment of TZS ${payment.amountTzs} has been refunded to your mobile money wallet.`
        : `Daktari Mkononi: malipo yako ya TZS ${payment.amountTzs} yamerudishwa kwenye mkoba wako wa simu.`,
    );
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
