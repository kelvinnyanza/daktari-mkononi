import type { Doctor, DoctorVerificationStatus, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export const doctorRepository = {
  findById(id: string): Promise<Doctor | null> {
    return prisma.doctor.findUnique({ where: { id } });
  },

  findByTmcNumber(tmcRegistrationNumber: string): Promise<Doctor | null> {
    return prisma.doctor.findUnique({ where: { tmcRegistrationNumber } });
  },

  listVerifiedBySpecialty(specialty: string): Promise<Doctor[]> {
    return prisma.doctor.findMany({
      where: { specialty, verificationStatus: 'VERIFIED', isAvailable: true },
      orderBy: { averageRating: 'desc' },
    });
  },

  create(data: Prisma.DoctorCreateInput): Promise<Doctor> {
    return prisma.doctor.create({ data });
  },

  setVerificationStatus(
    id: string,
    status: DoctorVerificationStatus,
    verifiedByUserId?: string,
    rejectionReason?: string,
  ): Promise<Doctor> {
    return prisma.doctor.update({
      where: { id },
      data: {
        verificationStatus: status,
        verifiedByUserId: verifiedByUserId ?? null,
        rejectionReason: rejectionReason ?? null,
        verifiedAt: status === 'VERIFIED' ? new Date() : null,
      },
    });
  },
};
