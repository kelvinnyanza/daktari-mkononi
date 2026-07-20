import type { FastifyPluginAsync } from 'fastify';
import { idSchema, listPatientsQuerySchema, updatePatientProfileSchema } from '@daktari/schemas';
import { z } from 'zod';
import { authorize, makeAuthenticate } from '../../middleware/authenticate.js';
import type { SessionRepoPort } from '../../lib/ports.js';
import type { PatientService } from './patient.service.js';

const paramsSchema = z.object({ id: idSchema });

export function buildPatientRoutes(
  service: PatientService,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);

  return async (app) => {
    // Own profile — ownership is structural: the id comes from the session,
    // never from the request, so a patient cannot address another patient.
    app.get(
      '/me/profile',
      {
        preHandler: [authenticate, authorize('patient:read:own')],
        config: { audit: 'phi-read' },
      },
      async (request) => service.getOwnProfile(request.auth!.userId),
    );

    app.patch(
      '/me/profile',
      { preHandler: [authenticate, authorize('patient:update:own')] },
      async (request) => {
        const input = updatePatientProfileSchema.parse(request.body);
        return service.updateOwnProfile(request.auth!.userId, input);
      },
    );

    // Admin — PLATFORM_ADMIN/SUPER_ADMIN only (patient:read:any), PHI-audited.
    app.get(
      '/',
      {
        preHandler: [authenticate, authorize('patient:read:any')],
        config: { audit: 'phi-read' },
      },
      async (request) => {
        const query = listPatientsQuerySchema.parse(request.query);
        return service.adminListPatients(query);
      },
    );

    app.get(
      '/:id',
      {
        preHandler: [authenticate, authorize('patient:read:any')],
        config: { audit: 'phi-read' },
      },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        return service.adminGetPatient(id);
      },
    );
  };
}
