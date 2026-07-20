import type { AIScreeningResult, Prisma, ScreeningSessionStatus } from '@prisma/client';
import { prisma } from '../client.js';

export interface CreateScreeningSessionInput {
  patientId: string;
  sessionId: string;
  language: 'SW' | 'EN';
  encryptedConversation: string;
  lastActivityAt: Date;
}

/** Aggregates for GET /api/v1/admin/ai-usage. */
export interface ScreeningUsageSummary {
  sessions: { total: number; byStatus: Record<string, number> };
  tokensUsed: number;
  triageLevels: Record<string, number>;
  emergencyCount: number;
}

export const screeningRepository = {
  findById(id: string): Promise<AIScreeningResult | null> {
    return prisma.aIScreeningResult.findUnique({ where: { id } });
  },

  create(input: CreateScreeningSessionInput): Promise<AIScreeningResult> {
    return prisma.aIScreeningResult.create({
      data: {
        patientId: input.patientId,
        sessionId: input.sessionId,
        language: input.language,
        encryptedConversation: input.encryptedConversation,
        lastActivityAt: input.lastActivityAt,
      },
    });
  },

  update(id: string, data: Prisma.AIScreeningResultUpdateInput): Promise<AIScreeningResult> {
    return prisma.aIScreeningResult.update({ where: { id }, data });
  },

  /**
   * Guarded status transition (same pattern as appointments/consultations):
   * applies only while the row is still in `from`; null on a miss.
   */
  async transitionStatus(
    id: string,
    from: ScreeningSessionStatus,
    data: Prisma.AIScreeningResultUpdateManyMutationInput & { status: ScreeningSessionStatus },
  ): Promise<AIScreeningResult | null> {
    const { count } = await prisma.aIScreeningResult.updateMany({
      where: { id, status: from },
      data,
    });
    if (count === 0) return null;
    return prisma.aIScreeningResult.findUnique({ where: { id } });
  },

  /** ACTIVE sessions idle since before the cutoff — expiry sweep input. */
  listStale(cutoff: Date, limit = 100): Promise<AIScreeningResult[]> {
    return prisma.aIScreeningResult.findMany({
      where: { status: 'ACTIVE', lastActivityAt: { lt: cutoff } },
      take: limit,
    });
  },

  /** Sessions created by a patient since the cutoff (daily session cap). */
  countCreatedSince(patientId: string, since: Date): Promise<number> {
    return prisma.aIScreeningResult.count({
      where: { patientId, createdAt: { gte: since } },
    });
  },

  async usageSummary(): Promise<ScreeningUsageSummary> {
    const [byStatus, byTriage, tokens, emergencies] = await Promise.all([
      prisma.aIScreeningResult.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.aIScreeningResult.groupBy({
        by: ['triageLevel'],
        _count: { _all: true },
        where: { triageLevel: { not: null } },
      }),
      prisma.aIScreeningResult.aggregate({ _sum: { tokensUsed: true } }),
      prisma.aIScreeningResult.count({ where: { escalatedToEmergency: true } }),
    ]);
    const statusCounts: Record<string, number> = {};
    let total = 0;
    for (const row of byStatus) {
      statusCounts[row.status] = row._count._all;
      total += row._count._all;
    }
    const triageCounts: Record<string, number> = {};
    for (const row of byTriage) {
      if (row.triageLevel !== null) triageCounts[row.triageLevel] = row._count._all;
    }
    return {
      sessions: { total, byStatus: statusCounts },
      tokensUsed: tokens._sum.tokensUsed ?? 0,
      triageLevels: triageCounts,
      emergencyCount: emergencies,
    };
  },
};
