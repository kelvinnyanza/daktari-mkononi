import { z } from 'zod';
import { idSchema } from './common.js';

export const medicationSchema = z.object({
  name: z.string().trim().min(2).max(200),
  /** Dose per administration, e.g. "500 mg", "5 ml". */
  dosage: z.string().trim().min(1).max(100),
  /** e.g. "mara 3 kwa siku" / "3 times daily". */
  frequency: z.string().trim().min(1).max(100),
  durationDays: z.number().int().min(1).max(365),
  quantity: z.number().int().min(1).max(1_000),
  instructions: z.string().trim().max(500).optional(),
});
export type MedicationInput = z.infer<typeof medicationSchema>;

export const createPrescriptionSchema = z.object({
  consultationId: idSchema,
  medications: z
    .array(medicationSchema)
    .min(1, 'a prescription needs at least one medication')
    .max(20, 'a prescription may contain at most 20 medications'),
  /** Days the prescription stays dispensable after issue. */
  validityDays: z.number().int().min(1).max(90).default(30),
  notes: z.string().trim().max(1_000).optional(),
});
export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;

export const prescriptionStatusSchema = z.enum([
  'ACTIVE',
  'PARTIALLY_DISPENSED',
  'DISPENSED',
  'EXPIRED',
  'CANCELLED',
]);
export type PrescriptionStatus = z.infer<typeof prescriptionStatusSchema>;

export const dispensePrescriptionSchema = z.object({
  prescriptionId: idSchema,
  medicationIds: z.array(idSchema).min(1),
});
export type DispensePrescriptionInput = z.infer<typeof dispensePrescriptionSchema>;
