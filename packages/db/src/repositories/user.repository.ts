import type { Doctor, Gender, Language, Patient, Prisma, User } from '@prisma/client';
import { prisma } from '../client.js';

export interface CreatePatientUserInput {
  phone: string;
  passwordHash: string;
  fullName: string;
  language: Language;
  dateOfBirth: Date;
  gender: Gender;
}

export interface CreateDoctorUserInput {
  phone: string;
  passwordHash: string;
  fullName: string;
  language: Language;
  tmcRegistrationNumber: string;
  specialty: string;
  subSpecialty?: string | null;
  yearsOfExperience: number;
  consultationFeeTzs: number;
  bio?: string | null;
  languages: string[];
  region?: string | null;
  acceptsNhif?: boolean;
  hospitalId?: string | null;
}

export type UserWithProfiles = User & { patient: Patient | null; doctor: Doctor | null };

/**
 * Users are soft-deleted (PDPA 2022 retention rules apply before hard purge);
 * every read here filters deletedAt: null.
 */
export const userRepository = {
  findById(id: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { id, deletedAt: null } });
  },

  findByPhone(phone: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { phone, deletedAt: null } });
  },

  create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  },

  update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  },

  softDelete(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  },

  findByIdWithProfiles(id: string): Promise<UserWithProfiles | null> {
    return prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { patient: true, doctor: true },
    });
  },

  /** Registration: user + patient profile in one transaction. Region/district land in onboarding. */
  createPatientUser(input: CreatePatientUserInput): Promise<User> {
    return prisma.user.create({
      data: {
        phone: input.phone,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        role: 'PATIENT',
        language: input.language,
        patient: {
          create: {
            dateOfBirth: input.dateOfBirth,
            gender: input.gender,
            region: 'UNKNOWN',
            district: 'UNKNOWN',
          },
        },
      },
    });
  },

  /** Doctor onboarding: user + doctor profile (verificationStatus PENDING) in one create. */
  createDoctorUser(input: CreateDoctorUserInput): Promise<User> {
    return prisma.user.create({
      data: {
        phone: input.phone,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        role: 'DOCTOR',
        language: input.language,
        doctor: {
          create: {
            tmcRegistrationNumber: input.tmcRegistrationNumber,
            specialty: input.specialty,
            subSpecialty: input.subSpecialty ?? null,
            yearsOfExperience: input.yearsOfExperience,
            consultationFeeTzs: input.consultationFeeTzs,
            bio: input.bio ?? null,
            languages: input.languages,
            region: input.region ?? null,
            acceptsNhif: input.acceptsNhif ?? false,
            hospitalId: input.hospitalId ?? null,
          },
        },
      },
    });
  },

  markPhoneVerified(id: string): Promise<User> {
    return prisma.user.update({ where: { id }, data: { phoneVerifiedAt: new Date() } });
  },

  /** Increment the failure counter and (optionally) set the lockout timestamp. */
  recordFailedLogin(id: string, lockedUntil: Date | null): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { failedLoginCount: { increment: 1 }, lockedUntil },
    });
  },

  resetLoginFailures(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  },

  updatePassword(id: string, passwordHash: string): Promise<User> {
    return prisma.user.update({ where: { id }, data: { passwordHash } });
  },
};
