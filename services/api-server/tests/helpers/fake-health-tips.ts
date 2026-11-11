import { randomUUID } from 'node:crypto';
import type { HealthTip, Prisma, User } from '@daktari/db';
import type { HealthTipRepoPort, HealthTipRow } from '../../src/lib/ports.js';

/** In-memory HealthTip repository mirroring packages/db health-tip.repository. */
export function makeFakeHealthTips(users: Map<string, User>): {
  port: HealthTipRepoPort;
  rows: Map<string, HealthTip>;
} {
  const rows = new Map<string, HealthTip>();
  const withReviewer = (row: HealthTip): HealthTipRow => {
    const reviewer = row.reviewedByUserId === null ? undefined : users.get(row.reviewedByUserId);
    return { ...row, reviewedBy: reviewer === undefined ? null : { fullName: reviewer.fullName } };
  };
  const apply = (row: HealthTip, data: Prisma.HealthTipUncheckedUpdateInput): HealthTip => ({
    ...row,
    ...(data as Partial<HealthTip>),
    updatedAt: new Date(row.updatedAt.getTime() + 1),
  });
  const matches = (row: HealthTip, q: string | undefined): boolean =>
    q === undefined ||
    [row.titleSw, row.titleEn, row.summarySw, row.summaryEn, row.slug].some((text) =>
      text.toLowerCase().includes(q.toLowerCase()),
    );

  const port: HealthTipRepoPort = {
    create(data) {
      const now = new Date();
      const defaults = {
        id: randomUUID(),
        imageKey: null,
        reviewedByUserId: null,
        reviewedAt: null,
        publishedAt: null,
        priority: 0,
        publishAt: null,
        unpublishAt: null,
        createdByUserId: null,
        status: 'DRAFT',
        createdAt: now,
        updatedAt: now,
      };
      const row = { ...defaults, ...(data as Partial<HealthTip>) } as HealthTip;
      rows.set(row.id, row);
      return Promise.resolve(withReviewer(row));
    },
    update(id, data) {
      const row = rows.get(id);
      if (row === undefined) return Promise.reject(new Error(`no tip ${id}`));
      const next = apply(row, data);
      rows.set(id, next);
      return Promise.resolve(withReviewer(next));
    },
    transition(id, from, data) {
      const row = rows.get(id);
      if (row === undefined || !from.includes(row.status)) return Promise.resolve(null);
      const next = apply(row, data);
      rows.set(id, next);
      return Promise.resolve(withReviewer(next));
    },
    findById(id) {
      const row = rows.get(id);
      return Promise.resolve(row === undefined ? null : withReviewer(row));
    },
    findBySlug(slug) {
      const row = [...rows.values()].find((candidate) => candidate.slug === slug);
      return Promise.resolve(row === undefined ? null : withReviewer(row));
    },
    listAdmin(filters) {
      const all = [...rows.values()]
        .filter(
          (row) =>
            (filters.status === undefined || row.status === filters.status) &&
            (filters.category === undefined || row.category === filters.category) &&
            matches(row, filters.q),
        )
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      const start = (filters.page - 1) * filters.pageSize;
      return Promise.resolve({ items: all.slice(start, start + filters.pageSize).map(withReviewer), total: all.length });
    },
    listPublic(filters) {
      const now = filters.now.getTime();
      const all = [...rows.values()]
        .filter(
          (row) =>
            filters.statuses.includes(row.status) &&
            (filters.category === undefined || row.category === filters.category) &&
            (!filters.window ||
              ((row.publishAt === null || row.publishAt.getTime() <= now) &&
                (row.unpublishAt === null || row.unpublishAt.getTime() > now))) &&
            matches(row, filters.q),
        )
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        );
      const start = (filters.page - 1) * filters.pageSize;
      return Promise.resolve({ items: all.slice(start, start + filters.pageSize).map(withReviewer), total: all.length });
    },
  };
  return { port, rows };
}
