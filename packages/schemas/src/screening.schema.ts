import { z } from 'zod';
import { uuidSchema } from './common.js';

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

export const aiScreeningMessageSchema = z.object({
  sessionId: uuidSchema,
  message: z.string().trim().min(1).max(500, 'message must be at most 500 characters'),
  language: z.enum(['sw', 'en']).default('sw'),
});
export type AiScreeningMessageInput = z.infer<typeof aiScreeningMessageSchema>;

export const startScreeningSessionSchema = z.object({
  language: z.enum(['sw', 'en']).default('sw'),
});
export type StartScreeningSessionInput = z.infer<typeof startScreeningSessionSchema>;
