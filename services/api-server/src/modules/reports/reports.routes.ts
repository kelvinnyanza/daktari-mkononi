import type { FastifyPluginAsync } from 'fastify';
import { financeReportQuerySchema, reconciliationImportSchema } from '@daktari/schemas';
import type { SessionRepoPort } from '../../lib/ports.js';
import { authorize, makeAuthenticate } from '../../middleware/authenticate.js';
import type { FinanceService } from './finance.service.js';

/** Mounted at /api/v1/admin — finance totals, CSV export, AzamPay statement reconciliation. */
export function buildReportRoutes(
  service: FinanceService,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);
  const admin = { preHandler: [authenticate, authorize('admin:dashboard')] };

  return async (app) => {
    app.get('/reports/finance', admin, async (request) => {
      const query = financeReportQuerySchema.parse(request.query);
      return service.summary(query.from, query.to);
    });

    app.get('/reports/finance.csv', admin, async (request, reply) => {
      const query = financeReportQuerySchema.parse(request.query);
      const csv = await service.csv(query.from, query.to);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="daktari-finance-${query.from}-${query.to}.csv"`)
        .send(csv);
    });

    app.post(
      '/reconciliation/azampay',
      { ...admin, bodyLimit: 5 * 1024 * 1024 },
      async (request) => {
        const input = reconciliationImportSchema.parse(request.body);
        return service.reconcile(request.auth!.userId, input.csv, {
          ...(input.from !== undefined ? { from: input.from } : {}),
          ...(input.to !== undefined ? { to: input.to } : {}),
          applyFees: input.applyFees,
        });
      },
    );
  };
}
