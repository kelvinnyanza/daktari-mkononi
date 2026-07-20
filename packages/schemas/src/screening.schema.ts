import { z } from 'zod';

/**
 * AI symptom-screening triage levels.
 * EMERGENCY guidance must direct users to 112 (universal) or 115 (ambulance).
 */
export const triageLevelSchema = z.enum([
  'SELF_CARE',
  'TELECONSULTATION',
  'IN_PERSON_VISIT',
  'EMERGENCY',
]);
export type TriageLevel = z.infer<typeof triageLevelSchema>;

/** POST /api/v1/ai/screening/sessions/:id/messages */
export const aiScreeningMessageSchema = z.object({
  message: z.string().trim().min(1).max(500, 'message must be at most 500 characters'),
});
export type AiScreeningMessageInput = z.infer<typeof aiScreeningMessageSchema>;

/** POST /api/v1/ai/screening/sessions */
export const startScreeningSessionSchema = z.object({
  language: z.enum(['sw', 'en']).optional(),
});
export type StartScreeningSessionInput = z.infer<typeof startScreeningSessionSchema>;

/**
 * The structured triage check the model must return after each exchange
 * (validated via completeStructured — one retry on schema failure).
 */
export const triageCheckSchema = z
  .object({
    triageComplete: z.boolean(),
    triageLevel: triageLevelSchema.optional(),
    urgencyScore: z.number().min(0).max(10),
    suggestedSpecialty: z.string().trim().max(100).optional(),
    confidence: z.number().min(0).max(1),
    rationale: z.string().trim().min(1).max(500),
  })
  .refine((value) => !value.triageComplete || value.triageLevel !== undefined, {
    message: 'triageLevel is required when triageComplete is true',
    path: ['triageLevel'],
  });
export type TriageCheck = z.infer<typeof triageCheckSchema>;
