import type { MedicalRecord, MedicalRecordType } from '@prisma/client';
import { prisma } from '../client.js';

export interface CreateMedicalRecordInput {
  patientId: string;
  consultationId?: string | null;
  type: MedicalRecordType;
  title: string;
  /** Short, deliberately non-sensitive. */
  summary?: string | null;
  /** AES-256-GCM v1 payload — the full clinical detail. */
  encryptedContent: string;
  createdByUserId: string;
  addendumToId?: string | null;
}

/**
 * MedicalRecord rows hold AES-256-GCM ciphertext in encryptedContent and are
 * IMMUTABLE: no update method exists by design — corrections are new records
 * referencing the original via addendumToId. Every read must be audited
 * (PDPA 2022); enforcement lives in the service layer.
 */
export const medicalRecordRepository = {
  findById(id: string): Promise<MedicalRecord | null> {
    return prisma.medicalRecord.findFirst({ where: { id, deletedAt: null } });
  },

  async listForPatient(
    patientId: string,
    query: { page: number; pageSize: number },
  ): Promise<{ items: MedicalRecord[]; total: number }> {
    const where = { patientId, deletedAt: null };
    const [items, total] = await prisma.$transaction([
      prisma.medicalRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.medicalRecord.count({ where }),
    ]);
    return { items, total };
  },

  create(input: CreateMedicalRecordInput): Promise<MedicalRecord> {
    return prisma.medicalRecord.create({
      data: {
        patientId: input.patientId,
        consultationId: input.consultationId ?? null,
        type: input.type,
        title: input.title,
        summary: input.summary ?? null,
        encryptedContent: input.encryptedContent,
        createdByUserId: input.createdByUserId,
        addendumToId: input.addendumToId ?? null,
      },
    });
  },

  softDelete(id: string): Promise<MedicalRecord> {
    return prisma.medicalRecord.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};
