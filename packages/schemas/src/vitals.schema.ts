import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * Vital sign readings with physiological plausibility ranges.
 * Every reading is optional, but at least one must be present.
 */
export const recordVitalsSchema = z
  .object({
    patientId: idSchema,
    /** mmHg */
    systolicBp: z.number().int().min(50).max(260).optional(),
    /** mmHg */
    diastolicBp: z.number().int().min(30).max(160).optional(),
    /** beats per minute */
    heartRate: z.number().int().min(25).max(250).optional(),
    /** °C */
    temperatureC: z.number().min(30).max(45).optional(),
    /** breaths per minute */
    respiratoryRate: z.number().int().min(5).max(60).optional(),
    /** SpO₂ % */
    oxygenSaturation: z.number().int().min(50).max(100).optional(),
    /** mmol/L */
    bloodGlucoseMmol: z.number().min(1).max(35).optional(),
    /** kg */
    weightKg: z.number().min(1).max(400).optional(),
    /** cm */
    heightCm: z.number().min(30).max(260).optional(),
    recordedAt: z.coerce
      .date()
      .refine((date) => date.getTime() <= Date.now(), 'recordedAt cannot be in the future')
      .optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine(
    (value) =>
      [
        value.systolicBp,
        value.diastolicBp,
        value.heartRate,
        value.temperatureC,
        value.respiratoryRate,
        value.oxygenSaturation,
        value.bloodGlucoseMmol,
        value.weightKg,
        value.heightCm,
      ].some((reading) => reading !== undefined),
    { message: 'at least one vital sign reading is required' },
  )
  .refine((value) => (value.systolicBp === undefined) === (value.diastolicBp === undefined), {
    message: 'blood pressure needs both systolic and diastolic values',
    path: ['diastolicBp'],
  })
  .refine(
    (value) =>
      value.systolicBp === undefined ||
      value.diastolicBp === undefined ||
      value.systolicBp > value.diastolicBp,
    { message: 'systolic must be greater than diastolic', path: ['systolicBp'] },
  );
export type RecordVitalsInput = z.infer<typeof recordVitalsSchema>;

export const listVitalsQuerySchema = z.object({
  patientId: idSchema,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListVitalsQuery = z.infer<typeof listVitalsQuerySchema>;
