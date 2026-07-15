import type { MedicalRecord, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

/**
 * MedicalRecord rows hold AES-256-GCM ciphertext in encryptedContent.
 * Callers must write an AuditLog entry for every read (PDPA 2022) —
 * enforcement lives in the service layer, which is why reads here take
 * an explicit accessor id.
 */
export const medicalRecordRepository = {
  async findByIdAudited(id: string, accessorUserId: string): Promise<MedicalRecord | null> {
    const record = await prisma.medicalRecord.findFirst({ where: { id, deletedAt: null } });
    if (record) {
      await prisma.auditLog.create({
        data: {
          actorUserId: accessorUserId,
          action: 'MEDICAL_RECORD_VIEWED',
          resourceType: 'MedicalRecord',
          resourceId: record.id,
        },
      });
    }
    return record;
  },

  create(data: Prisma.MedicalRecordCreateInput): Promise<MedicalRecord> {
    return prisma.medicalRecord.create({ data });
  },

  softDelete(id: string): Promise<MedicalRecord> {
    return prisma.medicalRecord.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};
