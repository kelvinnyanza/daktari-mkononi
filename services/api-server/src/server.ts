// MUST be first: populates process.env from the repo-root .env before
// @daktari/config validates it. The path is explicit because the server runs
// with CWD = services/api-server, where no .env exists — a single root .env is
// the one source of truth for every workspace package.
import './lib/load-env.js';

import { Redis } from 'ioredis';
import { loadEnv, type Env } from '@daktari/config';
import {
  appointmentRepository,
  auditLogRepository,
  consultationMessageRepository,
  consultationRepository,
  doctorDocumentRepository,
  doctorPaymentRepository,
  doctorRepository,
  ensureBookingSlotIndex,
  medicalRecordRepository,
  otpRepository,
  patientRepository,
  paymentRepository,
  prisma,
  ratingRepository,
  scheduleRepository,
  screeningRepository,
  sessionRepository,
  userRepository,
} from '@daktari/db';
import { createAiProvider } from '@daktari/ai';
import { AzamPayProvider, FakePayments, type MobileMoneyPort } from '@daktari/payments';
import { AfricasTalkingSms, ConsoleSms, type SmsPort } from '@daktari/notifications';
import { LocalDiskStorage, S3Storage, type StoragePort } from '@daktari/storage';
import { DailyCoVideo, FakeVideo, type VideoPort } from '@daktari/video';
import { buildAppWithServices } from './app.js';
import type { LocalFileReader } from './lib/ports.js';
import { assertProductionReady } from './lib/production-guard.js';
import { InMemoryPubSub } from './lib/pubsub.js';
import { startExpirySweep } from './modules/appointments/appointment.service.js';
import { startScreeningExpirySweep } from './modules/ai/screening.service.js';
import { startPaymentReconciliation } from './modules/payments/payment.service.js';

function createSmsPort(env: Env): SmsPort {
  // Key present ⇒ real gateway (any environment, so staging can send for real).
  // Unset ⇒ ConsoleSms, which prints OTP codes to this console — that is how
  // you sign in locally.
  if (env.SMS_API_KEY !== undefined) {
    return new AfricasTalkingSms({
      apiKey: env.SMS_API_KEY,
      username: env.SMS_USERNAME,
      senderId: env.SMS_SENDER_ID,
    });
  }
  return new ConsoleSms();
}

function createStorage(env: Env): { storage: StoragePort; localFiles: LocalFileReader } {
  if (env.AWS_ACCESS_KEY_ID !== undefined && env.AWS_SECRET_ACCESS_KEY !== undefined) {
    return {
      storage: new S3Storage({
        bucket: 'daktari-documents',
        region: env.AWS_REGION,
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      }),
      localFiles: null, // presigned URLs go straight to S3
    };
  }
  const local = new LocalDiskStorage({
    rootDir: env.STORAGE_ROOT,
    signingSecret: env.FILE_SIGNING_SECRET,
  });
  return { storage: local, localFiles: (key) => local.read(key) };
}

function createMobileMoney(env: Env): MobileMoneyPort {
  if (env.AZAMPAY_CLIENT_ID !== undefined && env.AZAMPAY_CLIENT_SECRET !== undefined) {
    return new AzamPayProvider({
      appName: env.AZAMPAY_APP_NAME,
      clientId: env.AZAMPAY_CLIENT_ID,
      clientSecret: env.AZAMPAY_CLIENT_SECRET,
      environment: env.AZAMPAY_ENV,
      ...(env.AZAMPAY_AUTH_BASE_URL !== undefined ? { authBaseUrl: env.AZAMPAY_AUTH_BASE_URL } : {}),
      ...(env.AZAMPAY_CHECKOUT_BASE_URL !== undefined
        ? { checkoutBaseUrl: env.AZAMPAY_CHECKOUT_BASE_URL }
        : {}),
    });
  }
  return new FakePayments(); // dev without aggregator credentials
}

function createVideo(env: Env): VideoPort {
  if (env.DAILY_CO_API_KEY !== undefined) {
    return new DailyCoVideo({ apiKey: env.DAILY_CO_API_KEY });
  }
  return new FakeVideo();
}

