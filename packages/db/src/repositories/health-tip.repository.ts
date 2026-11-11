import type { HealthTip, HealthTipCategory, HealthTipStatus, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

/** A tip with its reviewer's display name (null when never reviewed). */
export type HealthTipWithReviewer = HealthTip & { reviewedBy: { fullName: string } | null };

const WITH_REVIEWER = { reviewedBy: { select: { fullName: true } } } as const;

export interface PublicTipFilters {
  now: Date;
  /** PUBLISHED only, or (dev preview) DRAFT/REVIEWED/PUBLISHED. */
  statuses: HealthTipStatus[];
  /** Apply the publishAt/unpublishAt window (always, except dev preview). */
  window: boolean;
  category?: HealthTipCategory;
  q?: string;
  page: number;
  pageSize: number;
}

export interface AdminTipFilters {
  status?: HealthTipStatus;
  category?: HealthTipCategory;
  q?: string;
  page: number;
  pageSize: number;
}

function search(q: string | undefined): Prisma.HealthTipWhereInput {
  if (q === undefined) return {};
  const contains = { contains: q, mode: 'insensitive' as const };
  return {
    OR: [
      { titleSw: contains },
      { titleEn: contains },
      { summarySw: contains },
      { summaryEn: contains },
      { slug: contains },
    ],
  };
}

export const healthTipRepository = {
  create(data: Prisma.HealthTipUncheckedCreateInput): Promise<HealthTipWithReviewer> {
    return prisma.healthTip.create({ data, include: WITH_REVIEWER });
  },

  update(id: string, data: Prisma.HealthTipUncheckedUpdateInput): Promise<HealthTipWithReviewer> {
    return prisma.healthTip.update({ where: { id }, data, include: WITH_REVIEWER });
  },

  /**
   * Guarded status transition: only applies while the tip is still in one of
   * `from` (two admins clicking at once can never double-apply). Null when the
   * guard failed.
   */
  async transition(
    id: string,
    from: HealthTipStatus[],
    data: Prisma.HealthTipUncheckedUpdateInput,
  ): Promise<HealthTipWithReviewer | null> {
    const result = await prisma.healthTip.updateMany({ where: { id, status: { in: from } }, data });
    if (result.count === 0) return null;
    return prisma.healthTip.findUnique({ where: { id }, include: WITH_REVIEWER });
  },

  findById(id: string): Promise<HealthTipWithReviewer | null> {
    return prisma.healthTip.findUnique({ where: { id }, include: WITH_REVIEWER });
  },

  findBySlug(slug: string): Promise<HealthTipWithReviewer | null> {
    return prisma.healthTip.findUnique({ where: { slug }, include: WITH_REVIEWER });
  },

  async listAdmin(filters: AdminTipFilters): Promise<{ items: HealthTipWithReviewer[]; total: number }> {
    const where: Prisma.HealthTipWhereInput = {
      ...(filters.status !== undefined ? { status: filters.status } : {}),
      ...(filters.category !== undefined ? { category: filters.category } : {}),
      ...search(filters.q),
    };
    const [items, total] = await prisma.$transaction([
      prisma.healthTip.findMany({
        where,
        include: WITH_REVIEWER,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.healthTip.count({ where }),
    ]);
    return { items, total };
  },

  /** Newest/priority first — the order the app shows them in. */
  async listPublic(filters: PublicTipFilters): Promise<{ items: HealthTipWithReviewer[]; total: number }> {
    const where: Prisma.HealthTipWhereInput = {
      status: { in: filters.statuses },
      ...(filters.category !== undefined ? { category: filters.category } : {}),
      ...(filters.window
        ? {
            AND: [
              { OR: [{ publishAt: null }, { publishAt: { lte: filters.now } }] },
              { OR: [{ unpublishAt: null }, { unpublishAt: { gt: filters.now } }] },
            ],
          }
        : {}),
      ...search(filters.q),
    };
    const [items, total] = await prisma.$transaction([
      prisma.healthTip.findMany({
        where,
        include: WITH_REVIEWER,
        orderBy: [{ priority: 'desc' }, { publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.healthTip.count({ where }),
    ]);
    return { items, total };
  },
};
