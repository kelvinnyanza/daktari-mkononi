import { randomUUID } from 'node:crypto';
import type { DoctorPayment, DoctorPayoutAccount, PayoutBatch, PayoutItem } from '@daktari/db';
import type { PayoutRepoPort } from '../../src/lib/ports.js';

const cuidLike = (): string => `c${randomUUID().replace(/-/g, '').slice(0, 24)}`;

/** In-memory PayoutRepoPort mirroring payout.repository.ts (guards included). */
export function makeFakePayoutRepo(earnings: Map<string, DoctorPayment>): {
  repo: PayoutRepoPort;
  accounts: Map<string, DoctorPayoutAccount>;
  batches: Map<string, PayoutBatch>;
  items: Map<string, PayoutItem>;
} {
  const accounts = new Map<string, DoctorPayoutAccount>();
  const batches = new Map<string, PayoutBatch>();
  const items = new Map<string, PayoutItem>();
  const reservable = (row: DoctorPayment, cutoff: Date): boolean =>
    row.status === 'PENDING' && row.payoutItemId === null && row.createdAt < cutoff;
  const withItems = (batch: PayoutBatch) => ({
    ...batch,
    items: [...items.values()].filter((item) => item.batchId === batch.id),
  });

  const repo: PayoutRepoPort = {
    findAccount: (doctorId) => Promise.resolve(accounts.get(doctorId) ?? null),
    upsertAccount: (doctorId, data) => {
      const existing = accounts.get(doctorId);
      const row: DoctorPayoutAccount = {
        id: existing?.id ?? cuidLike(),
        doctorId,
        ...data,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      accounts.set(doctorId, row);
      return Promise.resolve(row);
    },
    updateAccount: (doctorId, data) => {
      const existing = accounts.get(doctorId);
      if (!existing) return Promise.reject(new Error('no account'));
      const row = { ...existing, ...(data as Partial<DoctorPayoutAccount>), updatedAt: new Date() };
      accounts.set(doctorId, row);
      return Promise.resolve(row);
    },
    listAccountsNeedingReview: () =>
      Promise.resolve([...accounts.values()].filter((row) => row.status === 'LOOKUP_FAILED')),
    pendingEarningsByDoctor: (cutoff) => {
      const byDoctor = new Map<string, { doctorId: string; netTzs: number; count: number }>();
      for (const row of earnings.values()) {
        if (!reservable(row, cutoff)) continue;
        const entry = byDoctor.get(row.doctorId) ?? { doctorId: row.doctorId, netTzs: 0, count: 0 };
        entry.netTzs += row.amountTzs;
        entry.count += 1;
        byDoctor.set(row.doctorId, entry);
      }
      return Promise.resolve([...byDoctor.values()]);
    },
    createDraftBatch: (input) => {
      const batch: PayoutBatch = {
        id: cuidLike(),
        status: 'DRAFT',
        cutoff: input.cutoff,
        totalTzs: 0,
        itemCount: 0,
        note: input.note,
        createdByUserId: input.createdByUserId,
        approvedByUserId: null,
        approvedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      for (const doctor of input.doctors) {
        const itemId = cuidLike();
        let amount = 0;
        const reserved: string[] = [];
        for (const row of earnings.values()) {
          if (row.doctorId === doctor.doctorId && reservable(row, input.cutoff)) {
            earnings.set(row.id, { ...row, payoutItemId: itemId });
            reserved.push(row.id);
            amount += row.amountTzs;
          }
        }
        if (amount <= 0 || amount < input.minPayoutTzs) {
          for (const id of reserved) earnings.set(id, { ...earnings.get(id)!, payoutItemId: null });
          continue;
        }
        items.set(itemId, {
          id: itemId,
          batchId: batch.id,
          doctorId: doctor.doctorId,
          amountTzs: amount,
          status: 'PENDING',
          attempt: 0,
          reference: null,
          providerReference: null,
          providerFeeTzs: null,
          failureReason: null,
          method: null,
          manualReference: null,
          accountSnapshot: doctor.accountSnapshot as PayoutItem['accountSnapshot'],
          paidAt: null,
          lastStatusCheckAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        batch.totalTzs += amount;
        batch.itemCount += 1;
      }
      batches.set(batch.id, batch);
      return Promise.resolve(withItems(batch));
    },
    findBatch: (id) => {
      const batch = batches.get(id);
      return Promise.resolve(batch ? withItems(batch) : null);
    },
    listBatches: () => Promise.resolve([...batches.values()]),
    transitionBatch: (id, from, data) => {
      const batch = batches.get(id);
      if (!batch || !from.includes(batch.status)) return Promise.resolve(null);
      const next = { ...batch, ...(data as Partial<PayoutBatch>), updatedAt: new Date() };
      batches.set(id, next);
      return Promise.resolve(next);
    },
    findItem: (id) => Promise.resolve(items.get(id) ?? null),
    findItemByReference: (reference) =>
      Promise.resolve([...items.values()].find((item) => item.reference === reference) ?? null),
    findItemByProviderReference: (reference) =>
      Promise.resolve([...items.values()].find((item) => item.providerReference === reference) ?? null),
    transitionItem: (id, from, data) => {
      const item = items.get(id);
      if (!item || !from.includes(item.status)) return Promise.resolve(null);
      const next = { ...item, ...(data as Partial<PayoutItem>), updatedAt: new Date() };
      items.set(id, next);
      return Promise.resolve(next);
    },
    setItemEarnings: (itemId, data) => {
      let count = 0;
      for (const row of earnings.values()) {
        if (row.payoutItemId === itemId && row.status !== 'REVERSED') {
          earnings.set(row.id, { ...row, ...data, updatedAt: new Date() });
          count += 1;
        }
      }
      return Promise.resolve(count);
    },
    releaseBatch: (batchId) => {
      const ids = new Set([...items.values()].filter((item) => item.batchId === batchId).map((item) => item.id));
      for (const row of earnings.values()) {
        if (row.payoutItemId !== null && ids.has(row.payoutItemId) && row.status === 'PENDING') {
          earnings.set(row.id, { ...row, payoutItemId: null });
        }
      }
      return Promise.resolve();
    },
    countUnpaidItems: (batchId) =>
      Promise.resolve([...items.values()].filter((item) => item.batchId === batchId && item.status !== 'PAID').length),
    listItemsInFlight: (cutoff) =>
      Promise.resolve(
        [...items.values()].filter(
          (item) => item.status === 'PROCESSING' && item.providerReference !== null && item.updatedAt < cutoff,
        ),
      ),
    listItemsForDoctor: (doctorId) =>
      Promise.resolve([...items.values()].filter((item) => item.doctorId === doctorId && item.status !== 'PENDING')),
  };
  return { repo, accounts, batches, items };
}
