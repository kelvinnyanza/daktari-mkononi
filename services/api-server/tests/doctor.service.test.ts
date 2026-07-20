import { Buffer } from 'node:buffer';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES } from '@daktari/storage';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import { DoctorService, type UploadedFile } from '../src/modules/doctors/doctor.service.js';
import { ApiError } from '../src/lib/errors.js';

const PDF = Buffer.from('%PDF-1.7 fake certificate');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);

const pdfUpload = (fieldName: string, fileName = 'doc.pdf'): UploadedFile => ({
  fieldName,
  fileName,
  mimeType: 'application/pdf',
  data: PDF,
});

let deps: FakeDeps;
let clock: { now: Date };
let service: DoctorService;

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
  clock = { now: new Date('2026-07-16T09:00:00.000Z') };
  service = new DoctorService(deps, () => clock.now);
});

async function uploadRequiredSet(userId: string): Promise<void> {
  await service.uploadDocument(userId, pdfUpload('tmc_cert'));
  await service.uploadDocument(userId, pdfUpload('degree'));
  await service.uploadDocument(userId, pdfUpload('id'));
}

describe('document upload + automatic DOCUMENTS_SUBMITTED transition', () => {
  it('stays PENDING until the required set (tmc_cert + degree + id) is complete', async () => {
    const { user, doctor } = deps.seedDoctor();
    await service.uploadDocument(user.id, pdfUpload('tmc_cert'));
    await service.uploadDocument(user.id, pdfUpload('degree'));
    expect(deps.state.doctors.get(doctor.id)!.verificationStatus).toBe('PENDING');

    const result = await service.uploadDocument(user.id, pdfUpload('id'));
    expect(result.verificationStatus).toBe('DOCUMENTS_SUBMITTED');
    // The transition is audited.
    expect(
      deps.state.auditEntries.filter((entry) => entry.action === 'DOCTOR_VERIFICATION_TRANSITION'),
    ).toHaveLength(1);
  });

  it('police_clearance is optional — not needed for the transition', async () => {
    const { user, doctor } = deps.seedDoctor();
    await uploadRequiredSet(user.id);
    expect(deps.state.doctors.get(doctor.id)!.verificationStatus).toBe('DOCUMENTS_SUBMITTED');
  });

  it('stores the file under a per-doctor key via the storage port', async () => {
    const { user, doctor } = deps.seedDoctor();
    await service.uploadDocument(user.id, pdfUpload('tmc_cert', 'my cert.pdf'));
    expect(deps.storage.blobs.has(`doctor-docs/${doctor.id}/tmc_cert.pdf`)).toBe(true);
  });

  it('rejects a fake extension by magic bytes (exe renamed to pdf)', async () => {
    const { user } = deps.seedDoctor();
    await expectApiError(
      service.uploadDocument(user.id, {
        fieldName: 'tmc_cert',
        fileName: 'cert.pdf',
        mimeType: 'application/pdf',
        data: EXE,
      }),
      'CONTENT_MISMATCH',
    );
  });

  it('rejects oversize uploads and double extensions', async () => {
    const { user } = deps.seedDoctor();
    await expectApiError(
      service.uploadDocument(user.id, {
        fieldName: 'degree',
        fileName: 'degree.pdf',
        mimeType: 'application/pdf',
        data: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(MAX_UPLOAD_BYTES)]),
      }),
      'FILE_TOO_LARGE',
    );
    await expectApiError(
      service.uploadDocument(user.id, {
        fieldName: 'degree',
        fileName: 'degree.pdf.exe',
        mimeType: 'application/pdf',
        data: PDF,
      }),
      'DOUBLE_EXTENSION',
    );
  });

  it('rejects unknown document fields', async () => {
    const { user } = deps.seedDoctor();
    await expectApiError(
      service.uploadDocument(user.id, pdfUpload('selfie')),
      'UNKNOWN_DOCUMENT_FIELD',
    );
  });

  it('re-upload replaces the document and resets its review state', async () => {
    const { user, doctor } = deps.seedDoctor();
    await uploadRequiredSet(user.id);
    await deps.doctorDocuments.setReview(doctor.id, 'TMC_CERTIFICATE', {
      status: 'REJECTED',
      notes: 'blurry scan',
      reviewedByUserId: 'admin',
    });
    await service.uploadDocument(user.id, pdfUpload('tmc_cert', 'better-scan.pdf'));
    const documents = await deps.doctorDocuments.listByDoctor(doctor.id);
    const tmc = documents.find((doc) => doc.type === 'TMC_CERTIFICATE')!;
    expect(tmc.reviewStatus).toBe('PENDING');
    expect(tmc.fileName).toBe('better-scan.pdf');
  });
});

