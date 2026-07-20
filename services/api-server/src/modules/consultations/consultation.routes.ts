import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  abortConsultationSchema,
  addDiagnosisSchema,
  consultationNotesSchema,
  idSchema,
  listMessagesQuerySchema,
  rateConsultationSchema,
  referralSchema,
  startConsultationSchema,
} from '@daktari/schemas';
import type { SessionRepoPort } from '../../lib/ports.js';
import { authorize, makeAuthenticate } from '../../middleware/authenticate.js';
import type { ConsultationService } from './consultation.service.js';
import type { RatingService } from './rating.service.js';

const paramsSchema = z.object({ id: idSchema });
const diagnosisParamsSchema = z.object({ id: idSchema, diagnosisId: idSchema });

export function buildConsultationRoutes(
  service: ConsultationService,
  ratings: RatingService,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);

  return async (app) => {
    // Doctor starts the consultation from a confirmed/checked-in appointment.
    app.post(
      '/start',
      { preHandler: [authenticate, authorize('consultation:conduct')] },
      async (request, reply) => {
        const input = startConsultationSchema.parse(request.body);
        const result = await service.start(request.auth!.userId, input.appointmentId);
        return reply.code(201).send(result);
      },
    );

    // Either participant; PHI-audited in the service with the entity id.
    app.get(
      '/:id',
      { preHandler: [authenticate], config: { audit: 'phi-read' } },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        return service.get(request.auth!.userId, id);
      },
    );

    // Doctor workspace: patient clinical context (age band, never DOB) +
    // linked screening transcript. Assigned doctor only; PHI-audited.
    app.get(
      '/:id/patient-context',
      {
        preHandler: [authenticate, authorize('patient:read:assigned')],
        config: { audit: 'phi-read' },
      },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        return service.patientContext(request.auth!.userId, id);
      },
    );

    // Appointment → consultation lookup so the doctor's day view can resume an
    // already-started consultation. Participants only; PHI-audited.
    app.get(
      '/for-appointment/:appointmentId',
      { preHandler: [authenticate], config: { audit: 'phi-read' } },
      async (request) => {
        const { appointmentId } = z
          .object({ appointmentId: idSchema })
          .parse(request.params);
        return service.findForAppointment(request.auth!.userId, appointmentId);
      },
    );

    // Role-scoped meeting token — the patient fetches theirs here.
    app.get('/:id/token', { preHandler: [authenticate] }, async (request) => {
      const { id } = paramsSchema.parse(request.params);
      return service.meetingToken(request.auth!.userId, id);
    });

    // Clinical documentation — doctor-only, IN_PROGRESS only.
    app.patch(
      '/:id/notes',
      { preHandler: [authenticate, authorize('consultation:conduct')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        const input = consultationNotesSchema.parse(request.body);
        return service.updateNotes(request.auth!.userId, id, input);
      },
    );

    app.patch(
      '/:id/referral',
      { preHandler: [authenticate, authorize('consultation:conduct')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        const input = referralSchema.parse(request.body);
        return service.setReferral(request.auth!.userId, id, input);
      },
    );

    app.post(
      '/:id/diagnoses',
      { preHandler: [authenticate, authorize('consultation:conduct')] },
      async (request, reply) => {
        const { id } = paramsSchema.parse(request.params);
        const input = addDiagnosisSchema.parse(request.body);
        const result = await service.addDiagnosis(request.auth!.userId, id, input);
        return reply.code(201).send(result);
      },
    );

    app.delete(
      '/:id/diagnoses/:diagnosisId',
      { preHandler: [authenticate, authorize('consultation:conduct')] },
      async (request) => {
        const { id, diagnosisId } = diagnosisParamsSchema.parse(request.params);
        return service.removeDiagnosis(request.auth!.userId, id, diagnosisId);
      },
    );

    app.post(
      '/:id/complete',
      { preHandler: [authenticate, authorize('consultation:conduct')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        return service.complete(request.auth!.userId, id);
      },
    );

    // Either party (or system) — participant check in the service.
    app.post('/:id/abort', { preHandler: [authenticate] }, async (request) => {
      const { id } = paramsSchema.parse(request.params);
      const input = abortConsultationSchema.parse(request.body);
      return service.abort(request.auth!.userId, id, input.reason);
    });

    // Recording consent — PATIENT account only (enforced in the service).
    app.post('/:id/recording-consent', { preHandler: [authenticate] }, async (request) => {
      const { id } = paramsSchema.parse(request.params);
      return service.grantRecordingConsent(request.auth!.userId, id);
    });

    // Chat history — participants only, PHI-audited.
    app.get(
      '/:id/messages',
      { preHandler: [authenticate], config: { audit: 'phi-read' } },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        const query = listMessagesQuerySchema.parse(request.query);
        return service.listMessages(request.auth!.userId, id, query);
      },
    );

    // Rating status by appointment — patient-owner only (mobile rate CTA).
    app.get('/by-appointment/:appointmentId', { preHandler: [authenticate] }, async (request) => {
      const { appointmentId } = z.object({ appointmentId: idSchema }).parse(request.params);
      return ratings.statusForAppointment(request.auth!.userId, appointmentId);
    });

    // Rating — patient-only, after COMPLETED, exactly once.
    app.post('/:id/rating', { preHandler: [authenticate] }, async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const input = rateConsultationSchema.parse(request.body);
      const result = await ratings.rate(request.auth!.userId, id, input);
      return reply.code(201).send(result);
    });
  };
}
