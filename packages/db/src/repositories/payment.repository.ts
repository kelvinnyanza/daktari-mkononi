import type { Payment, PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export const paymentRepository = {
  findById(id: string): Promise<Payment | null> {
    return prisma.payment.findUnique({ where: { id } });
  },

  /**
   * Idempotency: callers must look up the key before creating; the unique
   * constraint on idempotencyKey is the last line of defense against
   * double-charging on aggregator retries.
   */
  findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    return prisma.payment.findUnique({ where: { idempotencyKey } });
  },

  create(data: Prisma.PaymentCreateInput): Promise<Payment> {
    return prisma.payment.create({ data });
  },

  setStatus(
    id: string,
    status: PaymentStatus,
    details?: { aggregatorTransactionId?: string; failureReason?: string },
  ): Promise<Payment> {
    return prisma.payment.update({
      where: { id },
      data: {
        status,
        aggregatorTransactionId: details?.aggregatorTransactionId ?? null,
        failureReason: details?.failureReason ?? null,
        paidAt: status === 'COMPLETED' ? new Date() : null,
      },
    });
  },
};
