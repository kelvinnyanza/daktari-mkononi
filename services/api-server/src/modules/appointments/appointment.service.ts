import { randomBytes } from 'node:crypto';
import type { Appointment, CreateAppointmentInput, Doctor, Patient } from '@daktari/db';
import { SlotTakenError } from '@daktari/db';
import type {
  BookAppointmentInput,
  DoctorDayQuery,
  ListMyAppointmentsQuery,
  RescheduleAppointmentInput,
} from '@daktari/schemas';
import type { SmsPort } from '@daktari/notifications';
import { ApiError, msg } from '../../lib/errors.js';
import { eatDayRangeUtc, utcToEatDate } from '../../lib/eat-time.js';
import type {
  AppointmentRepoPort,
  AuditLogPort,
  DoctorRepoPort,
  PatientRepoPort,
  PaymentPort,
  ScheduleRepoPort,
  ScreeningRepoPort,
  UserRepoPort,
} from '../../lib/ports.js';
import {
  findAppointmentTransition,
  type AppointmentEvent,
} from './appointment.machine.js';

export const PAYMENT_EXPIRY_MS = 30 * 60_000;
const CANCELLATION_WINDOW_MS = 2 * 60 * 60_000;
const NO_SHOW_GRACE_MS = 15 * 60_000;
const DEFAULT_DURATION_MIN = 30;

const APPOINTMENT_NOT_FOUND = (): ApiError =>
  new ApiError(404, 'APPOINTMENT_NOT_FOUND', msg('Miadi haijapatikana', 'Appointment not found'));

const INVALID_TRANSITION = (from: string, event: string): ApiError =>
  new ApiError(
    409,
    'INVALID_STATE_TRANSITION',
    msg('Hatua hii hairuhusiwi kwa hali ya sasa ya miadi', 'This action is not allowed in the appointment’s current state'),
    { from, event },
  );

const SLOT_TAKEN = (): ApiError =>
  new ApiError(
    409,
    'SLOT_TAKEN',
    msg('Nafasi hii tayari imechukuliwa — chagua muda mwingine', 'This slot has just been taken — pick another time'),
  );

export interface AppointmentView {
  id: string;
  doctorId: string;
  patientId: string;
  type: Appointment['type'];
  status: Appointment['status'];
  scheduledAt: Date;
  durationMinutes: number;
  reason: string;
  paymentIntent: Appointment['paymentIntent'];
  pendingReason: string | null;
  expiresAt: Date | null;
  cancellationReason: string | null;
  /** Only present on the patient's own view (presented at the facility). */
  checkInToken?: string | null;
}

export interface AppointmentServiceDeps {
  appointments: AppointmentRepoPort;
  patients: PatientRepoPort;
  doctors: DoctorRepoPort;
  schedules: ScheduleRepoPort;
  screenings: ScreeningRepoPort;
  users: UserRepoPort;
  payments: PaymentPort;
  sms: SmsPort;
  auditLogs: AuditLogPort;
}

