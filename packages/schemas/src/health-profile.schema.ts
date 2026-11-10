import { z } from 'zod';
import { tzPhoneSchema } from './common.js';
import { genderSchema, tzRegionSchema } from './patient.schema.js';

/**
 * Patient health profile (UI Phase 2) — PUT /api/v1/patients/me/health-profile.
 *
 * Validation messages are stable CODES (e.g. 'AGE_UNDER_MINIMUM'), not prose:
 * the app translates them (sw first) and the server returns them in the 400.
 */

/** Patients must be adults: there is no guardian-consent flow (PDPA, child = under 18). */
export const MIN_PATIENT_AGE_YEARS = 18;
export const MAX_PATIENT_AGE_YEARS = 120;

/** Bumped whenever the health-data consent wording changes; stored with the consent. */
export const HEALTH_CONSENT_VERSION = 'health-v1-2026-11';

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Today's calendar date in Africa/Dar_es_Salaam (UTC+3, no DST) as Y/M/D numbers. */
function eatCalendarDate(now: Date): { y: number; m: number; d: number } {
  const eat = new Date(now.getTime() + EAT_OFFSET_MS);
  return { y: eat.getUTCFullYear(), m: eat.getUTCMonth() + 1, d: eat.getUTCDate() };
}

/**
 * Completed years between a date of birth (a date-only value, stored as UTC
 * midnight) and `now`, counted on the EAT calendar. Birthdays on 29 Feb count
 * from 1 Mar in non-leap years.
 */
export function ageInYears(dateOfBirth: Date, now: Date): number {
  const today = eatCalendarDate(now);
  const by = dateOfBirth.getUTCFullYear();
  const bm = dateOfBirth.getUTCMonth() + 1;
  const bd = dateOfBirth.getUTCDate();
  let age = today.y - by;
  if (today.m < bm || (today.m === bm && today.d < bd)) age -= 1;
  return age;
}

/** 'YYYY-MM-DD' that is a real calendar date (rejects 2023-02-31). */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'DATE_FORMAT')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'DATE_INVALID');

/**
 * Adult date of birth: a real date, not in the future, age between
 * MIN_PATIENT_AGE_YEARS and MAX_PATIENT_AGE_YEARS. `now` is injectable for tests.
 */
export function adultDateOfBirthSchema(now: () => Date = () => new Date()) {
  return calendarDateSchema
    .transform((value) => new Date(`${value}T00:00:00.000Z`))
    .superRefine((date, ctx) => {
      const current = now();
      const today = eatCalendarDate(current);
      const todayUtc = Date.UTC(today.y, today.m - 1, today.d);
      if (date.getTime() > todayUtc) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DATE_IN_FUTURE' });
        return;
      }
      const age = ageInYears(date, current);
      if (age < MIN_PATIENT_AGE_YEARS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AGE_UNDER_MINIMUM' });
      } else if (age > MAX_PATIENT_AGE_YEARS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AGE_UNREALISTIC' });
      }
    });
}

/** "Do you have high blood pressure?" */
export const bpHistorySchema = z.enum(['NONE', 'YES_ON_MEDICATION', 'YES_NO_MEDICATION', 'UNKNOWN']);
export type BpHistory = z.infer<typeof bpHistorySchema>;

/** Blood group answer — a known type, or "Sijui" (UNKNOWN). */
export const bloodGroupAnswerSchema = z.enum([
  'A_POS',
  'A_NEG',
  'B_POS',
  'B_NEG',
  'AB_POS',
  'AB_NEG',
  'O_POS',
  'O_NEG',
  'UNKNOWN',
]);
export type BloodGroupAnswer = z.infer<typeof bloodGroupAnswerSchema>;

/** Adult ranges (patients are 18+): catches typos like 17 cm or 6 kg. */
export const HEIGHT_CM_RANGE = { min: 100, max: 250 } as const;
export const WEIGHT_KG_RANGE = { min: 25, max: 300 } as const;

const healthListSchema = z
  .array(z.string().trim().min(1, 'TEXT_REQUIRED').max(200, 'TEXT_TOO_LONG'))
  .max(30, 'LIST_TOO_LONG');

export const healthEmergencyContactSchema = z.object({
  name: z.string().trim().min(2, 'NAME_TOO_SHORT').max(120, 'TEXT_TOO_LONG'),
  phone: tzPhoneSchema,
});

export function makeHealthProfileInputSchema(now: () => Date = () => new Date()) {
  return z
    .object({
      dateOfBirth: adultDateOfBirthSchema(now),
      sex: genderSchema,
      heightCm: z
        .number({ invalid_type_error: 'NUMBER_REQUIRED', required_error: 'REQUIRED' })
        .min(HEIGHT_CM_RANGE.min, 'HEIGHT_RANGE')
        .max(HEIGHT_CM_RANGE.max, 'HEIGHT_RANGE'),
      weightKg: z
        .number({ invalid_type_error: 'NUMBER_REQUIRED', required_error: 'REQUIRED' })
        .min(WEIGHT_KG_RANGE.min, 'WEIGHT_RANGE')
        .max(WEIGHT_KG_RANGE.max, 'WEIGHT_RANGE'),
      region: tzRegionSchema,
      district: z.string().trim().min(2, 'DISTRICT_REQUIRED').max(100, 'TEXT_TOO_LONG'),
      bpHistory: bpHistorySchema,
      bloodGroup: bloodGroupAnswerSchema.optional(),
      allergies: healthListSchema.default([]),
      chronicConditions: healthListSchema.default([]),
      currentMedications: healthListSchema.default([]),
      emergencyContact: healthEmergencyContactSchema.optional(),
      /** PDPA: explicit consent to store health information — must be literally true. */
      consent: z.literal(true, { errorMap: () => ({ message: 'CONSENT_REQUIRED' }) }),
    })
    .strict();
}

export const healthProfileInputSchema = makeHealthProfileInputSchema();
export type HealthProfileInput = z.infer<typeof healthProfileInputSchema>;

/**
 * The clinical part of the profile, stored as ONE encrypted blob
 * (Patient.encryptedHealthProfile, encryptHealthData). Parsed on read so a
 * corrupt or foreign blob fails loudly instead of leaking a half-shape.
 */
export const storedHealthProfileSchema = z.object({
  heightCm: z.number().nullable(),
  weightKg: z.number().nullable(),
  bpHistory: bpHistorySchema.nullable(),
  bloodGroup: bloodGroupAnswerSchema.nullable(),
  allergies: z.array(z.string()),
  chronicConditions: z.array(z.string()),
  currentMedications: z.array(z.string()),
});
export type StoredHealthProfile = z.infer<typeof storedHealthProfileSchema>;

/** GET /api/v1/patients/me/health-profile */
export interface HealthProfileView {
  dateOfBirth: string | null; // YYYY-MM-DD
  age: number | null;
  sex: 'MALE' | 'FEMALE' | 'UNDISCLOSED' | null;
  heightCm: number | null;
  weightKg: number | null;
  region: string | null; // code, null while unset
  district: string | null;
  bpHistory: BpHistory | null;
  bloodGroup: BloodGroupAnswer | null;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  emergencyContact: { name: string; phone: string } | null;
  consentGivenAt: string | null;
  /** True once saved with consent and every required field present. */
  completed: boolean;
}
