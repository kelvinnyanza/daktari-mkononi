import { z } from 'zod';
import { idSchema } from './common.js';

/** ICD-10 code, e.g. "B50.9" (malaria), "J06.9", "A09". */
export const icd10CodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-TV-Z]\d{2}(\.\d{1,2})?$/, 'invalid ICD-10 code');
export type Icd10Code = z.infer<typeof icd10CodeSchema>;

export const diagnosisSchema = z.object({
  icd10Code: icd10CodeSchema,
  description: z.string().trim().min(3).max(500),
  isPrimary: z.boolean().default(false),
});
export type DiagnosisInput = z.infer<typeof diagnosisSchema>;

export const startConsultationSchema = z.object({
  appointmentId: idSchema,
});
export type StartConsultationInput = z.infer<typeof startConsultationSchema>;

export const completeConsultationSchema = z
  .object({
    consultationId: idSchema,
    chiefComplaint: z.string().trim().min(3).max(1_000),
    clinicalNotes: z.string().trim().min(3).max(10_000),
    diagnoses: z.array(diagnosisSchema).min(1).max(10),
    followUpRequired: z.boolean().default(false),
    followUpDate: z.coerce.date().optional(),
    referredToInPerson: z.boolean().default(false),
  })
  .refine((value) => !value.followUpRequired || value.followUpDate !== undefined, {
    message: 'followUpDate is required when followUpRequired is true',
    path: ['followUpDate'],
  })
  .refine(
    (value) => value.diagnoses.filter((diagnosis) => diagnosis.isPrimary).length <= 1,
    { message: 'at most one diagnosis may be marked primary', path: ['diagnoses'] },
  );
export type CompleteConsultationInput = z.infer<typeof completeConsultationSchema>;

export const rateConsultationSchema = z.object({
  consultationId: idSchema,
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1_000).optional(),
});
export type RateConsultationInput = z.infer<typeof rateConsultationSchema>;
