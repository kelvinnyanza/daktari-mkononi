import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  bookAppointmentSchema,
  cancelAppointmentSchema,
  checkInSchema,
  idSchema,
  listMyAppointmentsQuerySchema,
  rescheduleAppointmentSchema,
} from '@daktari/schemas';
import type { SessionRepoPort } from '../../lib/ports.js';
import { authorize, makeAuthenticate } from '../../middleware/authenticate.js';
import type { AppointmentService } from './appointment.service.js';

const paramsSchema = z.object({ id: idSchema });

export function buildAppointmentRoutes(
  service: AppointmentService,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);

  return async (app) => {
    // Booking — patient only. Ownership is structural (patient from session).
    app.post(
      '/',
      {
        preHandler: [authenticate, authorize('appointment:create')],
        config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
      },
      async (request, reply) => {
        const input = bookAppointmentSchema.parse(request.body);
        const result = await service.book(request.auth!.userId, input);
        return reply.code(201).send(result);
      },
    );

    app.get(
      '/me',
      {
        preHandler: [authenticate, authorize('appointment:read:own')],
        config: { audit: 'phi-read' },
      },
      async (request) => {
        const query = listMyAppointmentsQuerySchema.parse(request.query);
        return service.listMine(request.auth!.userId, query);
      },
    );

    app.post(
      '/:id/cancel',
      { preHandler: [authenticate, authorize('appointment:cancel:own')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        const input = cancelAppointmentSchema.parse(request.body);
        return service.cancelByPatient(request.auth!.userId, id, input.reason);
      },
    );

    app.post(
      '/:id/reschedule',
      { preHandler: [authenticate, authorize('appointment:cancel:own')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        const input = rescheduleAppointmentSchema.parse(request.body);
        return service.reschedule(request.auth!.userId, id, input);
      },
    );

    // Doctor-side actions — mutations gated by appointment:manage:assigned,
    // never by the read permission.
    app.post(
      '/:id/doctor-cancel',
      { preHandler: [authenticate, authorize('appointment:manage:assigned')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        const input = cancelAppointmentSchema.parse(request.body); // reason required
        return service.cancelByDoctor(request.auth!.userId, id, input.reason);
      },
    );

    app.post(
      '/check-in',
      { preHandler: [authenticate, authorize('appointment:manage:assigned')] },
      async (request) => {
        const input = checkInSchema.parse(request.body);
        return service.checkIn(request.auth!.userId, input.checkInToken);
      },
    );

    app.post(
      '/:id/no-show',
      { preHandler: [authenticate, authorize('appointment:manage:assigned')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        return service.markNoShow(request.auth!.userId, id);
      },
    );
  };
}
