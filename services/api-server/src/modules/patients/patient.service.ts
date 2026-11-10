import type { Patient, PatientWithUser, Prisma } from '@daktari/db';
import {
  HEALTH_CONSENT_VERSION,
  type HealthProfileInput,
  type HealthProfileView,
  type ListPatientsQuery,
  type UpdatePatientProfileInput,
} from '@daktari/schemas';
import { ApiError, msg } from '../../lib/errors.js';
import type { AuditLogPort, PatientRepoPort, UserRepoPort } from '../../lib/ports.js';
import {
  encodeHealthProfile,
  LEGACY_CLEARED,
  readHealthProfile,
  toHealthProfileView,
} from './health-profile.js';

const PATIENT_NOT_FOUND = (): ApiError =>
  new ApiError(404, 'PATIENT_NOT_FOUND', msg('Mgonjwa hajapatikana', 'Patient not found'));

const HEALTH_CONSENT_REQUIRED = (): ApiError =>
  new ApiError(
    409,
    'HEALTH_CONSENT_REQUIRED',
    msg(
      'Kubali kuhifadhi taarifa zako za afya kwanza',
      'Agree to storing your health information first',
    ),
  );

/** Address/contact fields the patient must fill for a "complete" profile. */
const COMPLETION_FIELDS = ['region', 'district', 'ward', 'street', 'emergencyContactName'] as const;

export interface PatientProfileView {
  patientNumber: string;
  dateOfBirth: Date | null;
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
  emergencyContact: { name: string; phone: string; relationship: string | null } | null;
  /** Health profile saved (with consent)? Drives the Home "complete your profile" card. */
  healthProfileCompleted: boolean;
  profileCompletion: { complete: boolean; missingFields: string[] };
  /** Present on own-profile reads only (mobile NHIF gating). */
  insurance?: { verifiedNhif: boolean };
}

/**
 * Admin view: identity, address and NHIF only. The clinical fields are left
 * out (and the encrypted blob is never decrypted) — patients are told only
 * the doctor treating them sees their health profile.
 */
export type AdminPatientProfileView = Omit<
  PatientProfileView,
  'heightCm' | 'weightKg' | 'bloodType' | 'allergies' | 'chronicConditions' | 'currentMedications'
>;

export interface PatientServiceDeps {
  patients: PatientRepoPort;
  users: UserRepoPort;
  auditLogs: AuditLogPort;
}

export class PatientService {
  constructor(
    private readonly deps: PatientServiceDeps,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
    const health = readHealthProfile(patient);
    return {
      patientNumber: patient.patientNumber,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      bloodType: health.bloodGroup === 'UNKNOWN' ? null : health.bloodGroup,
      region: patient.region,
      district: patient.district,
      ward: patient.ward,
      street: patient.street,
      address: patient.address,
      heightCm: health.heightCm,
      weightKg: health.weightKg,
      allergies: health.allergies,
      chronicConditions: health.chronicConditions,
      currentMedications: health.currentMedications,
      nhifCardNumber: patient.nhifCardNumber,
      nhifVerified: patient.nhifVerifiedAt !== null,
      emergencyContact:
        patient.emergencyContactName !== null && patient.emergencyContactPhone !== null
          ? {
              name: patient.emergencyContactName,
              phone: patient.emergencyContactPhone,
              relationship: patient.emergencyContactRelationship,
            }
          : null,
      healthProfileCompleted: toHealthProfileView(patient, this.now()).completed,
      profileCompletion: { complete: missingFields.length === 0, missingFields },
    };
  }