export class AppointmentService {
  constructor(
    private readonly deps: AppointmentServiceDeps,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async ownPatient(userId: string): Promise<Patient> {
    const patient = await this.deps.patients.findByUserId(userId);
    if (!patient) {
      throw new ApiError(404, 'PATIENT_NOT_FOUND', msg('Mgonjwa hajapatikana', 'Patient not found'));
    }
    return patient;
  }

  private async ownDoctor(userId: string): Promise<Doctor> {
    const doctor = await this.deps.doctors.findByUserId(userId);
    if (!doctor) {
      throw new ApiError(404, 'DOCTOR_NOT_FOUND', msg('Daktari hajapatikana', 'Doctor not found'));
    }
    return doctor;
  }

  private toView(appointment: Appointment, options: { includeCheckInToken: boolean }): AppointmentView {
    return {
      id: appointment.id,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      type: appointment.type,
      status: appointment.status,
      scheduledAt: appointment.scheduledAt,
      durationMinutes: appointment.durationMinutes,
      reason: appointment.reason,
      paymentIntent: appointment.paymentIntent,
      pendingReason: appointment.pendingReason,
      expiresAt: appointment.expiresAt,
      cancellationReason: appointment.cancellationReason,
      ...(options.includeCheckInToken ? { checkInToken: appointment.checkInToken } : {}),
    };
  }

  private static mintCheckInToken(): string {
    return randomBytes(24).toString('base64url');
  }

  /**
   * Single choke point for every status change: consult the table, apply with
   * a status guard (updateMany WHERE status = from — concurrent transitions
   * answer 409), write the AuditLog row.
   */
  private async applyTransition(
    appointment: Appointment,
    event: AppointmentEvent,
    actorUserId: string | null,
    data: Record<string, unknown> = {},
  ): Promise<Appointment> {
    const transition = findAppointmentTransition(event, appointment.status);
    if (!transition) throw INVALID_TRANSITION(appointment.status, event);

    const applied = await this.deps.appointments.transition(appointment.id, transition.from, {
      ...data,
      status: transition.to,
    });
    if (!applied) throw INVALID_TRANSITION(appointment.status, event);

    await this.deps.auditLogs.append({
      actorUserId,
      action: 'APPOINTMENT_TRANSITION',
      resourceType: 'Appointment',
      resourceId: appointment.id,
      ipAddress: null,
      userAgent: null,
      metadata: { event, from: transition.from, to: transition.to },
    });
    return applied;
  }

  /** Confirmation payload shared by payment/insurance/cash paths. */
  private confirmationData(appointment: Appointment): Record<string, unknown> {
    return {
      confirmedAt: this.now(),
      expiresAt: null,
      pendingReason: null,
      ...(appointment.type === 'IN_PERSON' && appointment.checkInToken === null
        ? { checkInToken: AppointmentService.mintCheckInToken() }
        : {}),
    };
  }

  // ── Booking ────────────────────────────────────────────────────────────────

  async book(userId: string, input: BookAppointmentInput): Promise<AppointmentView> {
    const patient = await this.ownPatient(userId);
    const doctor = await this.deps.doctors.findById(input.doctorId);
    // Suspended/unverified doctors are excluded from booking, same as search.
    if (!doctor || doctor.verificationStatus !== 'APPROVED') {
      throw new ApiError(404, 'DOCTOR_NOT_FOUND', msg('Daktari hajapatikana', 'Doctor not found'));
    }
    if (input.paymentIntent === 'CASH_AT_FACILITY' && input.type !== 'IN_PERSON') {
      throw new ApiError(
        400,
        'CASH_REQUIRES_IN_PERSON',
        msg('Malipo ya pesa taslimu ni kwa miadi ya ana kwa ana tu', 'Cash at facility is only available for in-person appointments'),
      );
    }
    const now = this.now();
    if (input.scheduledAt.getTime() <= now.getTime()) {
      throw new ApiError(
        400,
        'SCHEDULED_IN_PAST',
        msg('Muda wa miadi umeshapita', 'The requested time is in the past'),
      );
    }

    // Screening link-up (Phase 6): the session must be the booking patient's
    // own and COMPLETED before it can justify an appointment.
    if (input.screeningResultId !== undefined) {
      const screening = await this.deps.screenings.findById(input.screeningResultId);
      if (!screening || screening.patientId !== patient.id) {
        throw new ApiError(
          404,
          'SCREENING_NOT_FOUND',
          msg('Kikao cha maswali ya awali hakijapatikana', 'Screening session not found'),
        );
      }
      if (screening.status !== 'COMPLETED') {
        throw new ApiError(
          409,
          'SCREENING_NOT_COMPLETED',
          msg('Kikao cha maswali ya awali hakijakamilika', 'The screening session is not completed'),
          { status: screening.status },
        );
      }
    }

    const durationMinutes = await this.slotDuration(doctor.id, input.scheduledAt);

    const create: CreateAppointmentInput = {
      patientId: patient.id,
      doctorId: doctor.id,
      type: input.type,
      status: 'PENDING_PAYMENT',
      scheduledAt: input.scheduledAt,
      durationMinutes,
      reason: input.reason,
      paymentIntent: input.paymentIntent,
      screeningResultId: input.screeningResultId ?? null,
      ...(input.paymentIntent === 'MOBILE_MONEY'
        ? { expiresAt: new Date(now.getTime() + PAYMENT_EXPIRY_MS) }
        : {}),
    };

    let appointment: Appointment;
    try {
      appointment = await this.deps.appointments.create(create);
    } catch (error) {
      if (error instanceof SlotTakenError) throw SLOT_TAKEN();
      throw error;
    }

    await this.deps.auditLogs.append({
      actorUserId: userId,
      action: 'APPOINTMENT_BOOKED',
      resourceType: 'Appointment',
      resourceId: appointment.id,
      ipAddress: null,
      userAgent: null,
      metadata: { paymentIntent: input.paymentIntent, scheduledAt: input.scheduledAt.toISOString() },
    });

    switch (input.paymentIntent) {
      case 'MOBILE_MONEY': {
        const user = await this.deps.users.findById(userId);
        await this.deps.payments.initiateMobileMoney({
          appointmentId: appointment.id,
          patientId: patient.id,
          amountTzs: doctor.consultationFeeTzs,
          payerPhone: user?.phone ?? '',
        });
        break;
      }
      case 'NHIF':
      case 'INSURANCE': {
        const provider = input.paymentIntent === 'NHIF' ? 'NHIF' : null;
        const insurance = await this.deps.patients.findVerifiedInsurance(patient.id, provider, now);
        if (insurance) {
          appointment = await this.applyTransition(
            appointment,
            'INSURANCE_CONFIRMED',
            userId,
            this.confirmationData(appointment),
          );
        } else {
          appointment =
            (await this.deps.appointments.transition(appointment.id, 'PENDING_PAYMENT', {
              status: 'PENDING_PAYMENT',
              pendingReason: 'INSURANCE_UNVERIFIED',
            })) ?? appointment;
        }
        break;
      }
      case 'CASH_AT_FACILITY': {
        appointment = await this.applyTransition(
          appointment,
          'CASH_CONFIRMED',
          userId,
          this.confirmationData(appointment),
        );
        break;
      }
    }

    return this.toView(appointment, { includeCheckInToken: true });
  }

  /** Duration from the schedule window covering the slot; 30 min fallback. */
  private async slotDuration(doctorId: string, scheduledAt: Date): Promise<number> {
    const schedules = await this.deps.schedules.listForDoctor(doctorId);
    const eatDate = utcToEatDate(scheduledAt);
    const weekday = new Date(`${eatDate}T00:00:00.000Z`).getUTCDay();
    const eatTime = new Date(scheduledAt.getTime() + 3 * 60 * 60 * 1000)
      .toISOString()
      .slice(11, 16);
    const window = schedules.find(
      (slot) => slot.dayOfWeek === weekday && slot.startTime <= eatTime && eatTime < slot.endTime,
    );
    return window?.slotDurationMinutes ?? DEFAULT_DURATION_MIN;
  }

  // ── Payment + expiry ───────────────────────────────────────────────────────

  /**
   * Internal transition the payment aggregator webhook will call in Phase 7.
   * Idempotent for webhook replays: a second completion on an already
   * CONFIRMED appointment is a no-op.
   */
  async handlePaymentCompleted(appointmentId: string): Promise<AppointmentView> {
    const appointment = await this.deps.appointments.findById(appointmentId);
    if (!appointment) throw APPOINTMENT_NOT_FOUND();
    if (appointment.status === 'CONFIRMED') {
      return this.toView(appointment, { includeCheckInToken: true });
    }
    const applied = await this.applyTransition(
      appointment,
      'PAYMENT_COMPLETED',
      null,
      this.confirmationData(appointment),
    );
    return this.toView(applied, { includeCheckInToken: true });
  }

  /**
   * Expiry sweep (callable job): stale unpaid MOBILE_MONEY bookings →
   * CANCELLED / PAYMENT_TIMEOUT. Interval wiring lives in server.ts;
   * tests drive this directly with an injected clock.
   */
  async expireStalePayments(): Promise<number> {
    const stale = await this.deps.appointments.listExpiredPendingPayment(this.now());
    let expired = 0;
    for (const appointment of stale) {
      const applied = await this.applyTransition(appointment, 'PAYMENT_TIMEOUT', null, {
        cancellationReason: 'PAYMENT_TIMEOUT',
      }).catch(() => null); // raced by a payment completion — leave it be
      if (applied) expired += 1;
    }
    return expired;
  }

  // ── Cancellation / no-show / check-in ─────────────────────────────────────

  async cancelByPatient(userId: string, appointmentId: string, reason: string): Promise<AppointmentView> {
    const patient = await this.ownPatient(userId);
    const appointment = await this.deps.appointments.findById(appointmentId);
    // 404 (not 403) for someone else's appointment — no id enumeration.
    if (!appointment || appointment.patientId !== patient.id) throw APPOINTMENT_NOT_FOUND();

    if (
      appointment.status === 'CONFIRMED' &&
      appointment.scheduledAt.getTime() - this.now().getTime() < CANCELLATION_WINDOW_MS
    ) {
      throw new ApiError(
        409,
        'CANCELLATION_WINDOW_PASSED',
        msg('Miadi inaweza kughairiwa hadi saa 2 kabla ya kuanza', 'Appointments can be cancelled up to 2 hours before the start'),
      );
    }

    const applied = await this.applyTransition(appointment, 'PATIENT_CANCEL', userId, {
      cancellationReason: reason,
      cancelledByUserId: userId,
    });
    // A paid appointment cancelled in time gets an automatic full refund.
    await this.deps.payments.refundIfPaid(appointment.id, `patient-cancel: ${reason}`);
    return this.toView(applied, { includeCheckInToken: true });
  }

  async cancelByDoctor(userId: string, appointmentId: string, reason: string): Promise<AppointmentView> {
    const doctor = await this.ownDoctor(userId);
    const appointment = await this.deps.appointments.findById(appointmentId);
    if (!appointment || appointment.doctorId !== doctor.id) throw APPOINTMENT_NOT_FOUND();

    const applied = await this.applyTransition(appointment, 'DOCTOR_CANCEL', userId, {
      cancellationReason: reason,
      cancelledByUserId: userId,
    });
    // Doctor/system cancellation of a paid appointment → automatic full refund.
    await this.deps.payments.refundIfPaid(appointment.id, `doctor-cancel: ${reason}`);

    // Tell the patient, in their language.
    const patient = await this.deps.patients.findByIdWithUser(appointment.patientId);
    if (patient) {
      const english = patient.user.language === 'EN';
      const when = appointment.scheduledAt.toISOString();
      await this.deps.sms.sendSms(
        patient.user.phone,
        english
          ? `Daktari Mkononi: your appointment (${when}) was cancelled by the doctor. Reason: ${reason}. Please rebook at your convenience.`
          : `Daktari Mkononi: miadi yako (${when}) imeghairiwa na daktari. Sababu: ${reason}. Tafadhali weka miadi mpya.`,
      );
    }
    return this.toView(applied, { includeCheckInToken: false });
  }

  async checkIn(userId: string, checkInToken: string): Promise<AppointmentView> {
    const doctor = await this.ownDoctor(userId);
    const appointment = await this.deps.appointments.findByCheckInToken(checkInToken);
    if (!appointment || appointment.doctorId !== doctor.id) {
      throw new ApiError(
        404,
        'INVALID_CHECK_IN_TOKEN',
        msg('Tokeni ya kuripoti si sahihi', 'Invalid check-in token'),
      );
    }
    const applied = await this.applyTransition(appointment, 'CHECK_IN', userId, {
      checkedInAt: this.now(),
    });
    return this.toView(applied, { includeCheckInToken: false });
  }

  async markNoShow(userId: string, appointmentId: string): Promise<AppointmentView> {
    const doctor = await this.ownDoctor(userId);
    const appointment = await this.deps.appointments.findById(appointmentId);
    if (!appointment || appointment.doctorId !== doctor.id) throw APPOINTMENT_NOT_FOUND();

    if (this.now().getTime() < appointment.scheduledAt.getTime() + NO_SHOW_GRACE_MS) {
      throw new ApiError(
        409,
        'NO_SHOW_TOO_EARLY',
        msg('Subiri dakika 15 baada ya muda wa miadi', 'Wait until 15 minutes after the scheduled time'),
      );
    }
    const applied = await this.applyTransition(appointment, 'MARK_NO_SHOW', userId, {});
    return this.toView(applied, { includeCheckInToken: false });
  }

  // ── Reschedule ────────────────────────────────────────────────────────────

  /**
   * Cancel + rebook in one DB transaction (payment row moves to the new
   * appointment). The same patient cancellation rules apply; the new slot is
   * still arbitrated by the partial unique index.
   */
  async reschedule(
    userId: string,
    appointmentId: string,
    input: RescheduleAppointmentInput,
  ): Promise<AppointmentView> {
    const patient = await this.ownPatient(userId);
    const appointment = await this.deps.appointments.findById(appointmentId);
    if (!appointment || appointment.patientId !== patient.id) throw APPOINTMENT_NOT_FOUND();

    if (appointment.status !== 'PENDING_PAYMENT' && appointment.status !== 'CONFIRMED') {
      throw INVALID_TRANSITION(appointment.status, 'PATIENT_CANCEL');
    }
    const now = this.now();
    if (
      appointment.status === 'CONFIRMED' &&
      appointment.scheduledAt.getTime() - now.getTime() < CANCELLATION_WINDOW_MS
    ) {
      throw new ApiError(
        409,
        'CANCELLATION_WINDOW_PASSED',
        msg('Miadi inaweza kubadilishwa hadi saa 2 kabla ya kuanza', 'Appointments can be rescheduled up to 2 hours before the start'),
      );
    }
    if (input.scheduledAt.getTime() <= now.getTime()) {
      throw new ApiError(
        400,
        'SCHEDULED_IN_PAST',
        msg('Muda mpya wa miadi umeshapita', 'The new time is in the past'),
      );
    }

    const durationMinutes = await this.slotDuration(appointment.doctorId, input.scheduledAt);
    let created: Appointment;
    try {
      created = await this.deps.appointments.cancelAndRebook(
        appointment.id,
        { reason: input.reason ?? 'RESCHEDULED', cancelledByUserId: userId },
        {
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          type: appointment.type,
          status: appointment.status, // payment state carries over
          scheduledAt: input.scheduledAt,
          durationMinutes,
          reason: appointment.reason,
          paymentIntent: appointment.paymentIntent,
          pendingReason: appointment.pendingReason,
          expiresAt: appointment.expiresAt,
          confirmedAt: appointment.confirmedAt,
          screeningResultId: appointment.screeningResultId,
          ...(appointment.status === 'CONFIRMED' && appointment.type === 'IN_PERSON'
            ? { checkInToken: AppointmentService.mintCheckInToken() }
            : {}),
        },
      );
    } catch (error) {
      if (error instanceof SlotTakenError) throw SLOT_TAKEN();
      throw error;
    }

    await this.deps.auditLogs.append({
      actorUserId: userId,
      action: 'APPOINTMENT_RESCHEDULED',
      resourceType: 'Appointment',
      resourceId: created.id,
      ipAddress: null,
      userAgent: null,
      metadata: { previousAppointmentId: appointment.id, scheduledAt: input.scheduledAt.toISOString() },
    });
    return this.toView(created, { includeCheckInToken: true });
  }

  // ── Views ──────────────────────────────────────────────────────────────────

  async listMine(userId: string, query: ListMyAppointmentsQuery): Promise<{
    items: AppointmentView[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const patient = await this.ownPatient(userId);
    const { items, total } = await this.deps.appointments.listForPatient(patient.id, {
      ...(query.status !== undefined ? { status: query.status } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: items.map((appointment) => this.toView(appointment, { includeCheckInToken: true })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async doctorDay(userId: string, query: DoctorDayQuery): Promise<{
    date: string;
    items: AppointmentView[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const doctor = await this.ownDoctor(userId);
    const date = query.date ?? utcToEatDate(this.now());
    const { start, end } = eatDayRangeUtc(date);
    const { items, total } = await this.deps.appointments.listForDoctorBetween(doctor.id, start, end, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      date,
      items: items.map((appointment) => this.toView(appointment, { includeCheckInToken: false })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
}

/**
 * Interval wiring for the expiry sweep — production only; tests call
 * expireStalePayments() directly with an injected clock (no real timers).
 */
export function startExpirySweep(
  service: AppointmentService,
  intervalMs = 60_000,
  onError: (error: unknown) => void = () => undefined,
): () => void {
  const timer = setInterval(() => {
    service.expireStalePayments().catch(onError);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
