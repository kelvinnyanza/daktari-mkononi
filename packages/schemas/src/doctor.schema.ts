import { z } from 'zod';
import { tzsAmountSchema } from './common.js';

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

export const createDoctorProfileSchema = z.object({
  tmcRegistrationNumber: tmcRegistrationNumberSchema,
  specialty: doctorSpecialtySchema,
  subSpecialty: z.string().trim().max(100).optional(),
  yearsOfExperience: z.number().int().min(0).max(70),
  consultationFeeTzs: consultationFeeTzsSchema,
  bio: z.string().trim().max(1_000).optional(),
  languages: z.array(z.enum(['sw', 'en'])).min(1).default(['sw']),
  hospitalId: z.string().optional(),
});
export type CreateDoctorProfileInput = z.infer<typeof createDoctorProfileSchema>;

export const updateDoctorProfileSchema = createDoctorProfileSchema
  .omit({ tmcRegistrationNumber: true })
  .partial();
export type UpdateDoctorProfileInput = z.infer<typeof updateDoctorProfileSchema>;

const timeHHmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm (24h)');

export const doctorScheduleSlotSchema = z
  .object({
    dayOfWeek: z.number().int().min(0, 'Sunday = 0').max(6, 'Saturday = 6'),
    startTime: timeHHmm,
    endTime: timeHHmm,
    slotDurationMinutes: z.number().int().min(10).max(120).default(30),
  })
  .refine((slot) => slot.startTime < slot.endTime, {
    message: 'startTime must be before endTime',
    path: ['endTime'],
  });
export type DoctorScheduleSlot = z.infer<typeof doctorScheduleSlotSchema>;

export const setDoctorScheduleSchema = z.object({
  slots: z.array(doctorScheduleSlotSchema).min(1).max(50),
});
export type SetDoctorScheduleInput = z.infer<typeof setDoctorScheduleSchema>;

export const doctorVerificationDecisionSchema = z.object({
  doctorId: z.string().min(1),
  decision: z.enum(['VERIFIED', 'REJECTED']),
  rejectionReason: z.string().trim().min(10).max(1_000).optional(),
});
export type DoctorVerificationDecisionInput = z.infer<typeof doctorVerificationDecisionSchema>;
