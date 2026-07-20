import type { FastifyPluginAsync } from 'fastify';
import type { SessionRepoPort } from '../../lib/ports.js';
import { authorize, makeAuthenticate } from '../../middleware/authenticate.js';
import type { ScreeningService } from '../ai/screening.service.js';

/** Plain JSON aggregates for platform admins — no dashboard yet (Phase 6). */
export function buildAdminRoutes(
  screenings: ScreeningService,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);

  return async (app) => {
    app.get(
      '/ai-usage',
      { preHandler: [authenticate, authorize('admin:dashboard')] },
      async () => screenings.usageSummary(),
    );
  };
}
