import type { Prescription, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export const prescriptionRepository = {
  findById(id: string): Promise<Prescription | null> {
    return prisma.prescription.findFirst({ where: { id, deletedAt: null } });
  },

  listForPatient(patientId: string): Promise<Prescription[]> {
    return prisma.prescription.findMany({
      where: { patientId, deletedAt: null },
      orderBy: { issuedAt: 'desc' },
    });
  },

  create(data: Prisma.PrescriptionCreateInput): Promise<Prescription> {
    return prisma.prescription.create({ data });
  },

  softDelete(id: string): Promise<Prescription> {
    return prisma.prescription.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};
