/**
 * End-to-end flows against a real Postgres database.
 *
 * Gated: set TEST_DATABASE_URL to a migrated database
 * (e.g. `prisma db push` against daktari_test) to enable. Skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type * as DbModule from '@daktari/db';
import { FakeVideo } from '@daktari/video';
import { FakeAi } from '@daktari/ai';
import { FakePayments } from '@daktari/payments';
import { decryptHealthData } from '@daktari/encryption';
import type { BuiltApp } from '../src/app.js';
import { applyTestEnv } from './helpers/env.js';
import { FakeSms, FakeStorage } from './helpers/fakes.js';
import { InMemoryPubSub } from '../src/lib/pubsub.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  console.warn(
    '[integration] TEST_DATABASE_URL is not set — skipping API integration tests. ' +
      'Start Postgres (docker compose or portable pg_ctl — see README), ' +
      'push the schema to a test database, and export TEST_DATABASE_URL to enable them.',
  );
}

describe.runIf(Boolean(TEST_DATABASE_URL))('API integration (real Postgres)', () => {
  let app: FastifyInstance;
  let services: BuiltApp['services'];
  let sms: FakeSms;
  let fakeAi: FakeAi;
  let fakePayments: FakePayments;
  let db: typeof DbModule;
  let disconnect: () => Promise<void>;

  const phone = '+255754321987';
  const password = 'Integration-1!';

  beforeAll(async () => {
    applyTestEnv();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    // Import after DATABASE_URL is set — the Prisma singleton binds at load.
    db = await import('@daktari/db');
    const { buildAppWithServices } = await import('../src/app.js');

    // The partial unique index is created outside Prisma's schema.
    await db.ensureBookingSlotIndex();

    await db.prisma.doctorPayment.deleteMany({});
    await db.prisma.payment.deleteMany({});
    await db.prisma.consultationRating.deleteMany({});
    await db.prisma.consultationMessage.deleteMany({});
    await db.prisma.medicalRecord.deleteMany({});
    await db.prisma.diagnosis.deleteMany({});
    await db.prisma.consultation.deleteMany({});
    await db.prisma.appointment.deleteMany({});
    await db.prisma.aIScreeningResult.deleteMany({});
    await db.prisma.doctorSchedule.deleteMany({});
    await db.prisma.doctorDocument.deleteMany({});
    await db.prisma.otpCode.deleteMany({});
    await db.prisma.session.deleteMany({});
    await db.prisma.patientInsurance.deleteMany({});
    await db.prisma.patient.deleteMany({});
    await db.prisma.doctor.deleteMany({});
    await db.prisma.user.deleteMany({});

    sms = new FakeSms();
    fakeAi = new FakeAi();
    fakePayments = new FakePayments();
    const built = await buildAppWithServices({
      deps: {
        users: db.userRepository,
        sessions: db.sessionRepository,
        otps: db.otpRepository,
        patients: db.patientRepository,
        doctors: db.doctorRepository,
        doctorDocuments: db.doctorDocumentRepository,
        schedules: db.scheduleRepository,
        appointments: db.appointmentRepository,
        consultations: db.consultationRepository,
        consultationMessages: db.consultationMessageRepository,
        medicalRecords: db.medicalRecordRepository,
        ratings: db.ratingRepository,
        screenings: db.screeningRepository,
        ai: fakeAi,
        paymentsRepo: db.paymentRepository,
        doctorPayments: db.doctorPaymentRepository,
        mobileMoney: fakePayments,
        storage: new FakeStorage(),
        video: new FakeVideo(),
        pubsub: new InMemoryPubSub(),
        localFiles: null,
        auditLogs: db.auditLogRepository,
        sms,
        health: {
          db: async () => {
            await db.prisma.$queryRaw`SELECT 1`;
          },
          redis: null,
        },
      },
      redis: null,
      logger: false,
    });
    app = built.app;
    services = built.services;
    await app.ready();
    disconnect = () => db.prisma.$disconnect();
  });

  afterAll(async () => {
    await app?.close();
    await disconnect?.();
  });

  it('register → verify → login → me → refresh → reuse-revocation → logout', async () => {
    // Register
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        phone,
        password,
        fullName: 'Elia Sanga',
        dateOfBirth: '1990-04-12',
        gender: 'MALE',
      },
    });
    expect(register.statusCode).toBe(202);

    // Verify phone with the OTP from the (captured) SMS
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-otp',
      payload: { phone, purpose: 'PHONE_VERIFY', code: sms.lastCode() },
    });
    expect(verify.statusCode).toBe(200);

    // Login
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { phone, password },
    });
    expect(login.statusCode).toBe(200);
    const tokens = login.json() as { accessToken: string; refreshToken: string };

    // Me
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().profile.type).toBe('PATIENT');

    // Refresh (rotation)
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(refresh.statusCode).toBe(200);
    const rotated = refresh.json() as { accessToken: string; refreshToken: string };
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);

    // Replay the old refresh token — the whole family must be revoked.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('SESSION_REVOKED');

    // The legitimately rotated token is dead too.
    const deadRotated = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: rotated.refreshToken },
    });
    expect(deadRotated.statusCode).toBe(401);
    expect(deadRotated.json().error.code).toBe('SESSION_REVOKED');

    // Fresh login, then logout revokes the session.
    const secondLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { phone, password },
    });
    expect(secondLogin.statusCode).toBe(200);
    const second = secondLogin.json() as { accessToken: string; refreshToken: string };

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${second.accessToken}` },
    });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${second.accessToken}` },
    });
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.json().error.code).toBe('SESSION_REVOKED');
  });

  // Web portal (Phase 11): the refresh token never touches the response body
  // or JS — it rides an httpOnly cookie scoped to /refresh. Rotation and
  // family reuse-detection are the same code path as mobile.
  it('web client: refresh token is delivered and rotated as an httpOnly cookie', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-daktari-client': 'web' },
      payload: { phone, password },
    });
    expect(login.statusCode).toBe(200);

    // Body carries the access token only.
    const body = login.json() as { accessToken: string; refreshToken?: string };
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeUndefined();

    const cookie = login.cookies.find((entry) => entry.name === 'daktari_rt');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
    expect(cookie?.path).toBe('/api/v1/auth/refresh');
    expect(cookie?.value).toBeTruthy();

    // A cookie WITHOUT the web-client header is refused. This is the second
    // CSRF layer: a cross-site form post cannot set a custom header, so even
    // if SameSite ever failed to stop the cookie being attached, the request
    // still cannot spend it.
    const noHeader = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { daktari_rt: cookie!.value },
    });
    expect(noHeader.statusCode).toBe(401);
    expect(noHeader.json().error.code).toBe('WEB_CLIENT_HEADER_REQUIRED');

    // Refused without consuming the token — the real refresh below still works.
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { 'x-daktari-client': 'web' },
      cookies: { daktari_rt: cookie!.value },
    });
    expect(refresh.statusCode).toBe(200);
    const refreshed = refresh.json() as { accessToken: string; refreshToken?: string };
    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.refreshToken).toBeUndefined();

    // Rotation: a new cookie value replaces the old one.
    const rotatedCookie = refresh.cookies.find((entry) => entry.name === 'daktari_rt');
    expect(rotatedCookie?.value).toBeTruthy();
    expect(rotatedCookie?.value).not.toBe(cookie!.value);

    // Replaying the superseded cookie kills the family AND clears the cookie,
    // so a dead credential cannot linger in the browser.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { 'x-daktari-client': 'web' },
      cookies: { daktari_rt: cookie!.value },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('SESSION_REVOKED');
    const cleared = replay.cookies.find((entry) => entry.name === 'daktari_rt');
    expect(cleared?.value).toBe('');

    // Logout clears the cookie too.
    const freshLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-daktari-client': 'web' },
      payload: { phone, password },
    });
    const freshAccess = (freshLogin.json() as { accessToken: string }).accessToken;
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${freshAccess}` },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.cookies.find((entry) => entry.name === 'daktari_rt')?.value).toBe('');
  });

  it('resend-otp: 202 always, old code invalidated, 3/hour/phone rate limit', async () => {
    const phone = '+255700000601';
    await db.prisma.user.create({
      data: {
        phone,
        passwordHash: 'x',
        fullName: 'Resend Tester',
        role: 'PATIENT',
        phoneVerifiedAt: null, // unverified — eligible for resend
        patient: {
          create: {
            dateOfBirth: new Date('1990-01-01'),
            gender: 'MALE',
            region: 'UNKNOWN',
            district: 'UNKNOWN',
          },
        },
      },
    });

    const resend = (target: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/resend-otp',
        payload: { phoneNumber: target, purpose: 'phone_verify' },
      });

    // First resend issues a code…
    const first = await resend(phone);
    expect(first.statusCode).toBe(202);
    const oldCode = sms.lastCode();

    // …the second replaces it (single active code).
    const second = await resend(phone);
    expect(second.statusCode).toBe(202);
    const newCode = sms.lastCode();

    // Unknown phone: byte-identical 202 body, no SMS.
    const smsCount = sms.sent.length;
    const unknown = await resend('+255700000699');
    expect(unknown.statusCode).toBe(202);
    expect(unknown.body).toBe(second.body);
    expect(sms.sent.length).toBe(smsCount);

    // Old code rejected, new code verifies.
    const oldAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-otp',
      payload: { phone, purpose: 'PHONE_VERIFY', code: oldCode },
    });
    expect(oldAttempt.statusCode).toBe(400);
    const newAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-otp',
      payload: { phone, purpose: 'PHONE_VERIFY', code: newCode },
    });
    expect(newAttempt.statusCode).toBe(200);

    // 3/hour/phone: the third call was the unknown phone (separate key), so
    // one more for THIS phone is the third → allowed; the fourth → 429.
    expect((await resend(phone)).statusCode).toBe(202);
    const limited = await resend(phone);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.message.sw).toBeTruthy(); // bilingual envelope
  });

  it('booking is race-safe: two concurrent bookings for one slot → exactly one 201, one 409 SLOT_TAKEN', async () => {
    // Seed an APPROVED doctor and two verified patients directly in the DB.
    const doctorUser = await db.prisma.user.create({
      data: {
        phone: '+255700000101',
        passwordHash: 'x',
        fullName: 'Dr Neema Lyimo',
        role: 'DOCTOR',
        phoneVerifiedAt: new Date(),
        doctor: {
          create: {
            tmcRegistrationNumber: 'TMC/REG/77001',
            specialty: 'GENERAL_PRACTICE',
            yearsOfExperience: 10,
            consultationFeeTzs: 25_000,
            verificationStatus: 'APPROVED',
            verifiedAt: new Date(),
          },
        },
      },
      include: { doctor: true },
    });
    const doctorId = doctorUser.doctor!.id;

    async function loginPatient(patientPhone: string): Promise<string> {
      const register = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          phone: patientPhone,
          password,
          fullName: 'Race Tester',
          dateOfBirth: '1995-05-05',
          gender: 'FEMALE',
        },
      });
      expect(register.statusCode).toBe(202);
      const verify = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-otp',
        payload: { phone: patientPhone, purpose: 'PHONE_VERIFY', code: sms.lastCode() },
      });
      expect(verify.statusCode).toBe(200);
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { phone: patientPhone, password },
      });
      expect(login.statusCode).toBe(200);
      return (login.json() as { accessToken: string }).accessToken;
    }

    const [tokenA, tokenB] = await Promise.all([
      loginPatient('+255700000102'),
      loginPatient('+255700000103'),
    ]);

    const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const book = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/appointments',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          doctorId,
          type: 'VIDEO',
          scheduledAt,
          reason: 'Race condition check',
          paymentIntent: 'MOBILE_MONEY',
        },
      });

    // Fire both at once — the partial unique index must let exactly one through.
    const [first, second] = await Promise.all([book(tokenA), book(tokenB)]);
    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([201, 409]);

    const loser = first.statusCode === 409 ? first : second;
    expect(loser.json().error.code).toBe('SLOT_TAKEN');

    const winner = first.statusCode === 201 ? first : second;
    expect(winner.json().status).toBe('PENDING_PAYMENT'); // MOBILE_MONEY awaits payment

    // Exactly one slot-holding appointment exists for that (doctor, time).
    const held = await db.prisma.appointment.count({
      where: { doctorId, scheduledAt: new Date(scheduledAt), status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
    });
    expect(held).toBe(1);
  });

  it('full remote flow: book → confirm → start → notes → diagnoses → complete → encrypted record → patient reads → rating', async () => {
    // Seed doctor + patient directly; login the patient over HTTP.
    const doctorUser = await db.prisma.user.create({
      data: {
        phone: '+255700000201',
        passwordHash: 'x',
        fullName: 'Dr Upendo Mushi',
        role: 'DOCTOR',
        phoneVerifiedAt: new Date(),
        doctor: {
          create: {
            tmcRegistrationNumber: 'TMC/REG/77002',
            specialty: 'INTERNAL_MEDICINE',
            yearsOfExperience: 8,
            consultationFeeTzs: 30_000,
            verificationStatus: 'APPROVED',
            verifiedAt: new Date(),
          },
        },
      },
      include: { doctor: true },
    });
    const doctorId = doctorUser.doctor!.id;

    const patientPhone = '+255700000202';
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        phone: patientPhone,
        password,
        fullName: 'Zawadi Komba',
        dateOfBirth: '1993-03-03',
        gender: 'FEMALE',
      },
    });
    expect(register.statusCode).toBe(202);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-otp',
      payload: { phone: patientPhone, purpose: 'PHONE_VERIFY', code: sms.lastCode() },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { phone: patientPhone, password },
    });
    const patientToken = (login.json() as { accessToken: string }).accessToken;

    // Book (MOBILE_MONEY → PENDING_PAYMENT), then the fake payment completes.
    const booked = await app.inject({
      method: 'POST',
      url: '/api/v1/appointments',
      headers: { authorization: `Bearer ${patientToken}` },
      payload: {
        doctorId,
        type: 'VIDEO',
        scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        reason: 'Kizunguzungu na uchovu',
        paymentIntent: 'MOBILE_MONEY',
      },
    });
    expect(booked.statusCode).toBe(201);
    const appointmentId = (booked.json() as { id: string }).id;
    await services.appointments.handlePaymentCompleted(appointmentId); // webhook path

    // Doctor drives the consultation through the services (no doctor password seeded).
    const started = await services.consultations.start(doctorUser.id, appointmentId);
    const consultationId = started.id;

    const plaintextNotes = {
      chiefComplaint: 'Kizunguzungu kwa wiki mbili',
      historyOfPresentIllness: 'Fatigue, dizziness on standing, poor appetite',
      examination: 'Pale conjunctivae, BP 100/65',
      assessment: 'Suspected iron-deficiency anaemia',
      plan: 'FBC + ferritin, start oral iron, review with results',
    };
    await services.consultations.updateNotes(doctorUser.id, consultationId, plaintextNotes);
    await services.consultations.addDiagnosis(doctorUser.id, consultationId, {
      icd10Code: 'D50.9',
      description: 'Iron deficiency anaemia, unspecified',
      type: 'PRIMARY',
    });
    const completed = await services.consultations.complete(doctorUser.id, consultationId);
    expect(completed.status).toBe('COMPLETED');

    // The RAW DB columns must hold ciphertext only — never the plaintext.
    const consultationRow = await db.prisma.consultation.findUniqueOrThrow({
      where: { id: consultationId },
    });
    const recordRow = await db.prisma.medicalRecord.findFirstOrThrow({
      where: { consultationId },
    });
    for (const fragment of Object.values(plaintextNotes)) {
      expect(consultationRow.encryptedNotes).not.toContain(fragment);
      expect(recordRow.encryptedContent).not.toContain(fragment);
    }
    // The blobs are v1 AES-GCM payloads that decrypt back to the notes.
    expect(JSON.parse(consultationRow.encryptedNotes!)).toMatchObject({ v: 1 });
    expect(JSON.parse(decryptHealthData(consultationRow.encryptedNotes!))).toEqual(plaintextNotes);

    // Patient reads the decrypted record over HTTP.
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/medical-records/me',
      headers: { authorization: `Bearer ${patientToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(1);
    const recordId = list.json().items[0].id as string;

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/medical-records/${recordId}`,
      headers: { authorization: `Bearer ${patientToken}` },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().content.notes).toEqual(plaintextNotes);
    expect(read.json().content.diagnoses[0].icd10Code).toBe('D50.9');

    // The read is audited with the entity id.
    const audited = await db.prisma.auditLog.findFirst({
      where: { action: 'MEDICAL_RECORD_VIEWED', resourceId: recordId },
    });
    expect(audited).not.toBeNull();

    // Rating over HTTP: once only.
    const rating = await app.inject({
      method: 'POST',
      url: `/api/v1/consultations/${consultationId}/rating`,
      headers: { authorization: `Bearer ${patientToken}` },
      payload: { rating: 5, communication: 5, comment: 'Daktari makini sana' },
    });
    expect(rating.statusCode).toBe(201);
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/consultations/${consultationId}/rating`,
      headers: { authorization: `Bearer ${patientToken}` },
      payload: { rating: 1 },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('ALREADY_RATED');

    const doctorRow = await db.prisma.doctor.findUniqueOrThrow({ where: { id: doctorId } });
    expect(doctorRow.totalRatings).toBe(1);
    expect(doctorRow.averageRating).toBe(5);
  });

  it('two concurrent ratings on different consultations fold into the aggregates atomically', async () => {
    const doctorUser = await db.prisma.user.create({
      data: {
        phone: '+255700000301',
        passwordHash: 'x',
        fullName: 'Dr Baraka Temu',
        role: 'DOCTOR',
        phoneVerifiedAt: new Date(),
        doctor: {
          create: {
            tmcRegistrationNumber: 'TMC/REG/77003',
            specialty: 'GENERAL_PRACTICE',
            yearsOfExperience: 4,
            consultationFeeTzs: 20_000,
            verificationStatus: 'APPROVED',
          },
        },
      },
      include: { doctor: true },
    });
    const doctorId = doctorUser.doctor!.id;

    async function completedConsultationFor(phone: string, hourOffset: number) {
      const patientUser = await db.prisma.user.create({
        data: {
          phone,
          passwordHash: 'x',
          fullName: 'Rating Tester',
          role: 'PATIENT',
          phoneVerifiedAt: new Date(),
          patient: {
            create: {
              dateOfBirth: new Date('1990-01-01'),
              gender: 'MALE',
              region: 'DODOMA',
              district: 'Dodoma Mjini',
            },
          },
        },
        include: { patient: true },
      });
      const appointment = await db.prisma.appointment.create({
        data: {
          patientId: patientUser.patient!.id,
          doctorId,
          type: 'VIDEO',
          status: 'COMPLETED',
          scheduledAt: new Date(Date.now() + hourOffset * 60 * 60 * 1000),
          durationMinutes: 30,
          reason: 'x',
          paymentIntent: 'MOBILE_MONEY',
        },
      });
      const consultation = await db.prisma.consultation.create({
        data: {
          appointmentId: appointment.id,
          patientId: patientUser.patient!.id,
          doctorId,
          status: 'COMPLETED',
          startedAt: new Date(),
          endedAt: new Date(),
        },
      });
      return { userId: patientUser.id, consultationId: consultation.id };
    }

    const [first, second] = await Promise.all([
      completedConsultationFor('+255700000302', 100),
      completedConsultationFor('+255700000303', 101),
    ]);

    // Two truly concurrent createWithAggregates calls — the single-statement
    // SQL UPDATE has no read-modify-write window to race.
    await Promise.all([
      services.ratings.rate(first.userId, first.consultationId, { rating: 5 }),
      services.ratings.rate(second.userId, second.consultationId, { rating: 2 }),
    ]);

    const doctorRow = await db.prisma.doctor.findUniqueOrThrow({ where: { id: doctorId } });
    expect(doctorRow.totalRatings).toBe(2);
    expect(doctorRow.averageRating).toBeCloseTo(3.5, 10);
  });

  it('screening → COMPLETED with TELECONSULTATION → booking with screeningResultId validated', async () => {
    // A directory doctor for the suggestion + the booking.
    const doctorUser = await db.prisma.user.create({
      data: {
        phone: '+255700000401',
        passwordHash: 'x',
        fullName: 'Dr Amani Kessy',
        role: 'DOCTOR',
        phoneVerifiedAt: new Date(),
        doctor: {
          create: {
            tmcRegistrationNumber: 'TMC/REG/77004',
            specialty: 'GENERAL_PRACTICE',
            yearsOfExperience: 6,
            consultationFeeTzs: 20_000,
            verificationStatus: 'APPROVED',
            verifiedAt: new Date(),
            averageRating: 4.7,
          },
        },
      },
      include: { doctor: true },
    });

    // Patient over HTTP.
    const patientPhone = '+255700000402';
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        phone: patientPhone,
        password,
        fullName: 'Neema Chuwa',
        dateOfBirth: '1994-06-06',
        gender: 'FEMALE',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-otp',
      payload: { phone: patientPhone, purpose: 'PHONE_VERIFY', code: sms.lastCode() },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { phone: patientPhone, password },
    });
    const token = (login.json() as { accessToken: string }).accessToken;
    const auth = { authorization: `Bearer ${token}` };

    // Start the session — canned opening, no model call.
    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/screening/sessions',
      headers: auth,
      payload: {},
    });
    expect(started.statusCode).toBe(201);
    const sessionId = started.json().sessionId as string;
    expect(started.json().message).toContain('112');
    expect(fakeAi.callCount).toBe(0);

    // One exchange that completes the triage.
    const symptom = 'Nina homa ya siku tatu na kichwa kinauma';
    fakeAi
      .reply('Asante kwa maelezo. Ninapendekeza uongee na daktari.')
      .replyJson({
        triageComplete: true,
        triageLevel: 'TELECONSULTATION',
        urgencyScore: 5,
        suggestedSpecialty: 'GENERAL_PRACTICE',
        confidence: 0.9,
        rationale: 'Persistent fever needs remote review',
      });
    const messaged = await app.inject({
      method: 'POST',
      url: `/api/v1/ai/screening/sessions/${sessionId}/messages`,
      headers: auth,
      payload: { message: symptom },
    });
    expect(messaged.statusCode).toBe(200);
    expect(messaged.json().status).toBe('COMPLETED');
    expect(messaged.json().triage.triageLevel).toBe('TELECONSULTATION');
    expect(messaged.json().suggestedDoctors.length).toBeGreaterThan(0);

    // Raw DB column holds ciphertext only — never the symptom text.
    const row = await db.prisma.aIScreeningResult.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.status).toBe('COMPLETED');
    expect(row.encryptedConversation).not.toContain('homa');
    expect(row.encryptedConversation).not.toContain(symptom);
    expect(JSON.parse(row.encryptedConversation!)).toMatchObject({ v: 1 });
    expect(decryptHealthData(row.encryptedConversation!)).toContain(symptom);

    // Booking with the screening linked validates COMPLETED + ownership.
    const booked = await app.inject({
      method: 'POST',
      url: '/api/v1/appointments',
      headers: auth,
      payload: {
        doctorId: doctorUser.doctor!.id,
        type: 'VIDEO',
        scheduledAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        reason: 'Kufuatilia homa baada ya maswali ya awali',
        paymentIntent: 'MOBILE_MONEY',
        screeningResultId: sessionId,
      },
    });
    expect(booked.statusCode).toBe(201);
    const appointmentRow = await db.prisma.appointment.findUniqueOrThrow({
      where: { id: booked.json().id as string },
    });
    expect(appointmentRow.screeningResultId).toBe(sessionId);
  });

  it('money flow: book → pay → signed webhook → CONFIRMED → consultation COMPLETED → exact integer accrual', async () => {
    const { createHmac } = await import('node:crypto');
    const { splitFee } = await import('@daktari/payments');
    const FEE = 25_001; // odd amount so the remainder-to-platform rule is visible

    const doctorUser = await db.prisma.user.create({
      data: {
        phone: '+255700000501',
        passwordHash: 'x',
        fullName: 'Dr Peter Mnyika',
        role: 'DOCTOR',
        phoneVerifiedAt: new Date(),
        doctor: {
          create: {
            tmcRegistrationNumber: 'TMC/REG/77005',
            specialty: 'GENERAL_PRACTICE',
            yearsOfExperience: 9,
            consultationFeeTzs: FEE,
            verificationStatus: 'APPROVED',
            verifiedAt: new Date(),
          },
        },
      },
      include: { doctor: true },
    });
    const doctorId = doctorUser.doctor!.id;

    // Patient seeded directly (the per-IP register cap is spent by earlier
    // tests); token minted the same way the auth service would.
    const { randomUUID } = await import('node:crypto');
    const { signAccessToken } = await import('@daktari/auth');
    const patientUser = await db.prisma.user.create({
      data: {
        phone: '+255742000502', // Vodacom prefix → MPESA
        passwordHash: 'x',
        fullName: 'Halima Said',
        role: 'PATIENT',
        phoneVerifiedAt: new Date(),
        patient: {
          create: {
            dateOfBirth: new Date('1991-01-01'),
            gender: 'FEMALE',
            region: 'DAR_ES_SALAAM',
            district: 'Ilala',
          },
        },
      },
    });
    const sessionId = randomUUID();
    await db.sessionRepository.create({
      id: sessionId,
      userId: patientUser.id,
      refreshTokenHash: randomUUID(),
      tokenFamily: randomUUID(),
      userAgent: null,
      ipAddress: null,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const accessToken = await signAccessToken({
      sub: patientUser.id,
      role: 'PATIENT',
      sessionId,
    });
    const auth = { authorization: `Bearer ${accessToken}` };

    // Book (auto-initiates collection attempt 1) and re-POST pay (idempotent).
    const booked = await app.inject({
      method: 'POST',
      url: '/api/v1/appointments',
      headers: auth,
      payload: {
        doctorId,
        type: 'VIDEO',
        scheduledAt: new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString(),
        reason: 'Malipo integration',
        paymentIntent: 'MOBILE_MONEY',
      },
    });
    expect(booked.statusCode).toBe(201);
    const appointmentId = booked.json().id as string;

    const pay = await app.inject({
      method: 'POST',
      url: `/api/v1/appointments/${appointmentId}/pay`,
      headers: auth,
    });
    expect(pay.statusCode).toBe(200);
    expect(pay.json().status).toBe('PROCESSING');
    const collections = fakePayments.collections.filter(
      (entry) => entry.externalReference.startsWith(appointmentId),
    );
    expect(collections).toHaveLength(1); // idempotent: booking initiated, /pay reused

    // Signed provider webhook completes the payment.
    const body = JSON.stringify(
      fakePayments.webhookBodyFor(collections[0]!.providerReference, 'success'),
    );
    const signature = createHmac('sha256', 'whsec-test-secret-value').update(body, 'utf8').digest('hex');
    const webhook = await app.inject({
      method: 'POST',
      url: '/webhooks/azampay',
      headers: { 'content-type': 'application/json', 'x-azampay-signature': signature },
      payload: body,
    });
    expect(webhook.statusCode).toBe(200);
    expect(webhook.json().outcome).toBe('applied');

    const appointmentRow = await db.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(appointmentRow.status).toBe('CONFIRMED');
    const paymentRow = await db.prisma.payment.findUniqueOrThrow({ where: { appointmentId } });
    expect(paymentRow.status).toBe('COMPLETED');
    expect(paymentRow.platformFeeTzs + paymentRow.doctorAmountTzs).toBe(FEE);

    // Consultation start → notes → complete drives the accrual.
    const started = await services.consultations.start(doctorUser.id, appointmentId);
    await services.consultations.updateNotes(doctorUser.id, started.id, {
      assessment: 'Assessment for the payment flow',
      plan: 'Plan for the payment flow',
    });
    await services.consultations.complete(doctorUser.id, started.id);

    const accrual = await db.prisma.doctorPayment.findFirstOrThrow({
      where: { reference: `consultation:${started.id}` },
    });
    expect(accrual.doctorId).toBe(doctorId);
    expect(accrual.status).toBe('PENDING'); // payout execution is a later phase
    expect(accrual.amountTzs).toBe(splitFee(FEE).doctorAmountTzs);
    expect(accrual.amountTzs + paymentRow.platformFeeTzs).toBe(FEE); // exact integer split
  });
});