  private toAdminView(patient: Patient): AdminPatientProfileView {
    const missingFields = COMPLETION_FIELDS.filter((field) => {
      const value = patient[field];
      return value === null || value === '' || value === 'UNKNOWN';
    });
    return {
      patientNumber: patient.patientNumber,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      region: patient.region,
      district: patient.district,
      ward: patient.ward,
      street: patient.street,
      address: patient.address,
      nhifCardNumber: patient.nhifCardNumber,
      nhifVerified: patient.nhifVerifiedAt !== null,
      emergencyContact:
        patient.emergencyContactName !== null && patient.emergencyContactPhone !== null
          ? {
              name: patient.emergencyContactName,
              phone: patient.emergencyContactPhone,
              relationship: patient.emergencyContactRelationship,
            }
          : null,
      // Completion only (consent stamp) — no decrypt on an admin read.
      healthProfileCompleted: patient.healthConsentAt !== null && patient.encryptedHealthProfile !== null,
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

    // Health fields go into the encrypted blob — and only with consent (PDPA).
    const touchesHealth =
      input.heightCm !== undefined ||
      input.weightKg !== undefined ||
      input.bloodType !== undefined ||
      input.allergies !== undefined ||
      input.chronicConditions !== undefined ||
      input.currentMedications !== undefined;
    let healthData: Prisma.PatientUpdateInput = {};
    if (touchesHealth) {
      if (patient.healthConsentAt === null) throw HEALTH_CONSENT_REQUIRED();
      const current = readHealthProfile(patient);
      healthData = {
        ...LEGACY_CLEARED,
        encryptedHealthProfile: encodeHealthProfile({
          ...current,
          ...(input.heightCm !== undefined ? { heightCm: input.heightCm } : {}),
          ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
          ...(input.bloodType !== undefined ? { bloodGroup: input.bloodType } : {}),
          ...(input.allergies !== undefined ? { allergies: input.allergies } : {}),
          ...(input.chronicConditions !== undefined ? { chronicConditions: input.chronicConditions } : {}),
          ...(input.currentMedications !== undefined ? { currentMedications: input.currentMedications } : {}),
        }),
        healthProfileUpdatedAt: this.now(),
      };
    }

    const data: Prisma.PatientUpdateInput = {
      ...healthData,
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.district !== undefined ? { district: input.district } : {}),
      ...(input.ward !== undefined ? { ward: input.ward } : {}),
      ...(input.street !== undefined ? { street: input.street } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
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

  /** The caller's health profile (PHI read — the route is audited). */
  async getOwnHealthProfile(userId: string): Promise<HealthProfileView> {
    return toHealthProfileView(await this.ownPatient(userId), this.now());
  }

  /**
   * Save the whole health profile (PUT semantics: optional fields omitted are
   * cleared). Requires consent === true (schema-enforced); the first consent —
   * or consent to a new wording version — is stamped and explicitly audited.
   * DOB, sex, region, district and the emergency contact are plain columns;
   * the clinical fields go into the encrypted blob and the legacy plaintext
   * columns are cleared in the same write.
   */
  async saveOwnHealthProfile(userId: string, input: HealthProfileInput): Promise<HealthProfileView> {
    const patient = await this.ownPatient(userId);
    const now = this.now();
    const newConsent =
      patient.healthConsentAt === null || patient.healthConsentVersion !== HEALTH_CONSENT_VERSION;

    const contact = input.emergencyContact;
    const updated = await this.deps.patients.update(patient.id, {
      ...LEGACY_CLEARED,
      dateOfBirth: input.dateOfBirth,
      gender: input.sex,
      region: input.region,
      district: input.district,
      emergencyContactName: contact?.name ?? null,
      emergencyContactPhone: contact?.phone ?? null,
      // Relationship is not asked here; keep it only while the contact is the same person.
      emergencyContactRelationship:
        contact !== undefined && contact.name === patient.emergencyContactName
          ? patient.emergencyContactRelationship
          : null,
      encryptedHealthProfile: encodeHealthProfile({
        heightCm: input.heightCm,
        weightKg: input.weightKg,
        bpHistory: input.bpHistory,
        bloodGroup: input.bloodGroup ?? null,
        allergies: input.allergies,
        chronicConditions: input.chronicConditions,
        currentMedications: input.currentMedications,
      }),
      healthProfileUpdatedAt: now,
      ...(newConsent ? { healthConsentAt: now, healthConsentVersion: HEALTH_CONSENT_VERSION } : {}),
    });

    if (newConsent) {
      await this.deps.auditLogs.append({
        actorUserId: userId,
        action: 'HEALTH_DATA_CONSENT_GIVEN',
        resourceType: 'Patient',
        resourceId: patient.id,
        ipAddress: null,
        userAgent: null,
        metadata: { version: HEALTH_CONSENT_VERSION },
      });
    }
    return toHealthProfileView(updated, now);
  }

  /** Admin read (permission patient:read:any) — audited as a PHI read. */
  async adminGetPatient(patientId: string): Promise<{
    profile: AdminPatientProfileView;
    user: { id: string; phone: string; fullName: string };
  }> {
    const patient = await this.deps.patients.findByIdWithUser(patientId);
    if (!patient) throw PATIENT_NOT_FOUND();
    return {
      profile: this.toAdminView(patient),
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
