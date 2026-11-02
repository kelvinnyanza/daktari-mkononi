import type {
  Payment,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  RefundState,
  VatMode,
} from '@prisma/client';
import { prisma } from '../client.js';

export interface CreatePaymentInput {
  patientId: string;
  appointmentId: string;
  amountTzs: number;
  /** Commission EXCLUDING VAT. Invariant: platformFeeTzs + vatTzs + doctorAmountTzs = amountTzs. */
  platformFeeTzs: number;
  vatTzs: number;
  doctorAmountTzs: number;
  commissionBps: number;
  vatBps: number;
  vatMode: VatMode;
  feeSettingsId: string | null;
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

  /**
   * Any payment created for an attempt key family `<appointmentId>:` — used to
   * recognise a superseded attempt's late callback (the key changes per retry).
   */
  findByIdempotencyKeyPrefix(prefix: string): Promise<Payment | null> {
    return prisma.payment.findFirst({ where: { idempotencyKey: { startsWith: prefix } } });
  },

  /**
   * Guarded refund claim/transition: applies only while the payment is
   * COMPLETED and its refundState is one of `from` (null = never refunded).
   * Two concurrent refund triggers cannot both claim the same payment.
   */
  async transitionRefundState(
    id: string,
    from: Array<RefundState | null>,
    data: Prisma.PaymentUpdateManyMutationInput,
  ): Promise<Payment | null> {
    const states = from.filter((state): state is RefundState => state !== null);
    const { count } = await prisma.payment.updateMany({
      where: {
        id,
        status: 'COMPLETED',
        OR: [
          ...(states.length > 0 ? [{ refundState: { in: states } }] : []),
          ...(from.includes(null) ? [{ refundState: null }] : []),
        ],
      },
      data,
    });
    if (count === 0) return null;
    return prisma.payment.findUnique({ where: { id } });
  },

  /**
   * PROCESSING payments untouched since the cutoff — reconciliation input.
   * Least-recently-checked first, so a few rows the provider keeps answering
   * "pending" for can never starve the rest of the queue.
   */
  listProcessingOlderThan(cutoff: Date, limit = 50): Promise<Payment[]> {
    return prisma.payment.findMany({
      where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
      orderBy: [{ lastStatusCheckAt: { sort: 'asc', nulls: 'first' } }, { updatedAt: 'asc' }],
      take: limit,
    });
  },

  /** Abandoned payments still PROCESSING since before the cutoff and not yet flagged. */
  listAbandonedUnresolved(cutoff: Date, limit = 50): Promise<Payment[]> {
    return prisma.payment.findMany({
      where: { status: 'PROCESSING', abandonedAt: { lt: cutoff }, reviewReason: null },
      take: limit,
    });
  },

  /** Open admin review items (late success, amount mismatch, stuck, stray), oldest first. */
  listReviewQueue(): Promise<Payment[]> {
    return prisma.payment.findMany({
      where: { reviewReason: { not: null }, reviewResolvedAt: null },
      orderBy: { reviewFlaggedAt: 'asc' },
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
