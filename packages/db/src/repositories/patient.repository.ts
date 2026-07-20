import type { Patient, PatientInsurance, Prisma, User } from '@prisma/client';
import { prisma } from '../client.js';

export type PatientWithUser = Patient & { user: User };

export interface PatientListFilters {
  region?: string;
  district?: string;
  page: number;
  pageSize: number;
}

export const patientRepository = {
  findById(id: string): Promise<Patient | null> {
    return prisma.patient.findFirst({ where: { id, deletedAt: null } });
  },

  findByIdWithUser(id: string): Promise<PatientWithUser | null> {
    return prisma.patient.findFirst({ where: { id, deletedAt: null }, include: { user: true } });
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

  async list(filters: PatientListFilters): Promise<{ items: PatientWithUser[]; total: number }> {
    const where: Prisma.PatientWhereInput = {
      deletedAt: null,
      ...(filters.region !== undefined ? { region: filters.region } : {}),
      ...(filters.district !== undefined ? { district: filters.district } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.patient.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.patient.count({ where }),
    ]);
    return { items, total };
  },

  /** Verified insurance row for a provider (NHIF / private), if any. */
  findVerifiedInsurance(
    patientId: string,
    provider: string,
    now: Date = new Date(),
  ): Promise<PatientInsurance | null> {
    return prisma.patientInsurance.findFirst({
      where: {
        patientId,
        provider,
        verifiedAt: { not: null },
        OR: [{ validUntil: null }, { validUntil: { gte: now } }],
      },
    });
  },

  softDelete(id: string): Promise<Patient> {
    return prisma.patient.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};
