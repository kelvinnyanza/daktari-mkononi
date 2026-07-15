import type { Patient, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export const patientRepository = {
  findById(id: string): Promise<Patient | null> {
    return prisma.patient.findFirst({ where: { id, deletedAt: null } });
  },

  findByUserId(userId: string): Promise<Patient | null> {
    return prisma.patient.findFirst({ where: { userId, deletedAt: null } });
  },

  create(data: Prisma.PatientCreateInput): Promise<Patient> {
    return prisma.patient.create({ data });
  },

  update(id: string, data: Prisma.PatientUpdateInput): Promise<Patient> {
    return prisma.patient.update({ where: { id }, data });
  },

  softDelete(id: string): Promise<Patient> {
    return prisma.patient.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};
