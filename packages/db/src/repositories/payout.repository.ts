import type {
  DoctorPaymentStatus,
  DoctorPayoutAccount,
  PayoutBatch,
  PayoutBatchStatus,
  PayoutItem,
  PayoutItemStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../client.js';

export type UpsertPayoutAccountInput = Omit<
  DoctorPayoutAccount,
  'id' | 'doctorId' | 'createdAt' | 'updatedAt'
>;

export interface PendingEarningsSummary {
  doctorId: string;
  netTzs: number;
  count: number;
}

export interface DraftPayoutDoctor {
  doctorId: string;
  accountSnapshot: Prisma.InputJsonValue;
}

export type PayoutBatchWithItems = PayoutBatch & { items: PayoutItem[] };

/** Earnings a payout run may reserve: owed, unreserved, created before the cutoff. */
const reservable = (cutoff: Date): Prisma.DoctorPaymentWhereInput => ({
  status: 'PENDING',
  payoutItemId: null,
  createdAt: { lt: cutoff },
});

/**
 * Doctor payout accounts, payout runs and their items. Money safety lives in
 * the guarded writes: earnings are reserved with `payoutItemId: null` in the
 * WHERE (one run can never take another's earnings) and every item status
 * change names the statuses it may leave.
 */
export const payoutRepository = {
  findAccount(doctorId: string): Promise<DoctorPayoutAccount | null> {
    return prisma.doctorPayoutAccount.findUnique({ where: { doctorId } });
  },

  upsertAccount(doctorId: string, data: UpsertPayoutAccountInput): Promise<DoctorPayoutAccount> {
    return prisma.doctorPayoutAccount.upsert({
      where: { doctorId },
      create: { doctorId, ...data },
      update: data,
    });
  },

  updateAccount(
    doctorId: string,
    data: Prisma.DoctorPayoutAccountUpdateInput,
  ): Promise<DoctorPayoutAccount> {
    return prisma.doctorPayoutAccount.update({ where: { doctorId }, data });
  },

  /** Accounts AzamPay could not confirm — an admin verifies them by hand. */
  listAccountsNeedingReview(): Promise<DoctorPayoutAccount[]> {
    return prisma.doctorPayoutAccount.findMany({
      where: { status: 'LOOKUP_FAILED' },
      orderBy: { updatedAt: 'asc' },
    });
  },

  async pendingEarningsByDoctor(cutoff: Date): Promise<PendingEarningsSummary[]> {
    const groups = await prisma.doctorPayment.groupBy({
      by: ['doctorId'],
      where: reservable(cutoff),
      _sum: { amountTzs: true },
      _count: { _all: true },
    });
    return groups.map((group) => ({
      doctorId: group.doctorId,
      netTzs: group._sum.amountTzs ?? 0,
      count: group._count._all,
    }));
  },

  /**
   * One transaction: batch + one item per doctor + reservation of that
   * doctor's reservable earnings onto the item. The item amount is the sum
   * of what was ACTUALLY reserved, so a concurrent run can never make two
   * items count the same earning. Items whose reserved net is ≤ 0 are
   * dropped and their earnings released.
   */
  async createDraftBatch(input: {
    cutoff: Date;
    createdByUserId: string;
    note: string | null;
    doctors: DraftPayoutDoctor[];
    minPayoutTzs: number;
  }): Promise<PayoutBatchWithItems> {
    return prisma.$transaction(async (tx) => {
      const batch = await tx.payoutBatch.create({
        data: { cutoff: input.cutoff, createdByUserId: input.createdByUserId, note: input.note },
      });
      let total = 0;
      let count = 0;
      for (const doctor of input.doctors) {
        const item = await tx.payoutItem.create({
          data: {
            batchId: batch.id,
            doctorId: doctor.doctorId,
            amountTzs: 0,
            accountSnapshot: doctor.accountSnapshot,
          },
        });
        await tx.doctorPayment.updateMany({
          where: { doctorId: doctor.doctorId, ...reservable(input.cutoff) },
          data: { payoutItemId: item.id },
        });
        const sum = await tx.doctorPayment.aggregate({
          where: { payoutItemId: item.id },
          _sum: { amountTzs: true },
        });
        const amount = sum._sum.amountTzs ?? 0;
        if (amount < input.minPayoutTzs || amount <= 0) {
          await tx.doctorPayment.updateMany({ where: { payoutItemId: item.id }, data: { payoutItemId: null } });
          await tx.payoutItem.delete({ where: { id: item.id } });
          continue;
        }
        await tx.payoutItem.update({ where: { id: item.id }, data: { amountTzs: amount } });
        total += amount;
        count += 1;
      }
      await tx.payoutBatch.update({ where: { id: batch.id }, data: { totalTzs: total, itemCount: count } });
      return tx.payoutBatch.findUniqueOrThrow({ where: { id: batch.id }, include: { items: true } });
    });
  },

  findBatch(id: string): Promise<PayoutBatchWithItems | null> {
    return prisma.payoutBatch.findUnique({ where: { id }, include: { items: true } });
  },

  listBatches(limit = 30): Promise<PayoutBatch[]> {
    return prisma.payoutBatch.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  },

  async transitionBatch(
    id: string,
    from: PayoutBatchStatus[],
    data: Prisma.PayoutBatchUpdateManyMutationInput & { status: PayoutBatchStatus },
  ): Promise<PayoutBatch | null> {
    const { count } = await prisma.payoutBatch.updateMany({ where: { id, status: { in: from } }, data });
    return count === 0 ? null : prisma.payoutBatch.findUnique({ where: { id } });
  },

  findItem(id: string): Promise<PayoutItem | null> {
    return prisma.payoutItem.findUnique({ where: { id } });
  },

  findItemByReference(reference: string): Promise<PayoutItem | null> {
    return prisma.payoutItem.findUnique({ where: { reference } });
  },

  findItemByProviderReference(providerReference: string): Promise<PayoutItem | null> {
    return prisma.payoutItem.findFirst({ where: { providerReference } });
  },

  /** Guarded item transition — null when the item is no longer in `from`. */
  async transitionItem(
    id: string,
    from: PayoutItemStatus[],
    data: Prisma.PayoutItemUpdateManyMutationInput & { status?: PayoutItemStatus },
  ): Promise<PayoutItem | null> {
    const { count } = await prisma.payoutItem.updateMany({ where: { id, status: { in: from } }, data });
    return count === 0 ? null : prisma.payoutItem.findUnique({ where: { id } });
  },

  /** Move every earning reserved by the item (REVERSED rows are left alone). */
  async setItemEarnings(
    itemId: string,
    data: { status: DoctorPaymentStatus; paidAt?: Date | null; failureReason?: string | null },
  ): Promise<number> {
    const { count } = await prisma.doctorPayment.updateMany({
      where: { payoutItemId: itemId, status: { not: 'REVERSED' } },
      data,
    });
    return count;
  },

  /** Draft cancelled: earnings go back to the unreserved pool. */
  async releaseBatch(batchId: string): Promise<void> {
    await prisma.doctorPayment.updateMany({
      where: { payoutItem: { batchId }, status: 'PENDING' },
      data: { payoutItemId: null },
    });
  },

  countUnpaidItems(batchId: string): Promise<number> {
    return prisma.payoutItem.count({ where: { batchId, status: { not: 'PAID' } } });
  },

  /** PROCESSING items with a provider reference, untouched since the cutoff. */
  listItemsInFlight(cutoff: Date, limit = 50): Promise<PayoutItem[]> {
    return prisma.payoutItem.findMany({
      where: { status: 'PROCESSING', providerReference: { not: null }, updatedAt: { lt: cutoff } },
      orderBy: [{ lastStatusCheckAt: { sort: 'asc', nulls: 'first' } }, { updatedAt: 'asc' }],
      take: limit,
    });
  },

  listItemsForDoctor(doctorId: string, limit = 20): Promise<PayoutItem[]> {
    return prisma.payoutItem.findMany({
      where: { doctorId, status: { not: 'PENDING' } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },
};
