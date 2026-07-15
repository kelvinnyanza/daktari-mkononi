import { z } from 'zod';
import { dateOnlySchema, tzPhoneSchema } from './common.js';

export const genderSchema = z.enum(['MALE', 'FEMALE']);
export type Gender = z.infer<typeof genderSchema>;

export const bloodTypeSchema = z.enum(['A_POS', 'A_NEG', 'B_POS', 'B_NEG', 'AB_POS', 'AB_NEG', 'O_POS', 'O_NEG']);
export type BloodType = z.infer<typeof bloodTypeSchema>;

/** Tanzania mainland + Zanzibar regions used at launch; free-text kept out on purpose. */
export const tzRegionSchema = z.enum([
  'DAR_ES_SALAAM',
  'MWANZA',
  'ARUSHA',
  'DODOMA',
  'MBEYA',
  'MOROGORO',
  'TANGA',
  'KILIMANJARO',
  'ZANZIBAR_MJINI_MAGHARIBI',
  'OTHER',
]);
export type TzRegion = z.infer<typeof tzRegionSchema>;

export const emergencyContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: tzPhoneSchema,
  relationship: z.string().trim().min(2).max(50),
});
export type EmergencyContact = z.infer<typeof emergencyContactSchema>;

export const createPatientProfileSchema = z.object({
  dateOfBirth: dateOnlySchema
    .refine((date) => date.getTime() < Date.now(), 'date of birth must be in the past')
    .refine(
      (date) => date.getTime() > Date.parse('1900-01-01T00:00:00.000Z'),
      'date of birth is unrealistically old',
    ),
  gender: genderSchema,
  bloodType: bloodTypeSchema.optional(),
  region: tzRegionSchema,
  district: z.string().trim().min(2).max(100),
  address: z.string().trim().max(300).optional(),
  allergies: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  chronicConditions: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  emergencyContact: emergencyContactSchema.optional(),
  nhifCardNumber: z
    .string()
    .regex(/^\d{8,12}$/, 'NHIF card number is 8–12 digits')
    .optional(),
});
export type CreatePatientProfileInput = z.infer<typeof createPatientProfileSchema>;

export const updatePatientProfileSchema = createPatientProfileSchema.partial();
export type UpdatePatientProfileInput = z.infer<typeof updatePatientProfileSchema>;
