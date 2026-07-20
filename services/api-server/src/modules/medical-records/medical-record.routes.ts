import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { idSchema, paginationSchema } from '@daktari/schemas';
import type { SessionRepoPort } from '../../lib/ports.js';
import { authorize, makeAuthenticate } from '../../middleware/authenticate.js';
import type { MedicalRecordService } from './medical-record.service.js';

const paramsSchema = z.object({ id: idSchema });

/**
 * Medical records are immutable: no update or delete routes exist by design.
 * Corrections happen as new records referencing the original (addendumToId).
 */
export function buildMedicalRecordRoutes(
  service: MedicalRecordService,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);

  return async (app) => {
    app.get(
      '/me',
      {
        preHandler: [authenticate, authorize('medical-record:read:own')],
        config: { audit: 'phi-read' },
      },
      async (request) => {
        const query = paginationSchema.parse(request.query);
        return service.listMine(request.auth!.userId, query);
      },
    );

    // Owner, authoring doctor, or doctor with an active appointment. The
    // route requires SOME medical-record read permission; the service decides
    // which relationship applies (patients hold read:own, doctors read:assigned).
    app.get(
      '/:id',
      { preHandler: [authenticate], config: { audit: 'phi-read' } },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        return service.getById(request.auth!.userId, id);
      },
    );
  };
}
