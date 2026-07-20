import type { ConsultationMessage } from '@prisma/client';
import { prisma } from '../client.js';

export interface CreateMessageInput {
  consultationId: string;
  senderUserId: string;
  /** AES-256-GCM v1 payload — never plaintext. */
  encryptedBody: string;
  sentAt: Date;
}

export const consultationMessageRepository = {
  create(input: CreateMessageInput): Promise<ConsultationMessage> {
    return prisma.consultationMessage.create({ data: input });
  },

  async listForConsultation(
    consultationId: string,
    query: { page: number; pageSize: number },
  ): Promise<{ items: ConsultationMessage[]; total: number }> {
    const [items, total] = await prisma.$transaction([
      prisma.consultationMessage.findMany({
        where: { consultationId },
        orderBy: { sentAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.consultationMessage.count({ where: { consultationId } }),
    ]);
    return { items, total };
  },
};
