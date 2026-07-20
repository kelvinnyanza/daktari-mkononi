import type { Doctor, DoctorVerificationStatus, Prisma, User } from '@prisma/client';
import { prisma } from '../client.js';

export interface DoctorDirectoryFilters {
  specialty?: string;
  region?: string;
  language?: string;
  acceptsNhif?: boolean;
  maxFeeTzs?: number;
  page: number;
  pageSize: number;
}

export type DoctorWithUser = Doctor & { user: User };

export interface VerificationUpdate {
  status: DoctorVerificationStatus;
  claimedByUserId?: string | null;
  verifiedByUserId?: string | null;
  verifiedAt?: Date | null;
  rejectionReason?: string | null;
  suspensionReason?: string | null;
}

export const doctorRepository = {
  findById(id: string): Promise<Doctor | null> {
    return prisma.doctor.findUnique({ where: { id } });
  },

  findByIdWithUser(id: string): Promise<DoctorWithUser | null> {
    return prisma.doctor.findUnique({ where: { id }, include: { user: true } });
  },

  findByUserId(userId: string): Promise<Doctor | null> {
    return prisma.doctor.findUnique({ where: { userId } });
  },

  findByTmcNumber(tmcRegistrationNumber: string): Promise<Doctor | null> {
    return prisma.doctor.findUnique({ where: { tmcRegistrationNumber } });
  },

  update(id: string, data: Prisma.DoctorUpdateInput): Promise<Doctor> {
    return prisma.doctor.update({ where: { id }, data });
  },

  /** Public directory: APPROVED doctors only, best-rated first. */
  async listDirectory(
    filters: DoctorDirectoryFilters,
  ): Promise<{ items: DoctorWithUser[]; total: number }> {
    const where: Prisma.DoctorWhereInput = {
      verificationStatus: 'APPROVED',
      ...(filters.specialty !== undefined ? { specialty: filters.specialty } : {}),
      ...(filters.region !== undefined ? { region: filters.region } : {}),
      ...(filters.language !== undefined ? { languages: { has: filters.language } } : {}),
      ...(filters.acceptsNhif !== undefined ? { acceptsNhif: filters.acceptsNhif } : {}),
      ...(filters.maxFeeTzs !== undefined
        ? { consultationFeeTzs: { lte: filters.maxFeeTzs } }
        : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.doctor.findMany({
        where,
        include: { user: true },
        orderBy: { averageRating: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.doctor.count({ where }),
    ]);
    return { items, total };
  },

  /** Admin list: every verification status (the directory is APPROVED-only). */
  async adminList(filters: {
    status?: DoctorVerificationStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: DoctorWithUser[]; total: number }> {
    const where: Prisma.DoctorWhereInput =
      filters.status !== undefined ? { verificationStatus: filters.status } : {};
    const [items, total] = await prisma.$transaction([
      prisma.doctor.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.doctor.count({ where }),
    ]);
    return { items, total };
  },

  /** Admin queue: doctors awaiting review, oldest submission first. */
  async listVerificationQueue(
    page: number,
    pageSize: number,
  ): Promise<{ items: DoctorWithUser[]; total: number }> {
    const where: Prisma.DoctorWhereInput = {
      verificationStatus: { in: ['DOCUMENTS_SUBMITTED', 'UNDER_REVIEW'] },
    };
    const [items, total] = await prisma.$transaction([
      prisma.doctor.findMany({
        where,
        include: { user: true },
        orderBy: { updatedAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.doctor.count({ where }),
    ]);
    return { items, total };
  },

  /**
   * Guarded verification transition: only applies when the row is still in
   * `from`. Returns null when the guard misses (concurrent transition) so the
   * service can answer 409 INVALID_STATE_TRANSITION.
   */
  async transitionVerification(
    id: string,
    from: DoctorVerificationStatus,
    update: VerificationUpdate,
  ): Promise<Doctor | null> {
    const { count } = await prisma.doctor.updateMany({
      where: { id, verificationStatus: from },
      data: {
        verificationStatus: update.status,
        ...(update.claimedByUserId !== undefined ? { claimedByUserId: update.claimedByUserId } : {}),
        ...(update.verifiedByUserId !== undefined ? { verifiedByUserId: update.verifiedByUserId } : {}),
        ...(update.verifiedAt !== undefined ? { verifiedAt: update.verifiedAt } : {}),
        ...(update.rejectionReason !== undefined ? { rejectionReason: update.rejectionReason } : {}),
        ...(update.suspensionReason !== undefined ? { suspensionReason: update.suspensionReason } : {}),
      },
    });
    if (count === 0) return null;
    return prisma.doctor.findUnique({ where: { id } });
  },
};