describe('admin verification workflow', () => {
  const ADMIN = 'admin-user-id';

  async function submittedDoctor(): Promise<{ userId: string; doctorId: string }> {
    const { user, doctor } = deps.seedDoctor();
    await uploadRequiredSet(user.id);
    return { userId: user.id, doctorId: doctor.id };
  }

  async function approveAll(doctorId: string): Promise<void> {
    for (const type of ['TMC_CERTIFICATE', 'MEDICAL_DEGREE', 'NATIONAL_ID'] as const) {
      await deps.doctorDocuments.setReview(doctorId, type, {
        status: 'APPROVED',
        notes: null,
        reviewedByUserId: ADMIN,
      });
    }
  }

  it('claim moves DOCUMENTS_SUBMITTED → UNDER_REVIEW and records the reviewer', async () => {
    const { doctorId } = await submittedDoctor();
    const result = await service.adminClaim(ADMIN, doctorId);
    expect(result.verificationStatus).toBe('UNDER_REVIEW');
    expect(deps.state.doctors.get(doctorId)!.claimedByUserId).toBe(ADMIN);
  });

  it('claiming an unclaimed PENDING doctor is an illegal transition (409)', async () => {
    const { doctor } = deps.seedDoctor(); // still PENDING, no documents
    const error = await expectApiError(service.adminClaim(ADMIN, doctor.id), 'INVALID_STATE_TRANSITION');
    expect(error.statusCode).toBe(409);
  });

  it('approval requires every required document individually APPROVED', async () => {
    const { doctorId } = await submittedDoctor();
    await service.adminClaim(ADMIN, doctorId);

    await expectApiError(
      service.adminDecide(ADMIN, doctorId, { decision: 'APPROVED', perDocument: [] }),
      'REQUIRED_DOCUMENTS_NOT_APPROVED',
    );

    // Approving via perDocument in the same decision call works.
    const result = await service.adminDecide(ADMIN, doctorId, {
      decision: 'APPROVED',
      perDocument: [
        { document: 'tmc_cert', status: 'APPROVED' },
        { document: 'degree', status: 'APPROVED' },
        { document: 'id', status: 'APPROVED' },
      ],
    });
    expect(result.verificationStatus).toBe('APPROVED');
    expect(deps.state.doctors.get(doctorId)!.verifiedByUserId).toBe(ADMIN);
    expect(deps.state.doctors.get(doctorId)!.verifiedAt).toEqual(clock.now);
    // The doctor is notified by SMS.
    expect(deps.sms.sent.at(-1)!.body).toMatch(/imethibitishwa|verified/);
  });

  it('rejection records notes, notifies the doctor, and allows re-submission', async () => {
    const { userId, doctorId } = await submittedDoctor();
    await service.adminClaim(ADMIN, doctorId);
    const result = await service.adminDecide(ADMIN, doctorId, {
      decision: 'REJECTED',
      notes: 'TMC certificate does not match the registration number',
      perDocument: [{ document: 'tmc_cert', status: 'REJECTED', notes: 'mismatch' }],
    });
    expect(result.verificationStatus).toBe('REJECTED');
    expect(deps.sms.sent.at(-1)!.body).toMatch(/haukukubaliwa|not approved/);

    // Re-uploading the rejected document re-enters the queue automatically.
    const reupload = await service.uploadDocument(userId, pdfUpload('tmc_cert'));
    expect(reupload.verificationStatus).toBe('DOCUMENTS_SUBMITTED');
  });

  it('suspend: APPROVED → SUSPENDED with reason; doctor disappears from directory and booking', async () => {
    const { doctorId } = await submittedDoctor();
    await service.adminClaim(ADMIN, doctorId);
    await approveAll(doctorId);
    await service.adminDecide(ADMIN, doctorId, { decision: 'APPROVED', perDocument: [] });

    const before = await service.directory({ page: 1, pageSize: 20 });
    expect(before.total).toBe(1);

    const result = await service.adminSuspend(ADMIN, doctorId, 'TMC licence suspended pending investigation');
    expect(result.verificationStatus).toBe('SUSPENDED');
    expect(deps.sms.sent.at(-1)!.body).toMatch(/imesimamishwa|suspended/);

    const after = await service.directory({ page: 1, pageSize: 20 });
    expect(after.total).toBe(0);
    await expectApiError(service.publicProfile(doctorId), 'DOCTOR_NOT_FOUND');
    await expectApiError(service.availability(doctorId, '2026-07-20'), 'DOCTOR_NOT_FOUND');
  });

  it('suspending a non-approved doctor is illegal (409)', async () => {
    const { doctorId } = await submittedDoctor();
    await expectApiError(
      service.adminSuspend(ADMIN, doctorId, 'reason long enough here'),
      'INVALID_STATE_TRANSITION',
    );
  });

  it('the verification queue lists DOCUMENTS_SUBMITTED and UNDER_REVIEW doctors', async () => {
    const first = await submittedDoctor();
    await submittedDoctor();
    deps.seedDoctor(); // PENDING — not in the queue
    await service.adminClaim(ADMIN, first.doctorId);

    const queue = await service.adminQueue(1, 20);
    expect(queue.total).toBe(2);
    const statuses = queue.items.map((item) => item.verificationStatus).sort();
    expect(statuses).toEqual(['DOCUMENTS_SUBMITTED', 'UNDER_REVIEW']);
  });
});

