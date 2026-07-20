import { z } from 'zod';
import { idSchema, paginationSchema } from './common.js';

/** ICD-10 code: letter + 2 digits + optional .subcode — e.g. "B50.9", "A09". */
export const icd10CodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-TV-Z]\d{2}(\.\d{1,2})?$/, 'invalid ICD-10 code');
export type Icd10Code = z.infer<typeof icd10CodeSchema>;

export const diagnosisTypeSchema = z.enum(['PRIMARY', 'SECONDARY', 'DIFFERENTIAL']);
export type DiagnosisType = z.infer<typeof diagnosisTypeSchema>;

export const addDiagnosisSchema = z.object({
  icd10Code: icd10CodeSchema,
  description: z.string().trim().min(3).max(500),
  type: diagnosisTypeSchema.default('SECONDARY'),
});
export type AddDiagnosisInput = z.infer<typeof addDiagnosisSchema>;

export const startConsultationSchema = z.object({
  appointmentId: idSchema,
});
export type StartConsultationInput = z.infer<typeof startConsultationSchema>;

/**
 * Clinical documentation — PATCH /consultations/:id/notes, doctor-only, only
 * while IN_PROGRESS. All of these free-text fields are stored inside ONE
 * encrypted blob (encryptHealthData); none of them may land in a plaintext
 * column.
 */
export const consultationNotesSchema = z
  .object({
    chiefComplaint: z.string().trim().min(3).max(1_000),
    historyOfPresentIllness: z.string().trim().min(3).max(5_000),
    examination: z.string().trim().min(3).max(5_000),
    assessment: z.string().trim().min(3).max(5_000),
    plan: z.string().trim().min(3).max(5_000),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one field must be provided');
export type ConsultationNotesInput = z.infer<typeof consultationNotesSchema>;

/** The decrypted shape of Consultation.encryptedNotes. */
export interface ClinicalNotes {
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  examination?: string;
  assessment?: string;
  plan?: string;
}

export const referralSchema = z
  .object({
    referredToInPerson: z.boolean(),
    referralNotes: z.string().trim().max(1_000).optional(),
    followUpRequired: z.boolean(),
    followUpDate: z.coerce.date().optional(),
  })
  .partial()
  .strict()
  .refine(
    (value) => value.followUpRequired !== true || value.followUpDate !== undefined,
    { message: 'followUpDate is required when followUpRequired is true', path: ['followUpDate'] },
  );
export type ReferralInput = z.infer<typeof referralSchema>;

export const abortConsultationSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type AbortConsultationInput = z.infer<typeof abortConsultationSchema>;

const dimensionSchema = z.number().int().min(1).max(5);

export const rateConsultationSchema = z.object({
  rating: dimensionSchema,
  communication: dimensionSchema.optional(),
  professionalism: dimensionSchema.optional(),
  timeliness: dimensionSchema.optional(),
  comment: z
    .string()
    .trim()
    .max(1_000)
    // Sanitize: strip control characters and angle brackets (comments are
    // rendered in web/app UIs).
    .transform((value) =>
      [...value]
        .filter((ch) => ch.charCodeAt(0) >= 32 && ch !== '<' && ch !== '>')
        .join('')
        .trim(),
    )
    .optional(),
});
export type RateConsultationInput = z.infer<typeof rateConsultationSchema>;

export const chatMessageSchema = z.object({
  body: z.string().trim().min(1).max(2_000),
});
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

export const listMessagesQuerySchema = paginationSchema;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

/** WS client → server frames. Server → client frames are typed in the API. */
export const wsClientFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), consultationId: idSchema }),
  z.object({
    type: z.literal('chat.message'),
    consultationId: idSchema,
    body: z.string().trim().min(1).max(2_000),
  }),
]);
export type WsClientFrame = z.infer<typeof wsClientFrameSchema>;
