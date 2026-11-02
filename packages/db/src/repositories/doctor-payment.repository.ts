import type { DoctorPayment, Payment } from '@prisma/client';
import { prisma } from '../client.js';

/** The patient payment's frozen fee breakdown, shown next to each earning. */
export type EarningPaymentBreakdown = Pick<
  Payment,
  'amountTzs' | 'platformFeeTzs' | 'vatTzs' | 'doctorAmountTzs' | 'commissionBps' | 'vatBps' | 'vatMode'
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
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Doctor earnings accruals. Payout EXECUTION (bulk disbursement) is a later
 * phase — rows are created PENDING on consultation completion and only summed
 * here (see CLAUDE.md).
 */
export const doctorPaymentRepository = {
  /** Create the accrual once; replays of consultation completion are no-ops. */
  async createIfMissing(input: CreateAccrualInput): Promise<DoctorPayment | null> {
    const existing = await prisma.doctorPayment.findFirst({
      where: { reference: input.reference },
    });
    if (existing) return null;
    return prisma.doctorPayment.create({
      data: {
        doctorId: input.doctorId,
        amountTzs: input.amountTzs,
        reference: input.reference,
        paymentId: input.paymentId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
    });
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
