import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  adminPaymentsQuerySchema,
  idSchema,
  markRefundChasedSchema,
  paginationSchema,
} from '@daktari/schemas';
import type { SessionRepoPort } from '../../lib/ports.js';
import { authorize, makeAuthenticate } from '../../middleware/authenticate.js';
import type { PaymentService } from './payment.service.js';

const paramsSchema = z.object({ id: idSchema });

/** Mounted at /api/v1 — money endpoints live together for review. */
export function buildPaymentRoutes(
  service: PaymentService,
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
