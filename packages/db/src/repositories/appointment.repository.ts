import type {
  Appointment,
  AppointmentStatus,
  AppointmentType,
  PaymentIntentType,
  Prisma,
} from '@prisma/client';
import { Prisma as PrismaNs } from '@prisma/client';
import { prisma } from '../client.js';

/** Statuses that hold a slot. Mirrors the partial unique index predicate. */
export const SLOT_HOLDING_STATUSES: readonly AppointmentStatus[] = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
];

export interface CreateAppointmentInput {
  patientId: string;
  doctorId: string;
  type: AppointmentType;
  status: AppointmentStatus;
  scheduledAt: Date;
  durationMinutes: number;
  reason: string;
  paymentIntent: PaymentIntentType;
  pendingReason?: string | null;
  expiresAt?: Date | null;
  checkInToken?: string | null;
  confirmedAt?: Date | null;
  screeningResultId?: string | null;
}

/** Thrown when the partial unique index rejects a double-booking. */
export class SlotTakenError extends Error {
  constructor() {
    super('slot already booked');
    this.name = 'SlotTakenError';
  }
}

const isSlotConflict = (error: unknown): boolean =>
  error instanceof PrismaNs.PrismaClientKnownRequestError && error.code === 'P2002';

export interface AppointmentPage {
  items: Appointment[];
  total: number;
}

export const appointmentRepository = {
  findById(id: string): Promise<Appointment | null> {
    return prisma.appointment.findUnique({ where: { id } });
  },

  findByCheckInToken(token: string): Promise<Appointment | null> {
    return prisma.appointment.findUnique({ where: { checkInToken: token } });
  },

  /**
   * Race-safe create: the DB's partial unique index on (doctorId, scheduledAt)
   * WHERE status NOT IN (CANCELLED, NO_SHOW) is the arbiter — a P2002 from a
   * concurrent booking surfaces as SlotTakenError.
   */
  async create(input: CreateAppointmentInput): Promise<Appointment> {
    try {
      return await prisma.appointment.create({ data: input });
    } catch (error) {
      if (isSlotConflict(error)) throw new SlotTakenError();
      throw error;
    }
  },

  async listForPatient(
    patientId: string,
    query: { status?: AppointmentStatus; page: number; pageSize: number },
  ): Promise<AppointmentPage> {
    const where: Prisma.AppointmentWhereInput = {
      patientId,
      ...(query.status !== undefined ? { status: query.status } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.appointment.findMany({
        where,
        orderBy: { scheduledAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.appointment.count({ where }),
    ]);
    return { items, total };
  },

  async listForDoctorBetween(
    doctorId: string,
    from: Date,
    to: Date,
    query: { page: number; pageSize: number },
  ): Promise<AppointmentPage> {
    const where: Prisma.AppointmentWhereInput = {
      doctorId,
      scheduledAt: { gte: from, lt: to },
    };
    const [items, total] = await prisma.$transaction([
      prisma.appointment.findMany({
        where,
        orderBy: { scheduledAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.appointment.count({ where }),
    ]);
    return { items, total };
  },

  /** Slot-holding appointments in a window — availability computation input. */
  listActiveForDoctorBetween(doctorId: string, from: Date, to: Date): Promise<Appointment[]> {
    return prisma.appointment.findMany({
      where: {
        doctorId,
        scheduledAt: { gte: from, lt: to },
        status: { in: [...SLOT_HOLDING_STATUSES] },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  },

  /**
   * Guarded status transition: applies only while the row is still in `from`.
   * Returns null when the guard misses so callers answer 409.
   */
  async transition(
    id: string,
    from: AppointmentStatus,
    data: Prisma.AppointmentUpdateManyMutationInput & { status: AppointmentStatus },
  ): Promise<Appointment | null> {
    const { count } = await prisma.appointment.updateMany({
      where: { id, status: from },
      data,
    });
    if (count === 0) return null;
    return prisma.appointment.findUnique({ where: { id } });
  },

  /** Does the doctor currently have a CONFIRMED/IN_PROGRESS appointment with the patient? */
  async hasActiveWith(doctorId: string, patientId: string): Promise<boolean> {
    const found = await prisma.appointment.findFirst({
      where: { doctorId, patientId, status: { in: ['CONFIRMED', 'IN_PROGRESS'] } },
      select: { id: true },
    });
    return found !== null;
  },

  /** Stale unpaid MOBILE_MONEY bookings due for the PAYMENT_TIMEOUT sweep. */
  listExpiredPendingPayment(now: Date, limit = 100): Promise<Appointment[]> {
    return prisma.appointment.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        paymentIntent: 'MOBILE_MONEY',
        expiresAt: { lte: now },
      },
      take: limit,
    });
  },

  /**
   * Reschedule: cancel the old appointment and book the new slot in one
   * transaction, moving any Payment row to the new appointment. The partial
   * unique index still arbitrates the new slot (SlotTakenError on conflict,
   * transaction rolls back — the old booking stays untouched).
   */
  async cancelAndRebook(
    oldId: string,
    cancel: { reason: string; cancelledByUserId: string },
    next: CreateAppointmentInput,
  ): Promise<Appointment> {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id: oldId },
          data: {
            status: 'CANCELLED',
            cancellationReason: cancel.reason,
            cancelledByUserId: cancel.cancelledByUserId,
          },
        });
        const created = await tx.appointment.create({ data: next });
        await tx.payment.updateMany({
          where: { appointmentId: oldId },
          data: { appointmentId: created.id },
        });
        return created;
      });
    } catch (error) {
      if (isSlotConflict(error)) throw new SlotTakenError();
      throw error;
    }
  },
};
