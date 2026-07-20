import { z } from 'zod';
import { languageSchema, paginationSchema, tzPhoneSchema, tzsAmountSchema } from './common.js';
import { passwordSchema } from './auth.schema.js';
import { tzRegionSchema } from './patient.schema.js';

/**
 * Tanzania Medical Council (TMC) registration number.
 * Alphanumeric with optional slashes/dashes, e.g. "TMC/REG/12345".
 */
export const tmcRegistrationNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9/-]{3,29}$/, 'invalid TMC registration number');

export const doctorSpecialtySchema = z.enum([
  'GENERAL_PRACTICE',
  'PEDIATRICS',
  'OBSTETRICS_GYNECOLOGY',
  'INTERNAL_MEDICINE',
  'CARDIOLOGY',
  'DERMATOLOGY',
  'PSYCHIATRY',
  'SURGERY',
  'ORTHOPEDICS',
  'OPHTHALMOLOGY',
  'ENT',
  'DENTISTRY',
  'ONCOLOGY',
  'UROLOGY',
  'NEUROLOGY',
]);
export type DoctorSpecialty = z.infer<typeof doctorSpecialtySchema>;

/** Consultation fee bounds in TZS (roughly 5,000–500,000 TZS at launch). */
export const consultationFeeTzsSchema = tzsAmountSchema
  .min(5_000, 'minimum consultation fee is TZS 5,000')
  .max(500_000, 'maximum consultation fee is TZS 500,000');

/** Doctor self-onboarding (POST /api/v1/doctors/register). */
export const doctorRegistrationSchema = z.object({
  phone: tzPhoneSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(120),
  language: languageSchema,
  tmcRegistrationNumber: tmcRegistrationNumberSchema,
  specialty: doctorSpecialtySchema,
  subSpecialty: z.string().trim().max(100).optional(),
  yearsOfExperience: z.number().int().min(0).max(70),
  consultationFeeTzs: consultationFeeTzsSchema,
  bio: z.string().trim().max(1_000).optional(),
  languages: z.array(z.enum(['sw', 'en'])).min(1).default(['sw']),
  region: tzRegionSchema.optional(),
  acceptsNhif: z.boolean().default(false),
  hospitalId: z.string().optional(),
});
export type DoctorRegistrationInput = z.infer<typeof doctorRegistrationSchema>;

export const updateDoctorProfileSchema = z
  .object({
    subSpecialty: z.string().trim().max(100),
    yearsOfExperience: z.number().int().min(0).max(70),
    consultationFeeTzs: consultationFeeTzsSchema,
    bio: z.string().trim().max(1_000),
    languages: z.array(z.enum(['sw', 'en'])).min(1),
    region: tzRegionSchema,
    acceptsNhif: z.boolean(),
    isAvailable: z.boolean(),
  })
  .partial()
  .strict();
export type UpdateDoctorProfileInput = z.infer<typeof updateDoctorProfileSchema>;

// ─── Verification documents ──────────────────────────────────────────────────

/** Upload field names → DoctorDocumentType (API surface uses the short names). */
export const doctorDocumentFieldSchema = z.enum(['tmc_cert', 'degree', 'id', 'police_clearance']);
export type DoctorDocumentField = z.infer<typeof doctorDocumentFieldSchema>;

export const DOCUMENT_FIELD_TO_TYPE = {
  tmc_cert: 'TMC_CERTIFICATE',
  degree: 'MEDICAL_DEGREE',
  id: 'NATIONAL_ID',
  police_clearance: 'POLICE_CLEARANCE',
} as const satisfies Record<DoctorDocumentField, string>;

/** tmc_cert + degree + id are required for DOCUMENTS_SUBMITTED; police_clearance is optional. */
export const REQUIRED_DOCUMENT_TYPES = ['TMC_CERTIFICATE', 'MEDICAL_DEGREE', 'NATIONAL_ID'] as const;

export const documentReviewSchema = z.object({
  document: doctorDocumentFieldSchema,
  status: z.enum(['APPROVED', 'REJECTED']),
  notes: z.string().trim().max(500).optional(),
});
export type DocumentReviewInput = z.infer<typeof documentReviewSchema>;

