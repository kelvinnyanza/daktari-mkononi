import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  adminVerifyPayoutAccountSchema,
  confirmPayoutAccountSchema,
  createPayoutRunSchema,
  idSchema,
  markPayoutPaidSchema,
  payoutAccountSchema,
  payoutPreviewQuerySchema,
} from '@daktari/schemas';
import type { SessionRepoPort } from '../../lib/ports.js';
import { authorize, makeAuthenticate } from '../../middleware/authenticate.js';
import type { PayoutService } from './payout.service.js';

const paramsSchema = z.object({ id: idSchema });

/** Mounted at /api/v1 — doctor payout account + admin payout runs. */
export function buildPayoutRoutes(
  service: PayoutService,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);
  const doctor = { preHandler: [authenticate, authorize('doctor:update:own')] };
  const admin = { preHandler: [authenticate, authorize('admin:dashboard')] };

  return async (app) => {
    // ── Doctor ────────────────────────────────────────────────────────────────
    app.get('/doctors/me/payout-account', doctor, async (request) => service.getMyAccount(request.auth!.userId));

    app.put(
      '/doctors/me/payout-account',
      { ...doctor, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
      async (request) => service.setMyAccount(request.auth!.userId, payoutAccountSchema.parse(request.body)),
    );

    app.post(
      '/doctors/me/payout-account/lookup',
      { ...doctor, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
      async (request) => service.retryMyLookup(request.auth!.userId),
    );

    app.post('/doctors/me/payout-account/confirm', doctor, async (request) => {
      const input = confirmPayoutAccountSchema.parse(request.body);
      return service.confirmMyAccount(request.auth!.userId, input.confirmedName);
    });

    app.get('/doctors/me/payouts', doctor, async (request) => service.myPayouts(request.auth!.userId));

    // ── Admin ─────────────────────────────────────────────────────────────────
    app.get('/admin/payout-accounts/review', admin, async () => service.accountsNeedingReview());

    app.post('/admin/payout-accounts/:id/verify', admin, async (request) => {
      const { id } = paramsSchema.parse(request.params);
      const input = adminVerifyPayoutAccountSchema.parse(request.body);
      return service.adminVerifyAccount(request.auth!.userId, id, input.note);
    });

    app.get('/admin/payouts/preview', admin, async (request) => {
      const query = payoutPreviewQuerySchema.parse(request.query);
      return service.preview(query.cutoff);
    });

    app.get('/admin/payouts', admin, async () => service.listRuns());

    app.post('/admin/payouts', admin, async (request) => {
      const input = createPayoutRunSchema.parse(request.body ?? {});
      return service.createRun(request.auth!.userId, input.cutoff, input.note);
    });

    app.get('/admin/payouts/:id', admin, async (request) => {
      const { id } = paramsSchema.parse(request.params);
      return service.batchView(id);
    });

    app.post('/admin/payouts/:id/approve', admin, async (request) => {
      const { id } = paramsSchema.parse(request.params);
      return service.approveRun(request.auth!.userId, id);
    });

    app.post('/admin/payouts/:id/cancel', admin, async (request) => {
      const { id } = paramsSchema.parse(request.params);
      return service.cancelRun(request.auth!.userId, id);
    });

    app.post('/admin/payouts/items/:id/retry', admin, async (request) => {
      const { id } = paramsSchema.parse(request.params);
      return service.retryItem(request.auth!.userId, id);
    });

    app.post('/admin/payouts/items/:id/mark-paid', admin, async (request) => {
      const { id } = paramsSchema.parse(request.params);
      const input = markPayoutPaidSchema.parse(request.body);
      return service.markItemPaid(request.auth!.userId, id, input.reference, input.note);
    });
  };
}
