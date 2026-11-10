/**
 * Patient health profile codec (UI Phase 2).
 *
 * The clinical fields (height, weight, BP history, blood group, allergies,
 * chronic conditions, medications) are stored as ONE encryptHealthData v1
 * blob in Patient.encryptedHealthProfile — never as plaintext columns.
 *
 * Rows written before Phase 2 may still hold the LEGACY plaintext columns
 * (bloodType, heightCm, weightKg, allergies, chronicConditions,
 * currentMedications). Readers fall back to them only while a row has no
 * blob; every write goes to the blob and clears them (LEGACY_CLEARED), and
 * `pnpm --filter @daktari/api-server health:encrypt-backfill` migrates the
 * rest. Dropping those columns is a follow-up migration once the backfill has
 * run in every environment.
 */
import type { Patient, Prisma } from '@daktari/db';
import { decryptHealthData, encryptHealthData } from '@daktari/encryption';
import {
  ageInYears,
  storedHealthProfileSchema,
  type HealthProfileView,
  type StoredHealthProfile,
} from '@daktari/schemas';

export const EMPTY_HEALTH_PROFILE: StoredHealthProfile = {
  heightCm: null,
  weightKg: null,
  bpHistory: null,
  bloodGroup: null,
  allergies: [],
  chronicConditions: [],
  currentMedications: [],
};

/** Prisma update that empties the legacy plaintext health columns. */
export const LEGACY_CLEARED = {
  bloodType: null,
  heightCm: null,
  weightKg: null,
  allergies: [],
  chronicConditions: [],
  currentMedications: [],
} satisfies Prisma.PatientUpdateInput;

type HealthColumns = Pick<
  Patient,
  | 'encryptedHealthProfile'
  | 'bloodType'
  | 'heightCm'
  | 'weightKg'
  | 'allergies'
  | 'chronicConditions'
  | 'currentMedications'
>;

/** Blob first; legacy plaintext columns only for rows that have no blob yet. */
export function readHealthProfile(patient: HealthColumns): StoredHealthProfile {
  if (patient.encryptedHealthProfile !== null) {
    return storedHealthProfileSchema.parse(JSON.parse(decryptHealthData(patient.encryptedHealthProfile)));
  }
  return {
    heightCm: patient.heightCm,
    weightKg: patient.weightKg,
    bpHistory: null,
    bloodGroup: patient.bloodType,
    allergies: patient.allergies,
    chronicConditions: patient.chronicConditions,
    currentMedications: patient.currentMedications,
  };
}

export function encodeHealthProfile(profile: StoredHealthProfile): string {
  return encryptHealthData(JSON.stringify(storedHealthProfileSchema.parse(profile)));
}

/** True for rows that still carry plaintext health data (backfill candidates). */
export function hasLegacyHealthData(patient: HealthColumns): boolean {
  return (
    patient.bloodType !== null ||
    patient.heightCm !== null ||
    patient.weightKg !== null ||
    patient.allergies.length > 0 ||
    patient.chronicConditions.length > 0 ||
    patient.currentMedications.length > 0
  );
}

function dateOnly(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}

/** The patient's own view (and the source for the doctor's read-only panel). */
export function toHealthProfileView(patient: Patient, now: Date): HealthProfileView {
  const health = readHealthProfile(patient);
  const region = patient.region === 'UNKNOWN' || patient.region === '' ? null : patient.region;
  const district = patient.district === 'UNKNOWN' || patient.district === '' ? null : patient.district;
  const completed =
    patient.healthConsentAt !== null &&
    patient.dateOfBirth !== null &&
    patient.gender !== null &&
    health.heightCm !== null &&
    health.weightKg !== null &&
    health.bpHistory !== null &&
    region !== null &&
    district !== null;
  return {
    dateOfBirth: dateOnly(patient.dateOfBirth),
    age: patient.dateOfBirth === null ? null : ageInYears(patient.dateOfBirth, now),
    sex: patient.gender,
    heightCm: health.heightCm,
    weightKg: health.weightKg,
    region,
    district,
    bpHistory: health.bpHistory,
    bloodGroup: health.bloodGroup,
    allergies: health.allergies,
    chronicConditions: health.chronicConditions,
    currentMedications: health.currentMedications,
    emergencyContact:
      patient.emergencyContactName !== null && patient.emergencyContactPhone !== null
        ? { name: patient.emergencyContactName, phone: patient.emergencyContactPhone }
        : null,
    consentGivenAt: patient.healthConsentAt?.toISOString() ?? null,
    completed,
  };
}