/** Admin decision — POST /api/v1/doctors/admin/:id/decision */
export const doctorVerificationDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    notes: z.string().trim().min(10).max(1_000).optional(),
    perDocument: z.array(documentReviewSchema).max(10).default([]),
  })
  .refine((value) => value.decision !== 'REJECTED' || value.notes !== undefined, {
    message: 'rejection requires notes',
    path: ['notes'],
  });
export type DoctorVerificationDecisionInput = z.infer<typeof doctorVerificationDecisionSchema>;

/** Admin suspension — POST /api/v1/doctors/admin/:id/suspend */
export const doctorSuspendSchema = z.object({
  reason: z.string().trim().min(10).max(1_000),
});
export type DoctorSuspendInput = z.infer<typeof doctorSuspendSchema>;

export const verificationQueueQuerySchema = paginationSchema;
export type VerificationQueueQuery = z.infer<typeof verificationQueueQuerySchema>;

export const doctorVerificationStatusSchema = z.enum([
  'PENDING',
  'DOCUMENTS_SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
]);
export type DoctorVerificationStatusValue = z.infer<typeof doctorVerificationStatusSchema>;

/** GET /api/v1/doctors/admin/list — admin list across every status. */
export const adminDoctorListQuerySchema = paginationSchema.extend({
  status: doctorVerificationStatusSchema.optional(),
});
export type AdminDoctorListQuery = z.infer<typeof adminDoctorListQuerySchema>;

// ─── Public directory ────────────────────────────────────────────────────────

export const doctorDirectoryQuerySchema = paginationSchema.extend({
  specialization: doctorSpecialtySchema.optional(),
  region: tzRegionSchema.optional(),
  language: z.enum(['sw', 'en']).optional(),
  acceptsNhif: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  maxFee: z.coerce.number().int().positive().optional(),
});
export type DoctorDirectoryQuery = z.infer<typeof doctorDirectoryQuerySchema>;

// ─── Weekly schedule ─────────────────────────────────────────────────────────

const timeHHmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm (24h)');

export const scheduleBreakSchema = z
  .object({ startTime: timeHHmm, endTime: timeHHmm })
  .refine((value) => value.startTime < value.endTime, {
    message: 'break start must be before its end',
    path: ['endTime'],
  });
export type ScheduleBreak = z.infer<typeof scheduleBreakSchema>;

export const doctorScheduleSlotSchema = z
  .object({
    dayOfWeek: z.number().int().min(0, 'Sunday = 0').max(6, 'Saturday = 6'),
    startTime: timeHHmm,
    endTime: timeHHmm,
    breaks: z.array(scheduleBreakSchema).max(10).default([]),
    slotDurationMinutes: z.number().int().min(10).max(120).default(30),
  })
  .refine((slot) => slot.startTime < slot.endTime, {
    message: 'startTime must be before endTime',
    path: ['endTime'],
  })
  .refine(
    (slot) => slot.breaks.every((b) => b.startTime >= slot.startTime && b.endTime <= slot.endTime),
    { message: 'breaks must fall inside the working window', path: ['breaks'] },
  );
export type DoctorScheduleSlot = z.infer<typeof doctorScheduleSlotSchema>;

/** Windows on the same day must not overlap (HH:mm strings compare lexically). */
const noOverlappingWindows = (slots: DoctorScheduleSlot[]): boolean => {
  const byDay = new Map<number, DoctorScheduleSlot[]>();
  for (const slot of slots) {
    const day = byDay.get(slot.dayOfWeek) ?? [];
    day.push(slot);
    byDay.set(slot.dayOfWeek, day);
  }
  for (const day of byDay.values()) {
    const sorted = [...day].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i]!.startTime < sorted[i - 1]!.endTime) return false;
    }
  }
  return true;
};

export const setDoctorScheduleSchema = z.object({
  slots: z
    .array(doctorScheduleSlotSchema)
    .min(1)
    .max(50)
    .refine(noOverlappingWindows, 'schedule windows on the same day must not overlap'),
});
export type SetDoctorScheduleInput = z.infer<typeof setDoctorScheduleSchema>;

/** GET /api/v1/doctors/:id/availability?date=YYYY-MM-DD */
export const availabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
