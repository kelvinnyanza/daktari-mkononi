import { randomUUID } from 'node:crypto';
import fastify, { type FastifyInstance } from 'fastify';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import type { Redis } from 'ioredis';
import { env } from '@daktari/config';
import './types.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { buildLoggerOptions } from './lib/logger.js';
import type { AppDeps } from './lib/ports.js';
import { registerAuditHook } from './middleware/audit.js';
import { buildAuthRoutes } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { buildHealthRoutes } from './modules/health/health.routes.js';
import { buildPatientRoutes } from './modules/patients/patient.routes.js';
import { PatientService } from './modules/patients/patient.service.js';
import { buildDoctorRoutes } from './modules/doctors/doctor.routes.js';
import { DoctorService } from './modules/doctors/doctor.service.js';
import { buildAppointmentRoutes } from './modules/appointments/appointment.routes.js';
import { AppointmentService } from './modules/appointments/appointment.service.js';
import { buildFilesRoutes } from './modules/files/files.routes.js';
import { buildConsultationRoutes } from './modules/consultations/consultation.routes.js';
import { ConsultationService } from './modules/consultations/consultation.service.js';
import { RatingService } from './modules/consultations/rating.service.js';
import { buildMedicalRecordRoutes } from './modules/medical-records/medical-record.routes.js';
import { MedicalRecordService } from './modules/medical-records/medical-record.service.js';
import { WsTicketStore } from './modules/ws/ticket-store.js';
import { buildWsGateway, buildWsTicketRoutes } from './modules/ws/ws.routes.js';
import { SlidingWindowLimiter } from './lib/rate-limiter.js';
import { buildScreeningRoutes } from './modules/ai/screening.routes.js';
import { ScreeningService } from './modules/ai/screening.service.js';
import { buildAdminRoutes } from './modules/admin/admin.routes.js';
import { PaymentService } from './modules/payments/payment.service.js';
import { buildPaymentRoutes } from './modules/payments/payment.routes.js';
import { buildAzamPayWebhookRoutes } from './modules/payments/webhook.routes.js';
import { buildDevRoutes } from './modules/dev/dev.routes.js';

export interface BuildAppOptions {
  deps: AppDeps;
  /** Rate-limit store; null → in-memory (tests / single instance). */
  redis?: Redis | null;
  /** Override the pino config (tests pass `false`). */
  logger?: boolean;
  /** Test hook: capture pino output on a stream (forces the logger on). */
  loggerStream?: { write: (msg: string) => void };
  now?: () => Date;
}

export interface BuiltApp {
  app: FastifyInstance;
  services: {
    auth: AuthService;
    patients: PatientService;
    doctors: DoctorService;
    appointments: AppointmentService;
    consultations: ConsultationService;
    medicalRecords: MedicalRecordService;
    ratings: RatingService;
    screenings: ScreeningService;
    payments: PaymentService;
  };
  wsTickets: WsTicketStore;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  return (await buildAppWithServices(options)).app;
}

