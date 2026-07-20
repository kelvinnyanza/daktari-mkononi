import type { Payment, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export interface CreatePaymentInput {
  patientId: string;
  appointmentId: string;
  amountTzs: number;
  platformFeeTzs: number;
  doctorAmountTzs: number;
  method: PaymentMethod;
  idempotencyKey: string;
  payerPhone: string | null;
}

export interface AdminPaymentFilters {
  status?: PaymentStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

/**
 * Money paths: every amount is whole TZS (Int). Status changes go through the
 * guarded transition so webhook/reconciliation replays cannot double-apply.
 */
export const paymentRepository = {
  findById(id: string): Promise<Payment | null> {
    return prisma.payment.findUnique({ where: { id } });
  },

  findByAppointmentId(appointmentId: string): Promise<Payment | null> {
    return prisma.payment.findUnique({ where: { appointmentId } });
  },

  findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    return prisma.payment.findUnique({ where: { idempotencyKey } });
  },

  findByProviderReference(providerReference: string): Promise<Payment | null> {
    return prisma.payment.findFirst({ where: { aggregatorTransactionId: providerReference } });
  },

  create(input: CreatePaymentInput): Promise<Payment> {
    return prisma.payment.create({ data: input });
  },

  update(id: string, data: Prisma.PaymentUpdateInput): Promise<Payment> {
    return prisma.payment.update({ where: { id }, data });
  },

  /**
   * Guarded status transition: applies only while the row is in one of the
   * `from` statuses. Returns null on a miss — the caller treats replays and
   * races as no-ops, never as double transitions.
   */
  async transitionStatus(
    id: string,
    from: PaymentStatus[],
    data: Prisma.PaymentUpdateManyMutationInput & { status: PaymentStatus },
  ): Promise<Payment | null> {
    const { count } = await prisma.payment.updateMany({
      where: { id, status: { in: from } },
      data,
    });
    if (count === 0) return null;
    return prisma.payment.findUnique({ where: { id } });
  },

  /** PROCESSING payments stuck longer than the cutoff — reconciliation input. */
  listProcessingOlderThan(cutoff: Date, limit = 50): Promise<Payment[]> {
    return prisma.payment.findMany({
      where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
      take: limit,
    });
  },

  async listForPatient(
    patientId: string,
    query: { page: number; pageSize: number },
  ): Promise<{ items: Payment[]; total: number }> {
    const where = { patientId };
    const [items, total] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.payment.count({ where }),
    ]);
    return { items, total };
  },

  async adminList(filters: AdminPaymentFilters): Promise<{ items: Payment[]; total: number }> {
    const where: Prisma.PaymentWhereInput = {
      ...(filters.status !== undefined ? { status: filters.status } : {}),
      ...(filters.from !== undefined || filters.to !== undefined
        ? {
            createdAt: {
              ...(filters.from !== undefined ? { gte: filters.from } : {}),
              ...(filters.to !== undefined ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.payment.count({ where }),
    ]);
    return { items, total };
  },

  /** COMPLETED payments whose provider refund failed — manual chase list. */
  listRefundPending(): Promise<Payment[]> {
    return prisma.payment.findMany({
      where: { refundPending: true },
      orderBy: { updatedAt: 'asc' },
    });
  },
};
