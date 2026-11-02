import type { FeeSettings, VatMode } from '@prisma/client';
import { prisma } from '../client.js';

export interface CreateFeeSettingsInput {
  commissionBps: number;
  vatEnabled: boolean;
  vatBps: number;
  vatMode: VatMode;
  minPayoutTzs: number;
  effectiveFrom: Date;
  createdByUserId: string;
  note: string | null;
}

/**
 * Effective-dated, insert-only fee settings. There is deliberately no update
 * or delete: a rate change is a new row, so "what rate applied on day X" is
 * always answerable (and every Payment also snapshots its own rates).
 */
export const feeSettingsRepository = {
  /** The row in force at `at`: latest effectiveFrom <= at (ties → newest created). */
  findEffective(at: Date): Promise<FeeSettings | null> {
    return prisma.feeSettings.findFirst({
      where: { effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
  },

  listHistory(limit = 50): Promise<FeeSettings[]> {
    return prisma.feeSettings.findMany({
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
  },

  create(input: CreateFeeSettingsInput): Promise<FeeSettings> {
    return prisma.feeSettings.create({ data: input });
  },
};
