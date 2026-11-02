import { z } from 'zod';
import { paginationSchema, tzPhoneSchema } from './common.js';

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

// ── Doctor payouts (Phase 13a) ───────────────────────────────────────────────

export const payoutOperatorSchema = z.enum(['MPESA', 'TIGO_PESA', 'AIRTEL_MONEY', 'HALOPESA', 'AZAMPESA']);

/** PUT /api/v1/doctors/me/payout-account — any change resets verification. */
export const payoutAccountSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('MOBILE_MONEY'),
    operator: payoutOperatorSchema,
    accountNumber: tzPhoneSchema,
  }),
  z.object({
    type: z.literal('BANK'),
    bankName: z.string().trim().min(2).max(80),
    accountNumber: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z-]{6,30}$/, 'bank account number: 6–30 letters, digits or dashes'),
    accountName: z.string().trim().min(3).max(120),
  }),
]);
export type PayoutAccountInput = z.infer<typeof payoutAccountSchema>;

/** POST /api/v1/doctors/me/payout-account/confirm — the doctor confirms the looked-up name. */
export const confirmPayoutAccountSchema = z.object({
  confirmedName: z.string().trim().min(1).max(160),
});

/** POST /api/v1/admin/payout-accounts/:id/verify — manual verification (audited). */
export const adminVerifyPayoutAccountSchema = z.object({
  note: z.string().trim().min(3).max(500),
});

/** GET /api/v1/admin/payouts/preview?cutoff= and POST /api/v1/admin/payouts */
export const payoutPreviewQuerySchema = z.object({
  cutoff: z.coerce.date().optional(),
});
export const createPayoutRunSchema = z.object({
  cutoff: z.coerce.date().optional(),
  note: z.string().trim().max(500).optional(),
});

/** POST /api/v1/admin/payouts/items/:id/mark-paid — paid outside AzamPay (audited). */
export const markPayoutPaidSchema = z.object({
  reference: z.string().trim().min(3).max(120),
  note: z.string().trim().min(3).max(500),
});

// ── Admin refunds (Phase 13a) ────────────────────────────────────────────────

/** POST /api/v1/admin/payments/:id/refund — full refund of a COMPLETED payment (audited). */
export const adminRefundSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

/** POST /api/v1/admin/refunds/:id/complete-manually — money returned outside AzamPay. */
export const completeRefundManuallySchema = z.object({
  reference: z.string().trim().min(3).max(120),
  note: z.string().trim().min(3).max(500),
});