/** Same as buildApp but also exposes the services (tests, job wiring). */
export async function buildAppWithServices(options: BuildAppOptions): Promise<BuiltApp> {
  const now = options.now ?? (() => new Date());

  const app = fastify({
    logger: options.loggerStream
      ? { ...buildLoggerOptions('info'), stream: options.loggerStream }
      : options.logger === false
        ? false
        : buildLoggerOptions(env.LOG_LEVEL),
    // Propagate inbound x-request-id (or mint one) through logs and responses.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: true,
  });

  app.decorateRequest('auth', null);

  app.addHook('onSend', (request, reply, _payload, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });

  await app.register(helmet, {
    // JSON API: no CSP needed; keep the transport-hardening headers.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: [env.APP_URL],
    credentials: true,
  });

  await app.register(compress);

  // Web portal refresh-token cookie (httpOnly, SameSite=Strict, /refresh only).
  await app.register(cookie);

  await app.register(multipart);

  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 }, // chat frames are small
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // preHandler so per-route keyGenerators can read the parsed body (phone).
    hook: 'preHandler',
    keyGenerator: (request) => request.ip,
    allowList: (request) => request.url.startsWith('/health'),
    ...(options.redis ? { redis: options.redis } : {}),
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);
  registerAuditHook(app, options.deps.auditLogs);

  const authService = new AuthService(
    {
      users: options.deps.users,
      sessions: options.deps.sessions,
      otps: options.deps.otps,
      doctors: options.deps.doctors,
      sms: options.deps.sms,
    },
    now,
  );
  const patientService = new PatientService({
    patients: options.deps.patients,
    users: options.deps.users,
  });
  const doctorService = new DoctorService(
    {
      doctors: options.deps.doctors,
      doctorDocuments: options.deps.doctorDocuments,
      schedules: options.deps.schedules,
      appointments: options.deps.appointments,
      storage: options.deps.storage,
      sms: options.deps.sms,
      auditLogs: options.deps.auditLogs,
    },
    now,
  );
  const paymentService = new PaymentService(
    {
      payments: options.deps.paymentsRepo,
      doctorPayments: options.deps.doctorPayments,
      appointments: options.deps.appointments,
      patients: options.deps.patients,
      doctors: options.deps.doctors,
      mobileMoney: options.deps.mobileMoney,
      sms: options.deps.sms,
      auditLogs: options.deps.auditLogs,
    },
    now,
  );
  const appointmentService = new AppointmentService(
    {
      appointments: options.deps.appointments,
      patients: options.deps.patients,
      doctors: options.deps.doctors,
      schedules: options.deps.schedules,
      screenings: options.deps.screenings,
      users: options.deps.users,
      payments: paymentService,
      sms: options.deps.sms,
      auditLogs: options.deps.auditLogs,
    },
    now,
  );
  const screeningService = new ScreeningService(
    {
      screenings: options.deps.screenings,
      patients: options.deps.patients,
      doctors: options.deps.doctors,
      appointments: options.deps.appointments,
      users: options.deps.users,
      ai: options.deps.ai,
      auditLogs: options.deps.auditLogs,
    },
    new SlidingWindowLimiter(now),
    now,
  );
  const medicalRecordService = new MedicalRecordService(
    {
      medicalRecords: options.deps.medicalRecords,
      patients: options.deps.patients,
      doctors: options.deps.doctors,
      appointments: options.deps.appointments,
      auditLogs: options.deps.auditLogs,
    },
    now,
  );
  const consultationService = new ConsultationService(
    {
      consultations: options.deps.consultations,
      consultationMessages: options.deps.consultationMessages,
      appointments: options.deps.appointments,
      patients: options.deps.patients,
      doctors: options.deps.doctors,
      screenings: options.deps.screenings,
      video: options.deps.video,
      pubsub: options.deps.pubsub,
      auditLogs: options.deps.auditLogs,
      medicalRecords: medicalRecordService,
      payments: paymentService,
    },
    now,
  );
  const ratingService = new RatingService({
    ratings: options.deps.ratings,
    consultations: options.deps.consultations,
    patients: options.deps.patients,
    auditLogs: options.deps.auditLogs,
  });
  const wsTickets = new WsTicketStore(now);

  await app.register(buildHealthRoutes(options.deps.health));
  await app.register(buildAuthRoutes(authService, options.deps.sessions, now), {
    prefix: '/api/v1/auth',
  });
  await app.register(buildPatientRoutes(patientService, options.deps.sessions, now), {
    prefix: '/api/v1/patients',
  });
  await app.register(
    buildDoctorRoutes(doctorService, authService, appointmentService, options.deps.sessions, now),
    { prefix: '/api/v1/doctors' },
  );
  await app.register(buildAppointmentRoutes(appointmentService, options.deps.sessions, now), {
    prefix: '/api/v1/appointments',
  });
  await app.register(buildFilesRoutes(options.deps.localFiles, now), {
    prefix: '/api/v1/files',
  });
  await app.register(buildConsultationRoutes(consultationService, ratingService, options.deps.sessions, now), {
    prefix: '/api/v1/consultations',
  });
  await app.register(buildMedicalRecordRoutes(medicalRecordService, options.deps.sessions, now), {
    prefix: '/api/v1/medical-records',
  });
  await app.register(buildWsTicketRoutes(wsTickets, options.deps.sessions, now), {
    prefix: '/api/v1/ws',
  });
  await app.register(buildWsGateway(consultationService, wsTickets, options.deps.pubsub));
  await app.register(buildScreeningRoutes(screeningService, options.deps.sessions, now), {
    prefix: '/api/v1/ai/screening',
  });
  await app.register(buildAdminRoutes(screeningService, options.deps.sessions, now), {
    prefix: '/api/v1/admin',
  });
  await app.register(buildPaymentRoutes(paymentService, options.deps.sessions, now), {
    prefix: '/api/v1',
  });
  await app.register(buildAzamPayWebhookRoutes(paymentService, options.deps.auditLogs), {
    prefix: '/webhooks/azampay',
  });
  // Dev-only helpers — never registered in production (see dev.routes.ts).
  if (env.NODE_ENV !== 'production') {
    await app.register(
      buildDevRoutes(
        paymentService,
        options.deps.paymentsRepo,
        options.deps.appointments,
        options.deps.sessions,
        now,
      ),
      { prefix: '/api/v1/dev' },
    );
  }

  return {
    app,
    services: {
      auth: authService,
      patients: patientService,
      doctors: doctorService,
      appointments: appointmentService,
      consultations: consultationService,
      medicalRecords: medicalRecordService,
      ratings: ratingService,
      screenings: screeningService,
      payments: paymentService,
    },
    wsTickets,
  };
}
