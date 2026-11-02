import { z } from 'zod';
import { paginationSchema } from './common.js';

export const paymentStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REFUNDED',
]);
export type PaymentStatusValue = z.infer<typeof paymentStatusSchema>;

/** POST /api/v1/admin/refunds/:id/chase — manual chase note (audit-logged). */
export const markRefundChasedSchema = z.object({
  note: z.string().trim().min(3).max(500),
});
export type MarkRefundChasedInput = z.infer<typeof markRefundChasedSchema>;

/** POST /api/v1/admin/payments/:id/review/resolve — what the admin did (audit-logged). */
export const resolvePaymentReviewSchema = z.object({
  note: z.string().trim().min(3).max(1000),
});
export type ResolvePaymentReviewInput = z.infer<typeof resolvePaymentReviewSchema>;

/** GET /api/v1/admin/payments */
export const adminPaymentsQuerySchema = paginationSchema.extend({
  status: paymentStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type AdminPaymentsQuery = z.infer<typeof adminPaymentsQuerySchema>;

// ── Fees & VAT (Phase 13a) ───────────────────────────────────────────────────

/** Percent with at most 2 decimals (stored as integer basis points). */
const percentSchema = (max: number) =>
  z
    .number()
    .min(0)
    .max(max)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
      message: 'at most 2 decimal places',
    });

export const vatModeSchema = z.enum(['ON_TOP_OF_COMMISSION', 'INCLUDED_IN_COMMISSION']);

/**
 * Smallest payout any operator accepts. AzamPay/MNO minimums vary by
 * operator; the admin setting may not go below this floor.
 */
export const MIN_PAYOUT_FLOOR_TZS = 1_000;

/** POST /api/v1/admin/settings/fees — adds a new effective-dated row (audited). */
export const updateFeeSettingsSchema = z.object({
  commissionPercent: percentSchema(50),
  vatEnabled: z.boolean(),
  vatPercent: percentSchema(30),
  vatMode: vatModeSchema,
  minPayoutTzs: z.number().int().min(MIN_PAYOUT_FLOOR_TZS).max(5_000_000),
  /** Omitted ⇒ effective immediately. Back-dating is refused. */
  effectiveFrom: z.coerce.date().optional(),
  note: z.string().trim().min(3).max(500),
});
export type UpdateFeeSettingsInput = z.infer<typeof updateFeeSettingsSchema>;

/** PUT /api/v1/admin/doctors/:id/commission — null clears the override. */
export const doctorCommissionOverrideSchema = z.object({
  commissionPercent: percentSchema(50).nullable(),
  note: z.string().trim().min(3).max(500),
});
export type DoctorCommissionOverrideInput = z.infer<typeof doctorCommissionOverrideSchema>;

/** GET /api/v1/admin/settings/fees/preview?feeTzs=&doctorId= */
export const feePreviewQuerySchema = z.object({
  feeTzs: z.coerce.number().int().min(0).max(5_000_000),
  doctorId: z.string().min(1).optional(),
});
export type FeePreviewQuery = z.infer<typeof feePreviewQuerySchema>;
