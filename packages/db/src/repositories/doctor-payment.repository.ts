import { Prisma, type DoctorPayment, type DoctorPaymentStatus, type Payment } from '@prisma/client';
import { prisma } from '../client.js';

/** The patient payment's frozen fee breakdown, shown next to each earning. */
export type EarningPaymentBreakdown = Pick<
  Payment,
  | 'amountTzs'
  | 'platformFeeTzs'
  | 'vatTzs'
  | 'doctorAmountTzs'
  | 'commissionBps'
  | 'vatBps'
  | 'vatMode'
>;

export type DoctorEarningRow = DoctorPayment & { payment: EarningPaymentBreakdown | null };

const BREAKDOWN_SELECT = {
  amountTzs: true,
  platformFeeTzs: true,
  vatTzs: true,
  doctorAmountTzs: true,
  commissionBps: true,
  vatBps: true,
  vatMode: true,
} as const;

export interface CreateAccrualInput {
  doctorId: string;
  amountTzs: number;
  /** Idempotency: `consultation:<id>` — one accrual per consultation. */
  reference: string;
  /** The patient payment it came from (fee / commission / VAT breakdown). */
  paymentId: string | null;
  /** EARNING (default) or a negative ADJUSTMENT netted in the next payout. */
  kind?: 'EARNING' | 'ADJUSTMENT';
  note?: string | null;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Doctor earnings: created PENDING on consultation completion (or as a
 * negative ADJUSTMENT after a refund of a paid-out earning). Payout runs
 * reserve and settle them via payout.repository.ts (see CLAUDE.md).
 */
export const doctorPaymentRepository = {
  /** Create the accrual once; replays of consultation completion are no-ops. */
  async createIfMissing(input: CreateAccrualInput): Promise<DoctorPayment | null> {
    const existing = await prisma.doctorPayment.findFirst({
      where: { reference: input.reference },
    });
    if (existing) return null;
    // The unique index on reference settles a race between two callers that
    // both passed the find above: the loser gets null, exactly like a replay.
    return prisma.doctorPayment
      .create({
        data: {
          doctorId: input.doctorId,
          amountTzs: input.amountTzs,
          reference: input.reference,
          paymentId: input.paymentId,
          kind: input.kind ?? 'EARNING',
          note: input.note ?? null,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          return null;
        throw error;
      });
  },

  /** The consultation earning that came from this patient payment, if any. */
  findEarningByPaymentId(paymentId: string): Promise<DoctorPayment | null> {
    return prisma.doctorPayment.findFirst({ where: { paymentId, kind: 'EARNING' } });
  },

  /**
   * Refund before payout: PENDING and not reserved by any payout run →
   * REVERSED (never paid). Guarded — returns false if a run reserved it or
   * it moved on, and the caller falls back to a negative adjustment.
   */
  async reverseIfUnreserved(id: string, note: string): Promise<boolean> {
    const { count } = await prisma.doctorPayment.updateMany({
      where: { id, status: 'PENDING', payoutItemId: null },
      data: { status: 'REVERSED', note },
    });
    return count === 1;
  },

  /**
   * All-time totals per status for one doctor — computed in the database over
   * EVERY row, never from the page on screen.
   */
  async totalsByStatus(doctorId: string): Promise<Record<DoctorPaymentStatus, number>> {
    const groups = await prisma.doctorPayment.groupBy({
      by: ['status'],
      where: { doctorId },
      _sum: { amountTzs: true },
    });
    const totals: Record<DoctorPaymentStatus, number> = {
      PENDING: 0,
      PROCESSING: 0,
      PAID: 0,
      FAILED: 0,
      REVERSED: 0,
    };
    for (const group of groups) totals[group.status] = group._sum.amountTzs ?? 0;
    return totals;
  },

  async listForDoctor(
    doctorId: string,
    query: { page: number; pageSize: number },
  ): Promise<{ items: DoctorEarningRow[]; total: number; totalAmountTzs: number }> {
    const where = { doctorId };
    const [items, total, sum] = await prisma.$transaction([
      prisma.doctorPayment.findMany({
        where,
        include: { payment: { select: BREAKDOWN_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.doctorPayment.count({ where }),
      prisma.doctorPayment.aggregate({ where, _sum: { amountTzs: true } }),
    ]);
    return { items, total, totalAmountTzs: sum._sum.amountTzs ?? 0 };
  },
};