describe('public directory', () => {
  it('lists only APPROVED doctors and applies the filters', async () => {
    deps.seedDoctor({}, { verificationStatus: 'APPROVED', specialty: 'CARDIOLOGY', region: 'MWANZA', acceptsNhif: true, consultationFeeTzs: 30_000, averageRating: 4.5 });
    deps.seedDoctor({}, { verificationStatus: 'APPROVED', specialty: 'GENERAL_PRACTICE', region: 'DAR_ES_SALAAM', acceptsNhif: false, consultationFeeTzs: 15_000, averageRating: 4.9 });
    deps.seedDoctor({}, { verificationStatus: 'PENDING', specialty: 'CARDIOLOGY' });
    deps.seedDoctor({}, { verificationStatus: 'SUSPENDED', specialty: 'CARDIOLOGY' });

    const all = await service.directory({ page: 1, pageSize: 20 });
    expect(all.total).toBe(2);
    // Sorted by rating, best first.
    expect(all.items[0]!.specialty).toBe('GENERAL_PRACTICE');

    const nhifCardiology = await service.directory({
      page: 1,
      pageSize: 20,
      specialization: 'CARDIOLOGY',
      acceptsNhif: true,
      region: 'MWANZA',
    });
    expect(nhifCardiology.total).toBe(1);

    const cheap = await service.directory({ page: 1, pageSize: 20, maxFee: 20_000 });
    expect(cheap.total).toBe(1);
    expect(cheap.items[0]!.consultationFeeTzs).toBe(15_000);
  });

  it('public profile never exposes phone, documents, or earnings', async () => {
    const { doctor } = deps.seedDoctor({}, { verificationStatus: 'APPROVED' });
    const profile = await service.publicProfile(doctor.id);
    expect(profile).not.toHaveProperty('phone');
    expect(profile).not.toHaveProperty('documents');
    expect(profile).not.toHaveProperty('tmcRegistrationNumber');
    expect(profile).not.toHaveProperty('verifiedByUserId');
    expect(profile.fullName).toBeTruthy();
    expect(profile.consultationFeeTzs).toBe(20_000);
  });
});

describe('schedules + availability through the service', () => {
  it('replaces the weekly schedule and computes availability minus bookings', async () => {
    const { user, doctor } = deps.seedDoctor({}, { verificationStatus: 'APPROVED' });
    await service.setOwnSchedule(user.id, {
      slots: [
        {
          dayOfWeek: 1, // Monday
          startTime: '09:00',
          endTime: '12:00',
          breaks: [{ startTime: '10:30', endTime: '11:00' }],
          slotDurationMinutes: 30,
        },
      ],
    });

    // A confirmed booking at 09:30 EAT (06:30 UTC) blocks that slot.
    await deps.appointments.create({
      patientId: 'p1',
      doctorId: doctor.id,
      type: 'VIDEO',
      status: 'CONFIRMED',
      scheduledAt: new Date('2026-07-20T06:30:00.000Z'),
      durationMinutes: 30,
      reason: 'x',
      paymentIntent: 'MOBILE_MONEY',
    });
    // A CANCELLED one at 09:00 EAT must NOT block.
    await deps.appointments.create({
      patientId: 'p2',
      doctorId: doctor.id,
      type: 'VIDEO',
      status: 'CANCELLED',
      scheduledAt: new Date('2026-07-20T06:00:00.000Z'),
      durationMinutes: 30,
      reason: 'x',
      paymentIntent: 'MOBILE_MONEY',
    });

    const { slots } = await service.availability(doctor.id, '2026-07-20');
    expect(slots.map((slot) => slot.startEat)).toEqual(['09:00', '10:00', '11:00', '11:30']);
  });
});
