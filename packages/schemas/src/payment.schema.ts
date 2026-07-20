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

/** GET /api/v1/admin/payments */
export const adminPaymentsQuerySchema = paginationSchema.extend({
  status: paymentStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type AdminPaymentsQuery = z.infer<typeof adminPaymentsQuerySchema>;
