import type { Session } from '@prisma/client';
import { prisma } from '../client.js';

export interface CreateSessionInput {
  id?: string;
  userId: string;
  refreshTokenHash: string;
  tokenFamily: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
}

export const sessionRepository = {
  create(input: CreateSessionInput): Promise<Session> {
    return prisma.session.create({
      data: {
        ...(input.id !== undefined ? { id: input.id } : {}),
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        tokenFamily: input.tokenFamily,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        expiresAt: input.expiresAt,
      },
    });
  },

  findById(id: string): Promise<Session | null> {
    return prisma.session.findUnique({ where: { id } });
  },

  /** Rotation: the presented token was the family's active one; swap in the successor. */
  rotateRefreshHash(id: string, refreshTokenHash: string): Promise<Session> {
    return prisma.session.update({ where: { id }, data: { refreshTokenHash } });
  },

  revoke(id: string, reason: string): Promise<Session> {
    return prisma.session.update({
      where: { id },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  },

  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const result = await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  },
};
