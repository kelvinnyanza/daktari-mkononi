import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasPermission, PERMISSIONS, ROLES, type Role } from '@daktari/auth';
import { rateConsultationSchema } from '@daktari/schemas';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import { RatingService } from '../src/modules/consultations/rating.service.js';
import { APPOINTMENT_TRANSITIONS } from '../src/modules/appointments/appointment.machine.js';
import { authorize } from '../src/middleware/authenticate.js';
import { ApiError } from '../src/lib/errors.js';

beforeAll(() => {
  applyTestEnv();
});

// ── Step 0 regression: mutations are never gated by read permissions ─────────

describe('appointment permission split (Phase 4 review fix)', () => {
  it('no mutating transition in the table is gated by a read permission', () => {
    for (const transition of APPOINTMENT_TRANSITIONS) {
      if (transition.permission !== null) {
        expect(transition.permission, `${transition.event} from ${transition.from}`).not.toMatch(
          /:read:/,
        );
      }
    }
  });

  it('doctor-side mutations require appointment:manage:assigned', () => {
    for (const event of ['DOCTOR_CANCEL', 'CHECK_IN', 'MARK_NO_SHOW'] as const) {
      for (const transition of APPOINTMENT_TRANSITIONS.filter((t) => t.event === event)) {
        expect(transition.permission).toBe('appointment:manage:assigned');
      }
    }
  });

  it('doctors keep their effective capabilities (read AND manage)', () => {
    expect(hasPermission('DOCTOR', 'appointment:read:assigned')).toBe(true);
    expect(hasPermission('DOCTOR', 'appointment:manage:assigned')).toBe(true);
    expect(hasPermission('PLATFORM_ADMIN', 'appointment:manage:assigned')).toBe(true); // appointment:*
  });

  it('a role holding only appointment:read:assigned cannot pass the manage authorize gate', async () => {
    // No shipped role holds ONLY the read grant, so simulate the hypothetical
    // role the way authorize() sees it: hasPermission(role, needed) === false
    // for every role whose appointment grants are read-only.
    const readOnlyAppointmentRoles = ROLES.filter(
      (role: Role) =>
        PERMISSIONS[role].some((grant) => String(grant).startsWith('appointment:read')) &&
        !hasPermission(role, 'appointment:manage:assigned'),
    );
    expect(readOnlyAppointmentRoles.length).toBeGreaterThan(0); // HOSPITAL_ADMIN

    const gate = authorize('appointment:manage:assigned');
    for (const role of readOnlyAppointmentRoles) {
      const request = {
        auth: { userId: 'u1', role, sessionId: 's1' },
      } as unknown as Parameters<typeof gate>[0];
      const error = await (gate.call(undefined as never, request, undefined as never) as Promise<void>).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error, role).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(403);
    }
  });
});

// ── Step 5: ratings ───────────────────────────────────────────────────────────

describe('ratings', () => {
  let deps: FakeDeps;
  let service: RatingService;

  beforeEach(() => {
    deps = makeFakeDeps();
    service = new RatingService(deps);
  });

  async function completedConsultation(doctorId?: string) {
    const doctorSeed = doctorId
      ? null
      : deps.seedDoctor({}, { verificationStatus: 'APPROVED' });
    const resolvedDoctorId = doctorId ?? doctorSeed!.doctor.id;
    const { user, patient } = deps.seedPatient({
      phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    });
    const appointment = await deps.appointments.create({
      patientId: patient.id,
      doctorId: resolvedDoctorId,
      type: 'VIDEO',
      status: 'COMPLETED',
      scheduledAt: new Date(`2026-07-2${Math.floor(Math.random() * 9)}T0${Math.floor(Math.random() * 9)}:00:00.000Z`),
      durationMinutes: 30,
      reason: 'x',
      paymentIntent: 'MOBILE_MONEY',
    });
    const consultation = await deps.consultations.create({
      appointmentId: appointment.id,
      patientId: patient.id,
      doctorId: resolvedDoctorId,
      startedAt: new Date(),
    });
    await deps.consultations.transitionStatus(consultation.id, 'IN_PROGRESS', {
      status: 'COMPLETED',
    });
    return { user, patient, doctorId: resolvedDoctorId, consultationId: consultation.id };
  }

  it('patient rates a completed consultation once; aggregates update', async () => {
    const { user, doctorId, consultationId } = await completedConsultation();
    await service.rate(user.id, consultationId, { rating: 4 });

    const doctor = deps.state.doctors.get(doctorId)!;
    expect(doctor.totalRatings).toBe(1);
    expect(doctor.averageRating).toBe(4);

    const again = await service
      .rate(user.id, consultationId, { rating: 5 })
      .then(() => null, (caught: unknown) => caught as ApiError);
    expect(again?.code).toBe('ALREADY_RATED');
    expect(deps.state.doctors.get(doctorId)!.totalRatings).toBe(1); // unchanged
  });

  it('two ratings on different consultations of the same doctor both fold in', async () => {
    const first = await completedConsultation();
    const second = await completedConsultation(first.doctorId);

    await Promise.all([
      service.rate(first.user.id, first.consultationId, { rating: 5 }),
      service.rate(second.user.id, second.consultationId, { rating: 3 }),
    ]);
    const doctor = deps.state.doctors.get(first.doctorId)!;
    expect(doctor.totalRatings).toBe(2);
    expect(doctor.averageRating).toBe(4);
  });

  it('rejects rating an IN_PROGRESS consultation and rating someone else’s', async () => {
    const { user, patient, doctorId } = await completedConsultation();
    const appointment = await deps.appointments.create({
      patientId: patient.id,
      doctorId,
      type: 'VIDEO',
      status: 'IN_PROGRESS',
      scheduledAt: new Date('2026-08-01T06:00:00.000Z'),
      durationMinutes: 30,
      reason: 'x',
      paymentIntent: 'MOBILE_MONEY',
    });
    const running = await deps.consultations.create({
      appointmentId: appointment.id,
      patientId: patient.id,
      doctorId,
      startedAt: new Date(),
    });
    const notDone = await service
      .rate(user.id, running.id, { rating: 5 })
      .then(() => null, (caught: unknown) => caught as ApiError);
    expect(notDone?.code).toBe('CONSULTATION_NOT_COMPLETED');

    const other = await completedConsultation();
    const stranger = await service
      .rate(user.id, other.consultationId, { rating: 1 })
      .then(() => null, (caught: unknown) => caught as ApiError);
    expect(stranger?.code).toBe('CONSULTATION_NOT_FOUND');
  });

  it('sanitizes comments at the boundary: control chars and angle brackets stripped', async () => {
    const { user, consultationId } = await completedConsultation();
    // The route parses the body through rateConsultationSchema — same here.
    const input = rateConsultationSchema.parse({
      rating: 5,
      comment: 'Huduma nzuri <script>alert(1)</script>  sana',
    });
    expect(input.comment).not.toContain('<');
    expect(input.comment).not.toContain('>');
    expect(input.comment).toContain('scriptalert(1)/script'); // tags neutered, text kept

    await service.rate(user.id, consultationId, input);
    const stored = [...deps.state.consultationRatings.values()][0]!;
    expect(stored.comment).toBe(input.comment ?? null);
  });
});
