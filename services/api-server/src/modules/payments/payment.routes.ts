import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  adminPaymentsQuerySchema,
  doctorCommissionOverrideSchema,
  feePreviewQuerySchema,
  updateFeeSettingsSchema,
  idSchema,
  markRefundChasedSchema,
  paginationSchema,
  resolvePaymentReviewSchema,
} from '@daktari/schemas';
import type { SessionRepoPort } from '../../lib/ports.js';
import { authorize, makeAuthenticate } from '../../middleware/authenticate.js';
import type { FeeSettingsService } from './fee-settings.service.js';
import type { PaymentService } from './payment.service.js';

const paramsSchema = z.object({ id: idSchema });

/** Mounted at /api/v1 — money endpoints live together for review. */
export function buildPaymentRoutes(
  service: PaymentService,
  fees: FeeSettingsService,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);

  return async (app) => {
    // Patient (re-)initiates the mobile-money collection for their booking.
    app.post(
      '/appointments/:id/pay',
      {
        preHandler: [authenticate, authorize('payment:initiate')],
        config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        return service.payForAppointment(request.auth!.userId, id);
      },
    );

    app.get(
      '/payments/me',
      { preHandler: [authenticate, authorize('payment:read:own')] },
      async (request) => {
        const query = paginationSchema.parse(request.query);
        return service.listMine(request.auth!.userId, query);
      },
    );

    // Doctor earnings: per-consultation accruals + running total.
    app.get(
      '/doctors/me/earnings',
      { preHandler: [authenticate, authorize('doctor:update:own')] },
      async (request) => {
        const query = paginationSchema.parse(request.query);
        return service.doctorEarnings(request.auth!.userId, query);
      },
    );

    app.get(
      '/admin/payments',
      { preHandler: [authenticate, authorize('admin:dashboard')] },
      async (request) => {
        const query = adminPaymentsQuerySchema.parse(request.query);
        return service.adminList(query);
      },
    );

    // Refunds the provider rejected — chased manually by platform admins.
    app.get(
      '/admin/refunds/pending',
      { preHandler: [authenticate, authorize('admin:dashboard')] },
      async () => service.refundsPending(),
    );

    // Admin alert queue: late successes (auto-refunded), amount mismatches,
    // payments stuck after abandonment, stray attempts.
    app.get(
      '/admin/payments/review',
      { preHandler: [authenticate, authorize('admin:dashboard')] },
      async () => service.reviewQueue(),
    );

    app.post(
      '/admin/payments/:id/review/resolve',
      { preHandler: [authenticate, authorize('admin:dashboard')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        const input = resolvePaymentReviewSchema.parse(request.body);
        return service.resolveReview(request.auth!.userId, id, input.note);
      },
    );

    // ── Fees & VAT settings (effective-dated, audited) ─────────────────────────
    app.get(
      '/admin/settings/fees',
      { preHandler: [authenticate, authorize('admin:dashboard')] },
      async () => fees.overview(),
    );

    app.post(
      '/admin/settings/fees',
      { preHandler: [authenticate, authorize('admin:dashboard')] },
      async (request) => {
        const input = updateFeeSettingsSchema.parse(request.body);
        return fees.update(request.auth!.userId, input);
      },
    );

    // Worked example for the settings screen, computed by the real calculator.
    app.get(
      '/admin/settings/fees/preview',
      { preHandler: [authenticate, authorize('admin:dashboard')] },
      async (request) => {
        const query = feePreviewQuerySchema.parse(request.query);
        return fees.preview(query.feeTzs, query.doctorId ?? null);
      },
    );

    app.put(
      '/admin/doctors/:id/commission',
      { preHandler: [authenticate, authorize('admin:dashboard')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        const input = doctorCommissionOverrideSchema.parse(request.body);
        return fees.setDoctorOverride(request.auth!.userId, id, input);
      },
    );

    // Record a manual chase note against a stuck refund (audit-logged).
    app.post(
      '/admin/refunds/:id/chase',
      { preHandler: [authenticate, authorize('admin:dashboard')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        const input = markRefundChasedSchema.parse(request.body);
        return service.markRefundChased(request.auth!.userId, id, input.note);
      },
    );
  };
}
