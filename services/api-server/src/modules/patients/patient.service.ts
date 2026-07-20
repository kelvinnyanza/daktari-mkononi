import type { Patient, PatientWithUser, Prisma } from '@daktari/db';
import type { ListPatientsQuery, UpdatePatientProfileInput } from '@daktari/schemas';
import { ApiError, msg } from '../../lib/errors.js';
import type { PatientRepoPort, UserRepoPort } from '../../lib/ports.js';

const PATIENT_NOT_FOUND = (): ApiError =>
  new ApiError(404, 'PATIENT_NOT_FOUND', msg('Mgonjwa hajapatikana', 'Patient not found'));

/** Fields the patient must fill for a "complete" profile (drives onboarding UX). */
const COMPLETION_FIELDS = [
  'region',
  'district',
  'ward',
  'street',
  'emergencyContactName',
  'heightCm',
  'weightKg',
] as const;

export interface PatientProfileView {
  patientNumber: string;
  dateOfBirth: Date;
  gender: Patient['gender'];
  bloodType: Patient['bloodType'];
  region: string;
  district: string;
  ward: string | null;
  street: string | null;
  address: string | null;
  heightCm: number | null;
  weightKg: number | null;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  nhifCardNumber: string | null;
  nhifVerified: boolean;
  emergencyContact: { name: string; phone: string; relationship: string } | null;
  profileCompletion: { complete: boolean; missingFields: string[] };
  /** Present on own-profile reads only (mobile NHIF gating). */
  insurance?: { verifiedNhif: boolean };
}

export interface PatientServiceDeps {
  patients: PatientRepoPort;
  users: UserRepoPort;
}

export class PatientService {
  constructor(private readonly deps: PatientServiceDeps) {}

  /** The caller's own Patient row; 404 for non-patient accounts. */
  private async ownPatient(userId: string): Promise<Patient> {
    const patient = await this.deps.patients.findByUserId(userId);
    if (!patient) throw PATIENT_NOT_FOUND();
    return patient;
  }

  private toView(patient: Patient): PatientProfileView {
    const missingFields = COMPLETION_FIELDS.filter((field) => {
      const value = patient[field];
      return value === null || value === '' || value === 'UNKNOWN';
    });
    return {
      patientNumber: patient.patientNumber,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      bloodType: patient.bloodType,
      region: patient.region,
      district: patient.district,
      ward: patient.ward,
      street: patient.street,
      address: patient.address,
      heightCm: patient.heightCm,
      weightKg: patient.weightKg,
      allergies: patient.allergies,
      chronicConditions: patient.chronicConditions,
      currentMedications: patient.currentMedications,
      nhifCardNumber: patient.nhifCardNumber,
      nhifVerified: patient.nhifVerifiedAt !== null,
      emergencyContact:
        patient.emergencyContactName !== null &&
        patient.emergencyContactPhone !== null &&
        patient.emergencyContactRelationship !== null
          ? {
              name: patient.emergencyContactName,
              phone: patient.emergencyContactPhone,
              relationship: patient.emergencyContactRelationship,
            }
          : null,
      profileCompletion: { complete: missingFields.length === 0, missingFields },
    };
  }

  async getOwnProfile(userId: string): Promise<PatientProfileView> {
    const patient = await this.ownPatient(userId);
    const verifiedNhif = await this.deps.patients.findVerifiedInsurance(
      patient.id,
      'NHIF',
      new Date(),
    );
    return {
      ...this.toView(patient),
      // Mobile booking gates the NHIF payment intent on this flag (Phase 9).
      insurance: { verifiedNhif: verifiedNhif !== null },
    };
  }

  /**
   * Patient-editable fields only. The schema is `.strict()`, so platform-owned
   * fields (patientNumber, nhifVerifiedAt, userId, …) are rejected upstream
   * with 400 — nothing here can touch them. Setting nhifCardNumber resets the
   * verification state: a new number is unverified by definition.
   */
  async updateOwnProfile(
    userId: string,
    input: UpdatePatientProfileInput,
  ): Promise<PatientProfileView> {
    const patient = await this.ownPatient(userId);

    const data: Prisma.PatientUpdateInput = {
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.district !== undefined ? { district: input.district } : {}),
      ...(input.ward !== undefined ? { ward: input.ward } : {}),
      ...(input.street !== undefined ? { street: input.street } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.heightCm !== undefined ? { heightCm: input.heightCm } : {}),
      ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
      ...(input.bloodType !== undefined ? { bloodType: input.bloodType } : {}),
      ...(input.allergies !== undefined ? { allergies: input.allergies } : {}),
      ...(input.chronicConditions !== undefined
        ? { chronicConditions: input.chronicConditions }
        : {}),
      ...(input.currentMedications !== undefined
        ? { currentMedications: input.currentMedications }
        : {}),
      ...(input.nhifCardNumber !== undefined
        ? { nhifCardNumber: input.nhifCardNumber, nhifVerifiedAt: null }
        : {}),
      ...(input.emergencyContact !== undefined
        ? {
            emergencyContactName: input.emergencyContact.name,
            emergencyContactPhone: input.emergencyContact.phone,
            emergencyContactRelationship: input.emergencyContact.relationship,
          }
        : {}),
    };

    const updated = await this.deps.patients.update(patient.id, data);
    if (input.language !== undefined) {
      await this.deps.users.update(userId, { language: input.language === 'en' ? 'EN' : 'SW' });
    }
    return this.toView(updated);
  }

  /** Admin read (permission patient:read:any) — audited as a PHI read. */
  async adminGetPatient(patientId: string): Promise<{
    profile: PatientProfileView;
    user: { id: string; phone: string; fullName: string };
  }> {
    const patient = await this.deps.patients.findByIdWithUser(patientId);
    if (!patient) throw PATIENT_NOT_FOUND();
    return {
      profile: this.toView(patient),
      user: { id: patient.user.id, phone: patient.user.phone, fullName: patient.user.fullName },
    };
  }

  async adminListPatients(query: ListPatientsQuery): Promise<{
    items: Array<{ id: string; patientNumber: string; fullName: string; region: string; district: string }>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const { items, total } = await this.deps.patients.list({
      ...(query.region !== undefined ? { region: query.region } : {}),
      ...(query.district !== undefined ? { district: query.district } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: items.map((patient: PatientWithUser) => ({
        id: patient.id,
        patientNumber: patient.patientNumber,
        fullName: patient.user.fullName,
        region: patient.region,
        district: patient.district,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
}