async function main(): Promise<void> {
  const env = loadEnv(); // fail fast: readable per-variable report on bad config

  // In production, refuse to boot on fake/console adapters or unset creds —
  // names every offender at once so the operator fixes them in one pass.
  assertProductionReady(env);

  // Redis is optional outside production: without it the rate limiter falls
  // back to @fastify/rate-limit's in-memory store (correct for one process,
  // which is all local dev runs) and readiness reports redis 'skipped' rather
  // than 'error'. The production guard requires REDIS_URL.
  const redis = env.REDIS_URL === undefined
    ? null
    : new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  const { storage, localFiles } = createStorage(env);

  // Prisma cannot declare the partial unique index that arbitrates bookings.
  await ensureBookingSlotIndex();

  // AI_PROVIDER picks the backend; its key unset ⇒ null ⇒ 503
  // AI_NOT_CONFIGURED. Never an implicit fake or a fallback to the other
  // provider: a stub that answers medical triage plausibly is more dangerous
  // than one that is plainly absent. AI_PROVIDER=fake is an explicit dev-only
  // choice, refused in production by the guard above.
  const ai = createAiProvider({
    provider: env.AI_PROVIDER,
    model: env.AI_MODEL,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    production: env.NODE_ENV === 'production',
  });

  const { app, services } = await buildAppWithServices({
    deps: {
      users: userRepository,
      sessions: sessionRepository,
      otps: otpRepository,
      patients: patientRepository,
      doctors: doctorRepository,
      doctorDocuments: doctorDocumentRepository,
      schedules: scheduleRepository,
      appointments: appointmentRepository,
      consultations: consultationRepository,
      consultationMessages: consultationMessageRepository,
      medicalRecords: medicalRecordRepository,
      ratings: ratingRepository,
      screenings: screeningRepository,
      ai,
      paymentsRepo: paymentRepository,
      doctorPayments: doctorPaymentRepository,
      mobileMoney: createMobileMoney(env),
      storage,
      video: createVideo(env),
      pubsub: new InMemoryPubSub(), // single-instance broadcast; Redis at Phase 11
      localFiles,
      auditLogs: auditLogRepository,
      sms: createSmsPort(env),
      health: {
        db: async () => {
          await prisma.$queryRaw`SELECT 1`;
        },
        // null ⇒ /health/ready reports redis 'skipped' instead of 'error'.
        redis:
          redis === null
            ? null
            : async () => {
                await redis.ping();
              },
      },
    },
    redis,
  });

  app.log.info(
    ai === null
      ? { aiProvider: env.AI_PROVIDER, aiConfigured: false }
      : { aiProvider: ai.name, aiModel: ai.model },
    ai === null ? 'AI screening disabled: selected provider has no key (503)' : 'AI screening provider',
  );

  // Unpaid MOBILE_MONEY bookings expire after 30 minutes; sweep every minute.
  const stopExpirySweep = startExpirySweep(services.appointments, 60_000, (error) => {
    app.log.error({ err: error }, 'appointment expiry sweep failed');
  });
  // Screening sessions expire 30 minutes after last activity.
  const stopScreeningSweep = startScreeningExpirySweep(services.screenings, 60_000, (error) => {
    app.log.error({ err: error }, 'screening expiry sweep failed');
  });
  // PROCESSING payments older than 90s get a provider status query.
  const stopReconciliation = startPaymentReconciliation(services.payments, 60_000, (error) => {
    app.log.error({ err: error }, 'payment reconciliation failed');
  });

  const port = Number(new URL(env.API_URL).port || 4000);
  // Production keeps its IPv4 wildcard bind. Development binds the dual-stack
  // wildcard '::' (ipv6Only off by default), which accepts IPv4 *and* IPv6:
  // Node ≥17 resolves "localhost" to ::1 first, so an IPv4-only bind makes
  // every Node client using http://localhost:4000 fail with ECONNREFUSED,
  // while the phone still needs the LAN address.
  const host = env.NODE_ENV === 'production' ? '0.0.0.0' : '::';
  await app.listen({ port, host });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down: draining connections');
    void (async () => {
      try {
        stopExpirySweep();
        stopScreeningSweep();
        stopReconciliation();
        await app.close(); // stop accepting, wait for in-flight requests
        await prisma.$disconnect();
        redis?.disconnect();
        app.log.info('shutdown complete');
        process.exit(0);
      } catch (error) {
        app.log.error({ err: error }, 'shutdown failed');
        process.exit(1);
      }
    })();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  // Env validation failures land here before any logger exists.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
