import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptHealthData } from '@daktari/encryption';
import { icd10CodeSchema } from '@daktari/schemas';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import { AppointmentService } from '../src/modules/appointments/appointment.service.js';
import { ConsultationService } from '../src/modules/consultations/consultation.service.js';
import { MedicalRecordService } from '../src/modules/medical-records/medical-record.service.js';
import { ApiError } from '../src/lib/errors.js';

const NOW = new Date('2026-07-16T09:00:00.000Z');
const SLOT = new Date('2026-07-20T06:00:00.000Z');

let deps: FakeDeps;
let clock: { now: Date };
let consultations: ConsultationService;
let medicalRecords: MedicalRecordService;
let appointments: AppointmentService;

async function expectApiError(promise: Promise<unknown>, code: string): Promise<ApiError> {
  const error = await promise.then(
    () => {
      throw new Error(`expected ApiError ${code}, but the call succeeded`);
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe(code);
  return error as ApiError;
}

beforeAll(() => {
  applyTestEnv();
});

beforeEach(() => {
  deps = makeFakeDeps();
  clock = { now: new Date(NOW) };
  const now = () => clock.now;
  medicalRecords = new MedicalRecordService(deps, now);
  consultations = new ConsultationService({ ...deps, medicalRecords }, now);
  appointments = new AppointmentService(deps, now);
});

/** Book a confirmed VIDEO appointment and return all the actors. */
async function confirmedVideoAppointment() {
  const { doctor, user: doctorUser } = deps.seedDoctor({}, { verificationStatus: 'APPROVED' });
  const { user: patientUser, patient } = deps.seedPatient();
  const booked = await appointments.book(patientUser.id, {
    doctorId: doctor.id,
    type: 'VIDEO',
    scheduledAt: new Date(SLOT),
    reason: 'Kikohozi cha muda mrefu',
    paymentIntent: 'MOBILE_MONEY',
  });
  await appointments.handlePaymentCompleted(booked.id);
  return { doctor, doctorUser, patientUser, patient, appointmentId: booked.id };
}

async function startedConsultation() {
  const ctx = await confirmedVideoAppointment();
  const started = await consultations.start(ctx.doctorUser.id, ctx.appointmentId);
  return { ...ctx, consultationId: started.id, started };
}

const FULL_NOTES = {
  chiefComplaint: 'Kikohozi kwa wiki tatu',
  historyOfPresentIllness: 'Dry cough, worse at night, no fever',
  examination: 'Chest clear, no wheeze',
  assessment: 'Post-viral cough, no red flags',
  plan: 'Symptomatic treatment, review in 2 weeks',
};

describe('start', () => {
  it('doctor starts from CONFIRMED remote appointment; creates room + doctor token', async () => {
    const { doctorUser, appointmentId } = await confirmedVideoAppointment();
    const started = await consultations.start(doctorUser.id, appointmentId);

    expect(started.status).toBe('IN_PROGRESS');
    expect(started.videoRoomUrl).toMatch(/^https:\/\/fake\.daily\.local\//);
    expect(started.meetingToken).toContain('doctor');
    expect(deps.state.appointments.get(appointmentId)!.status).toBe('IN_PROGRESS');
  });

  it('patient fetches their own role-scoped token', async () => {
    const { patientUser, consultationId } = await startedConsultation();
    const token = await consultations.meetingToken(patientUser.id, consultationId);
    expect(token.meetingToken).toContain('patient');
  });

  it('IN_PERSON requires CHECKED_IN first (CONFIRMED start → 409)', async () => {
    const { doctor, user: doctorUser } = deps.seedDoctor({}, { verificationStatus: 'APPROVED' });
    const { user: patientUser } = deps.seedPatient();
    const booked = await appointments.book(patientUser.id, {
      doctorId: doctor.id,
      type: 'IN_PERSON',
      scheduledAt: new Date(SLOT),
      reason: 'Uchunguzi wa mwili',
      paymentIntent: 'CASH_AT_FACILITY',
    });
    await expectApiError(consultations.start(doctorUser.id, booked.id), 'CHECK_IN_REQUIRED');

    // After check-in the same start succeeds — and no video room is created.
    await appointments.checkIn(doctorUser.id, booked.checkInToken!);
    const started = await consultations.start(doctorUser.id, booked.id);
    expect(started.status).toBe('IN_PROGRESS');
    expect(started.videoRoomUrl).toBeNull();
  });

  it('another doctor cannot start it; double-start is illegal', async () => {
    const { doctorUser, appointmentId } = await confirmedVideoAppointment();
    const other = deps.seedDoctor({}, { verificationStatus: 'APPROVED' });
    await expectApiError(consultations.start(other.user.id, appointmentId), 'APPOINTMENT_NOT_FOUND');

    await consultations.start(doctorUser.id, appointmentId);
    await expectApiError(consultations.start(doctorUser.id, appointmentId), 'INVALID_STATE_TRANSITION');
  });
});

describe('clinical notes — encrypted at rest', () => {
  it('stores ALL free-text fields in one encrypted blob, never plaintext', async () => {
    const { doctorUser, consultationId } = await startedConsultation();
    await consultations.updateNotes(doctorUser.id, consultationId, FULL_NOTES);

    const row = deps.state.consultations.get(consultationId)!;
    expect(row.encryptedNotes).not.toBeNull();
    // The raw stored value must not contain any plaintext fragment.
    for (const value of Object.values(FULL_NOTES)) {
      expect(row.encryptedNotes).not.toContain(value);
    }
    // And it decrypts back to exactly what was written.
    expect(JSON.parse(decryptHealthData(row.encryptedNotes!))).toEqual(FULL_NOTES);
  });

  it('merges partial updates into the blob', async () => {
    const { doctorUser, consultationId } = await startedConsultation();
    await consultations.updateNotes(doctorUser.id, consultationId, { chiefComplaint: 'Kikohozi' });
    const view = await consultations.updateNotes(doctorUser.id, consultationId, { plan: 'Rest' });
    expect(view.notes).toEqual({ chiefComplaint: 'Kikohozi', plan: 'Rest' });
  });

  it('patient cannot write notes and does not receive them on reads', async () => {
    const { doctorUser, patientUser, consultationId } = await startedConsultation();
    await consultations.updateNotes(doctorUser.id, consultationId, FULL_NOTES);

    await expectApiError(
      consultations.updateNotes(patientUser.id, consultationId, { plan: 'my own plan' }),
      'CONSULTATION_NOT_FOUND', // non-doctor participants get a 404, not the notes
    );
    const patientView = await consultations.get(patientUser.id, consultationId);
    expect(patientView.notes).toBeUndefined();
  });
});

describe('diagnoses', () => {
  it('validates ICD-10 format: letter + 2 digits + optional .subcode', () => {
    expect(icd10CodeSchema.parse('b50.9')).toBe('B50.9'); // normalized
    expect(icd10CodeSchema.parse('A09')).toBe('A09');
    expect(() => icd10CodeSchema.parse('50.9')).toThrow(); // no letter
    expect(() => icd10CodeSchema.parse('U07')).toThrow(); // U is not in A-TV-Z
    expect(() => icd10CodeSchema.parse('B5')).toThrow(); // too short
    expect(() => icd10CodeSchema.parse('B50.999')).toThrow(); // subcode too long
  });

  it('allows at most one PRIMARY diagnosis; remove frees the slot', async () => {
    const { doctorUser, consultationId } = await startedConsultation();
    const view = await consultations.addDiagnosis(doctorUser.id, consultationId, {
      icd10Code: 'B50.9',
      description: 'Malaria, unspecified',
      type: 'PRIMARY',
    });
    await expectApiError(
      consultations.addDiagnosis(doctorUser.id, consultationId, {
        icd10Code: 'A09',
        description: 'Gastroenteritis',
        type: 'PRIMARY',
      }),
      'PRIMARY_DIAGNOSIS_EXISTS',
    );
    // SECONDARY and DIFFERENTIAL are unlimited.
    await consultations.addDiagnosis(doctorUser.id, consultationId, {
      icd10Code: 'A09',
      description: 'Gastroenteritis',
      type: 'DIFFERENTIAL',
    });

    const primary = view.diagnoses.find((d) => d.type === 'PRIMARY') ??
      (await consultations.get(doctorUser.id, consultationId)).diagnoses.find((d) => d.type === 'PRIMARY')!;
    await consultations.removeDiagnosis(doctorUser.id, consultationId, primary.id);
    const after = await consultations.addDiagnosis(doctorUser.id, consultationId, {
      icd10Code: 'J06.9',
      description: 'Acute URTI',
      type: 'PRIMARY',
    });
    expect(after.diagnoses.filter((d) => d.type === 'PRIMARY')).toHaveLength(1);
  });
});

describe('complete', () => {
  it('requires assessment + plan before completing', async () => {
    const { doctorUser, consultationId } = await startedConsultation();
    await consultations.updateNotes(doctorUser.id, consultationId, {
      chiefComplaint: 'Kikohozi',
      assessment: 'Post-viral cough',
      // no plan yet
    });
    await expectApiError(consultations.complete(doctorUser.id, consultationId), 'CLINICAL_NOTES_INCOMPLETE');
  });

  it('completes: durationSeconds computed, room ended, record generated, doctor counter bumped', async () => {
    const { doctor, doctorUser, patient, consultationId, appointmentId } = await startedConsultation();
    await consultations.updateNotes(doctorUser.id, consultationId, FULL_NOTES);
    clock.now = new Date(NOW.getTime() + 25 * 60_000); // 25 minutes later

    const completed = await consultations.complete(doctorUser.id, consultationId);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.durationSeconds).toBe(25 * 60);
    expect(deps.state.appointments.get(appointmentId)!.status).toBe('COMPLETED');
    expect(deps.video.rooms.get(`fake-room-${appointmentId}`)!.ended).toBe(true);
    expect(deps.state.doctors.get(doctor.id)!.totalConsultations).toBe(1);

    // Medical record: linked ids, non-sensitive summary, encrypted detail.
    const record = [...deps.state.medicalRecords.values()][0]!;
    expect(record.patientId).toBe(patient.id);
    expect(record.consultationId).toBe(consultationId);
    expect(record.type).toBe('CONSULTATION_NOTE');
    for (const value of Object.values(FULL_NOTES)) {
      expect(record.encryptedContent).not.toContain(value);
      expect(record.summary ?? '').not.toContain(value);
    }
    const detail = JSON.parse(decryptHealthData(record.encryptedContent)) as { notes: unknown };
    expect(detail.notes).toEqual(FULL_NOTES);
  });

  it('a Daily failure when ending the room never skips the record, the broadcast or the audit', async () => {
    const { doctorUser, consultationId } = await startedConsultation();
    await consultations.updateNotes(doctorUser.id, consultationId, FULL_NOTES);
    deps.video.endRoom = () => Promise.reject(new Error('Daily.co DELETE /rooms/x failed (503)'));
    const frames: unknown[] = [];
    deps.pubsub.subscribe(`consultation:${consultationId}`, (event) => frames.push(event));

    const completed = await consultations.complete(doctorUser.id, consultationId);

    expect(completed.status).toBe('COMPLETED');
    expect([...deps.state.medicalRecords.values()].some((r) => r.consultationId === consultationId)).toBe(true);
    expect(frames).toContainEqual(expect.objectContaining({ type: 'consultation.status', status: 'COMPLETED' }));
    expect(deps.state.auditEntries.map((entry) => entry.action)).toContain('VIDEO_ROOM_END_FAILED');
  });

  it('completing twice is illegal', async () => {
    const { doctorUser, consultationId } = await startedConsultation();
    await consultations.updateNotes(doctorUser.id, consultationId, FULL_NOTES);
    await consultations.complete(doctorUser.id, consultationId);
    await expectApiError(consultations.complete(doctorUser.id, consultationId), 'INVALID_STATE_TRANSITION');
  });
});

describe('abort / restart — once only', () => {
  it('either participant can abort; appointment returns to CONFIRMED; restart works once', async () => {
    const { doctorUser, patientUser, consultationId, appointmentId } = await startedConsultation();

    // Patient aborts on a technical failure.
    const aborted = await consultations.abort(patientUser.id, consultationId, 'video froze');
    expect(aborted.status).toBe('ABANDONED');
    expect(aborted.endReason).toBe('TECHNICAL_FAILURE:video froze');
    expect(deps.state.appointments.get(appointmentId)!.status).toBe('CONFIRMED');
    expect(deps.state.appointments.get(appointmentId)!.technicalFailureAt).not.toBeNull();

    // Restart reuses the consultation row with a fresh room.
    const restarted = await consultations.start(doctorUser.id, appointmentId);
    expect(restarted.id).toBe(consultationId);
    expect(restarted.status).toBe('IN_PROGRESS');
    expect(deps.video.rooms.has(`fake-room-${appointmentId}-r2`)).toBe(true);

    // Second abort-restart cycle is rejected: the once-only guard holds.
    await expectApiError(
      consultations.abort(doctorUser.id, consultationId, 'failed again'),
      'RESTART_ALREADY_USED',
    );
    // Nothing changed: still IN_PROGRESS, appointment still IN_PROGRESS.
    expect(deps.state.consultations.get(consultationId)!.status).toBe('IN_PROGRESS');
    expect(deps.state.appointments.get(appointmentId)!.status).toBe('IN_PROGRESS');
  });

  it('non-participants cannot abort', async () => {
    const { consultationId } = await startedConsultation();
    const stranger = deps.seedPatient({ phone: '+255754999111' });
    await expectApiError(
      consultations.abort(stranger.user.id, consultationId, 'not mine'),
      'CONSULTATION_NOT_FOUND',
    );
  });
});

describe('recording consent', () => {
  it('only the PATIENT account can grant it; consent is audit-logged', async () => {
    const { doctorUser, patientUser, consultationId } = await startedConsultation();

    const denied = await expectApiError(
      consultations.grantRecordingConsent(doctorUser.id, consultationId),
      'PATIENT_CONSENT_REQUIRED',
    );
    expect(denied.statusCode).toBe(403);

    const granted = await consultations.grantRecordingConsent(patientUser.id, consultationId);
    expect(granted.recordingConsentGiven).toBe(true);
    expect(deps.state.consultations.get(consultationId)!.recordingConsentAt).toEqual(clock.now);
    expect(
      deps.state.auditEntries.some((entry) => entry.action === 'RECORDING_CONSENT_GIVEN'),
    ).toBe(true);
  });
});

describe('chat', () => {
  it('persists messages encrypted at rest and lists them decrypted for participants only', async () => {
    const { doctorUser, patientUser, consultationId } = await startedConsultation();

    await consultations.postMessage(patientUser.id, consultationId, 'Nina maumivu ya kichwa');
    await consultations.postMessage(doctorUser.id, consultationId, 'Pole sana — tangu lini?');

    const stored = [...deps.state.consultationMessages.values()];
    expect(stored).toHaveLength(2);
    for (const message of stored) {
      expect(message.encryptedBody).not.toContain('maumivu');
      expect(message.encryptedBody).not.toContain('Pole sana');
    }

    const history = await consultations.listMessages(patientUser.id, consultationId, {
      page: 1,
      pageSize: 10,
    });
    expect(history.items.map((m) => m.body)).toEqual([
      'Nina maumivu ya kichwa',
      'Pole sana — tangu lini?',
    ]);

    const stranger = deps.seedPatient({ phone: '+255754999112' });
    await expectApiError(
      consultations.listMessages(stranger.user.id, consultationId, { page: 1, pageSize: 10 }),
      'CONSULTATION_NOT_FOUND',
    );
  });
});

describe('medical record access rules', () => {
  async function completedWithRecord() {
    const ctx = await startedConsultation();
    await consultations.updateNotes(ctx.doctorUser.id, ctx.consultationId, FULL_NOTES);
    const completed = await consultations.complete(ctx.doctorUser.id, ctx.consultationId);
    const record = [...deps.state.medicalRecords.values()][0]!;
    return { ...ctx, completed, record };
  }

  it('patient owner and authoring doctor can read decrypted content', async () => {
    const { patientUser, doctorUser, record } = await completedWithRecord();
    const asPatient = await medicalRecords.getById(patientUser.id, record.id);
    expect((asPatient.content as { notes: unknown }).notes).toEqual(FULL_NOTES);
    const asDoctor = await medicalRecords.getById(doctorUser.id, record.id);
    expect(asDoctor.id).toBe(record.id);
    // Both reads audited with the entity id.
    const audits = deps.state.auditEntries.filter(
      (entry) => entry.action === 'MEDICAL_RECORD_VIEWED' && entry.resourceId === record.id,
    );
    expect(audits).toHaveLength(2);
  });

  it('an unrelated doctor is denied unless they have an active appointment with the patient', async () => {
    const { patient, record } = await completedWithRecord();
    const other = deps.seedDoctor({}, { verificationStatus: 'APPROVED' });

    await expectApiError(medicalRecords.getById(other.user.id, record.id), 'RECORD_NOT_FOUND');

    // Give the other doctor an active CONFIRMED appointment with the patient.
    await deps.appointments.create({
      patientId: patient.id,
      doctorId: other.doctor.id,
      type: 'VIDEO',
      status: 'CONFIRMED',
      scheduledAt: new Date('2026-07-22T06:00:00.000Z'),
      durationMinutes: 30,
      reason: 'follow-up',
      paymentIntent: 'NHIF',
    });
    const allowed = await medicalRecords.getById(other.user.id, record.id);
    expect(allowed.id).toBe(record.id);
  });

  it('lists the patient’s own records without decrypting content', async () => {
    const { patientUser } = await completedWithRecord();
    const list = await medicalRecords.listMine(patientUser.id, { page: 1, pageSize: 10 });
    expect(list.total).toBe(1);
    expect(list.items[0]).not.toHaveProperty('content');
  });
});
