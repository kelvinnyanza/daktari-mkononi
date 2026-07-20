import type { AuditLog, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

/** Append-only — no update or delete methods, by design. */
export const auditLogRepository = {
  append(data: Prisma.AuditLogUncheckedCreateInput): Promise<AuditLog> {
    return prisma.auditLog.create({ data });
  },

  listForResource(resourceType: string, resourceId: string): Promise<AuditLog[]> {
    return prisma.auditLog.findMany({
      where: { resourceType, resourceId },
      orderBy: { createdAt: 'desc' },
    });
  },
};
