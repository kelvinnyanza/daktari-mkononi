import type { Payment, PayoutItem } from '@prisma/client';
import { prisma } from '../client.js';

/**
 * Read models for finance reports and statement reconciliation. Pilot
 * volumes are small, so rows are returned and summed in the service (which
 * also renders them as CSV lines); move the sums into SQL when volumes grow.
 */
export const financeRepository = {
  /** Money received in [from, to): COMPLETED or later REFUNDED. */
  paymentsPaidBetween(from: Date, to: Date): Promise<Payment[]> {
    return prisma.payment.findMany({
      where: { paidAt: { gte: from, lt: to }, status: { in: ['COMPLETED', 'REFUNDED'] } },
      orderBy: { paidAt: 'asc' },
    });
  },

  paymentsRefundedBetween(from: Date, to: Date): Promise<Payment[]> {
    return prisma.payment.findMany({
      where: { refundedAt: { gte: from, lt: to }, status: 'REFUNDED' },
      orderBy: { refundedAt: 'asc' },
    });
  },

  payoutItemsPaidBetween(from: Date, to: Date): Promise<PayoutItem[]> {
    return prisma.payoutItem.findMany({
      where: { paidAt: { gte: from, lt: to }, status: 'PAID' },
      orderBy: { paidAt: 'asc' },
    });
  },

  /** Every payment / payout item carrying any of these references (ours or AzamPay's). */
  async findByAnyReference(refs: string[]): Promise<{ payments: Payment[]; payoutItems: PayoutItem[] }> {
    if (refs.length === 0) return { payments: [], payoutItems: [] };
    const [payments, payoutItems] = await Promise.all([
      prisma.payment.findMany({
        where: {
          OR: [
            { idempotencyKey: { in: refs } },
            { aggregatorTransactionId: { in: refs } },
            { externalReference: { in: refs } },
            { refundReference: { in: refs } },
          ],
        },
      }),
      prisma.payoutItem.findMany({
        where: { OR: [{ reference: { in: refs } }, { providerReference: { in: refs } }] },
      }),
    ]);
    return { payments, payoutItems };
  },

  /** Record AzamPay's fee from a statement — only where no fee is known yet. */
  async recordStatementFee(paymentId: string, feeTzs: number): Promise<boolean> {
    const { count } = await prisma.payment.updateMany({
      where: { id: paymentId, providerFeeTzs: null },
      data: { providerFeeTzs: feeTzs, providerFeeSource: 'STATEMENT' },
    });
    return count === 1;
  },
};
