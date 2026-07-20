import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  aiScreeningMessageSchema,
  idSchema,
  startScreeningSessionSchema,
} from '@daktari/schemas';
import type { SessionRepoPort } from '../../lib/ports.js';
import { authorize, makeAuthenticate } from '../../middleware/authenticate.js';
import type { ScreeningService } from './screening.service.js';

const paramsSchema = z.object({ id: idSchema });

export function buildScreeningRoutes(
  service: ScreeningService,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);

  return async (app) => {
    // Patient-only: creates the session, returns the canned opening +
    // disclaimer (no model call). Daily session cap enforced in the service.
    app.post(
      '/sessions',
      { preHandler: [authenticate, authorize('screening:use')] },
      async (request, reply) => {
        const input = startScreeningSessionSchema.parse(request.body ?? {});
        const result = await service.startSession(request.auth!.userId, input.language);
        return reply.code(201).send(result);
      },
    );

    // One patient message through the safety pipeline. Hourly message cap
    // enforced in the service (per patient, after authentication).
    app.post(
      '/sessions/:id/messages',
      { preHandler: [authenticate, authorize('screening:use')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        const input = aiScreeningMessageSchema.parse(request.body);
        return service.handleMessage(request.auth!.userId, id, input.message);
      },
    );

    // Owner or doctor-with-active-appointment; decrypted transcript is PHI.
    app.get(
      '/sessions/:id',
      { preHandler: [authenticate], config: { audit: 'phi-read' } },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        return service.getSession(request.auth!.userId, id);
      },
    );
  };
}
