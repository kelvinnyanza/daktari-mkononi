import type { Buffer } from 'node:buffer';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  adminDoctorListQuerySchema,
  availabilityQuerySchema,
  doctorDayQuerySchema,
  doctorDirectoryQuerySchema,
  doctorRegistrationSchema,
  doctorSuspendSchema,
  doctorVerificationDecisionSchema,
  idSchema,
  setDoctorScheduleSchema,
  verificationQueueQuerySchema,
} from '@daktari/schemas';
import { MAX_UPLOAD_BYTES } from '@daktari/storage';
import { ApiError, msg } from '../../lib/errors.js';
import type { SessionRepoPort } from '../../lib/ports.js';
import { authorize, makeAuthenticate } from '../../middleware/authenticate.js';
import type { AuthService } from '../auth/auth.service.js';
import type { AppointmentService } from '../appointments/appointment.service.js';
import type { DoctorService } from './doctor.service.js';

const paramsSchema = z.object({ id: idSchema });

export function buildDoctorRoutes(
  doctorService: DoctorService,
  authService: AuthService,
  appointmentService: AppointmentService,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);

  return async (app) => {
    // ── Onboarding ────────────────────────────────────────────────────────────
    app.post(
      '/register',
      { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, // per IP
      async (request, reply) => {
        const input = doctorRegistrationSchema.parse(request.body);
        const result = await authService.registerDoctor(input);
        // Same 202-with-identical-body contract as patient registration.
        return reply.code(202).send(result);
      },
    );

    app.post(
      '/me/documents',
      { preHandler: [authenticate, authorize('doctor:update:own')] },
      async (request: FastifyRequest) => {
        const file = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
        if (!file) {
          throw new ApiError(
            400,
            'NO_FILE',
            msg('Hakuna faili lililotumwa', 'No file was uploaded'),
          );
        }
        let data: Buffer;
        try {
          data = await file.toBuffer();
        } catch {
          throw new ApiError(
            400,
            'FILE_TOO_LARGE',
            msg('Faili limezidi ukubwa wa MB 10', 'File exceeds the 10 MB limit'),
          );
        }
        return doctorService.uploadDocument(request.auth!.userId, {
          fieldName: file.fieldname,
          fileName: file.filename,
          mimeType: file.mimetype,
          data,
        });
      },
    );

    app.get(
      '/me/verification',
      { preHandler: [authenticate, authorize('doctor:update:own')] },
      async (request) => doctorService.getVerification(request.auth!.userId),
    );

    // ── Weekly schedule ───────────────────────────────────────────────────────
    app.get(
      '/me/schedule',
      { preHandler: [authenticate, authorize('doctor:update:own')] },
      async (request) => doctorService.getOwnSchedule(request.auth!.userId),
    );

    app.put(
      '/me/schedule',
      { preHandler: [authenticate, authorize('doctor:update:own')] },
      async (request) => {
        const input = setDoctorScheduleSchema.parse(request.body);
        return doctorService.setOwnSchedule(request.auth!.userId, input);
      },
    );

    // Doctor's day view of their appointments — audited as a PHI read.
    app.get(
      '/me/appointments',
      {
        preHandler: [authenticate, authorize('appointment:read:assigned')],
        config: { audit: 'phi-read' },
      },
      async (request) => {
        const query = doctorDayQuerySchema.parse(request.query);
        return appointmentService.doctorDay(request.auth!.userId, query);
      },
    );

    // ── Admin verification workflow (doctor:verify) ───────────────────────────
    app.get(
      '/admin/verification-queue',
      { preHandler: [authenticate, authorize('doctor:verify')] },
      async (request) => {
        const query = verificationQueueQuerySchema.parse(request.query);
        return doctorService.adminQueue(query.page, query.pageSize);
      },
    );

    // Admin doctor list — every verification status (portal /admin/doctors).
    app.get(
      '/admin/list',
      { preHandler: [authenticate, authorize('doctor:verify')] },
      async (request) => {
        const query = adminDoctorListQuerySchema.parse(request.query);
        return doctorService.adminListDoctors({
          ...(query.status !== undefined ? { status: query.status } : {}),
          page: query.page,
          pageSize: query.pageSize,
        });
      },
    );

    // Admin review detail: credentials + documents with signed URLs.
    app.get(
      '/admin/:id',
      { preHandler: [authenticate, authorize('doctor:verify')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        return doctorService.adminDoctorDetail(id);
      },
    );

    app.post(
      '/admin/:id/claim',
      { preHandler: [authenticate, authorize('doctor:verify')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        return doctorService.adminClaim(request.auth!.userId, id);
      },
    );

    app.post(
      '/admin/:id/decision',
      { preHandler: [authenticate, authorize('doctor:verify')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        const input = doctorVerificationDecisionSchema.parse(request.body);
        return doctorService.adminDecide(request.auth!.userId, id, input);
      },
    );

    app.post(
      '/admin/:id/suspend',
      { preHandler: [authenticate, authorize('doctor:verify')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        const input = doctorSuspendSchema.parse(request.body);
        return doctorService.adminSuspend(request.auth!.userId, id, input.reason);
      },
    );

    // ── Public directory (authenticated: doctor:read:any) ────────────────────
    app.get(
      '/',
      { preHandler: [authenticate, authorize('doctor:read:any')] },
      async (request) => {
        const query = doctorDirectoryQuerySchema.parse(request.query);
        return doctorService.directory(query);
      },
    );

    app.get(
      '/:id',
      { preHandler: [authenticate, authorize('doctor:read:any')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        return doctorService.publicProfile(id);
      },
    );

    app.get(
      '/:id/availability',
      { preHandler: [authenticate, authorize('doctor:read:any')] },
      async (request) => {
        const { id } = paramsSchema.parse(request.params);
        const { date } = availabilityQuerySchema.parse(request.query);
        return doctorService.availability(id, date);
      },
    );
  };
}
