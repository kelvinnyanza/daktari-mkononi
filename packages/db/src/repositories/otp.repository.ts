import type { OtpCode, OtpPurpose } from '@prisma/client';
import { prisma } from '../client.js';

export interface CreateOtpInput {
  userId: string | null;
  phone: string;
  codeHash: string;
  purpose: OtpPurpose;
  expiresAt: Date;
}

export const otpRepository = {
  create(input: CreateOtpInput): Promise<OtpCode> {
    return prisma.otpCode.create({
      data: {
        userId: input.userId,
        phone: input.phone,
        codeHash: input.codeHash,
        purpose: input.purpose,
        expiresAt: input.expiresAt,
      },
    });
  },

  /** Latest unconsumed, unexpired code for this phone + purpose. */
  findActive(phone: string, purpose: OtpPurpose, now: Date): Promise<OtpCode | null> {
    return prisma.otpCode.findFirst({
      where: { phone, purpose, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** Count a verification attempt BEFORE checking the code (attempt caps hold even on crashes). */
  recordAttempt(id: string): Promise<OtpCode> {
    return prisma.otpCode.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  },

  /** Single use: consuming a code retires it permanently. */
  consume(id: string): Promise<OtpCode> {
    return prisma.otpCode.update({ where: { id }, data: { consumedAt: new Date() } });
  },

  /** Invalidate all outstanding codes for a phone + purpose (e.g. before issuing a new one). */
  async invalidateAll(phone: string, purpose: OtpPurpose): Promise<number> {
    const result = await prisma.otpCode.updateMany({
      where: { phone, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return result.count;
  },
};
