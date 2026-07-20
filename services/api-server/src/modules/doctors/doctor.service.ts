import type { Buffer } from 'node:buffer';
import type { Doctor, DoctorDocumentType, DoctorWithUser, VerificationUpdate } from '@daktari/db';
import {
  DOCUMENT_FIELD_TO_TYPE,
  REQUIRED_DOCUMENT_TYPES,
  type DoctorDirectoryQuery,
  type DoctorDocumentField,
  type DoctorVerificationDecisionInput,
  type SetDoctorScheduleInput,
} from '@daktari/schemas';
import { UploadValidationError, validateUpload, type StoragePort } from '@daktari/storage';
import { ApiError, msg } from '../../lib/errors.js';
import { eatDayOfWeek, eatDayRangeUtc } from '../../lib/eat-time.js';
import type {
  AppointmentRepoPort,
  AuditLogPort,
  DoctorDocumentRepoPort,
  DoctorRepoPort,
  ScheduleRepoPort,
} from '../../lib/ports.js';
import type { SmsPort } from '@daktari/notifications';
import { computeAvailability, type AvailabilitySlot } from './availability.js';
import { findVerificationTransition, type VerificationEvent } from './verification.machine.js';

/** Admin document-viewer links expire quickly — long enough to read a scan. */
const DOCUMENT_URL_TTL_SECONDS = 15 * 60;

const DOCTOR_NOT_FOUND = (): ApiError =>
  new ApiError(404, 'DOCTOR_NOT_FOUND', msg('Daktari hajapatikana', 'Doctor not found'));

const INVALID_TRANSITION = (from: string, event: string): ApiError =>
  new ApiError(
    409,
    'INVALID_STATE_TRANSITION',
    msg('Hatua hii hairuhusiwi kwa hali ya sasa', 'This action is not allowed in the current state'),
    { from, event },
  );

const TYPE_TO_FIELD: Record<string, DoctorDocumentField> = Object.fromEntries(
  Object.entries(DOCUMENT_FIELD_TO_TYPE).map(([field, type]) => [type, field as DoctorDocumentField]),
);

export interface UploadedFile {
  fieldName: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
}

export interface DoctorServiceDeps {
  doctors: DoctorRepoPort;
  doctorDocuments: DoctorDocumentRepoPort;
  schedules: ScheduleRepoPort;
  appointments: AppointmentRepoPort;
  storage: StoragePort;
  sms: SmsPort;
  auditLogs: AuditLogPort;
}

export class DoctorService {
  constructor(
    private readonly deps: DoctorServiceDeps,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async ownDoctor(userId: string): Promise<Doctor> {
    const doctor = await this.deps.doctors.findByUserId(userId);
    if (!doctor) throw DOCTOR_NOT_FOUND();
    return doctor;
  }

  // ── Verification state machine executor ───────────────────────────────────

  /**
   * Single choke point for every verification transition: consult the table,
   * apply with a status guard (concurrent transitions answer 409 too), write
   * the AuditLog row, notify the doctor when the table says so.
   */
  private async applyVerificationTransition(
    doctor: Doctor,
    event: VerificationEvent,
    actorUserId: string | null,
    update: Omit<VerificationUpdate, 'status'>,
  ): Promise<Doctor> {
    const transition = findVerificationTransition(event, doctor.verificationStatus);
    if (!transition) throw INVALID_TRANSITION(doctor.verificationStatus, event);

    const applied = await this.deps.doctors.transitionVerification(doctor.id, transition.from, {
      ...update,
      status: transition.to,
    });
    if (!applied) throw INVALID_TRANSITION(doctor.verificationStatus, event);

    await this.deps.auditLogs.append({
      actorUserId,
      action: 'DOCTOR_VERIFICATION_TRANSITION',
      resourceType: 'Doctor',
      resourceId: doctor.id,
      ipAddress: null,
      userAgent: null,
      metadata: { event, from: transition.from, to: transition.to },
    });

    if (transition.sideEffects.includes('sms-doctor')) {
      await this.notifyDoctor(doctor.id, transition.to, update);
    }
    return applied;
  }

  private async notifyDoctor(
    doctorId: string,
    status: Doctor['verificationStatus'],
    update: Omit<VerificationUpdate, 'status'>,
  ): Promise<void> {
    const doctor = await this.deps.doctors.findByIdWithUser(doctorId);
    if (!doctor) return;
    const english = doctor.user.language === 'EN';
    let body: string;
    switch (status) {
      case 'APPROVED':
        body = english
          ? 'Daktari Mkononi: congratulations! Your account has been verified. You can now set your schedule and receive patients.'
          : 'Daktari Mkononi: hongera! Akaunti yako imethibitishwa. Sasa unaweza kuweka ratiba yako na kupokea wagonjwa.';
        break;
      case 'REJECTED':
        body = english
          ? `Daktari Mkononi: your verification was not approved. Reason: ${update.rejectionReason ?? '-'}. You may re-upload corrected documents.`
          : `Daktari Mkononi: uthibitisho wako haukukubaliwa. Sababu: ${update.rejectionReason ?? '-'}. Unaweza kupakia tena nyaraka zilizosahihishwa.`;
        break;
      case 'SUSPENDED':
        body = english
          ? `Daktari Mkononi: your account has been suspended. Reason: ${update.suspensionReason ?? '-'}. Contact support for assistance.`
          : `Daktari Mkononi: akaunti yako imesimamishwa. Sababu: ${update.suspensionReason ?? '-'}. Wasiliana na msaada kwa usaidizi.`;
        break;
      default:
        return;
    }
    await this.deps.sms.sendSms(doctor.user.phone, body);
  }

  // ── Documents ──────────────────────────────────────────────────────────────

  async uploadDocument(
    userId: string,
    file: UploadedFile,
  ): Promise<{ document: { type: string; reviewStatus: string }; verificationStatus: string }> {
    const doctor = await this.ownDoctor(userId);

    const field = (Object.keys(DOCUMENT_FIELD_TO_TYPE) as DoctorDocumentField[]).find(
      (name) => name === file.fieldName,
    );
    if (field === undefined) {
      throw new ApiError(
        400,
        'UNKNOWN_DOCUMENT_FIELD',
        msg(
          'Aina ya nyaraka si sahihi — tumia tmc_cert, degree, id au police_clearance',
          'Unknown document field — use tmc_cert, degree, id or police_clearance',
        ),
      );
    }

    let validated;
    try {
      validated = validateUpload({
        fileName: file.fileName,
        mimeType: file.mimeType,
        data: file.data,
      });
    } catch (error) {
      if (error instanceof UploadValidationError) {
        throw new ApiError(
          400,
          error.code,
          msg('Faili halikubaliki — angalia aina na ukubwa wake', 'File rejected — check its type and size'),
          { detail: error.message },
        );
      }
      throw error;
    }

    const type = DOCUMENT_FIELD_TO_TYPE[field] as DoctorDocumentType;
    const key = `doctor-docs/${doctor.id}/${field}.${validated.extension}`;
    await this.deps.storage.put(key, file.data, validated.contentType);
    const document = await this.deps.doctorDocuments.upsertForType({
      doctorId: doctor.id,
      type,
      fileKey: key,
      fileName: file.fileName,
      mimeType: validated.contentType,
    });

    // Automatic transition once the required set (tmc_cert + degree + id) is present.
    let status = doctor.verificationStatus;
    if (status === 'PENDING' || status === 'REJECTED') {
      const documents = await this.deps.doctorDocuments.listByDoctor(doctor.id);
      const present = new Set(documents.map((doc) => doc.type));
      if (REQUIRED_DOCUMENT_TYPES.every((required) => present.has(required))) {
        const applied = await this.applyVerificationTransition(doctor, 'DOCUMENTS_COMPLETE', userId, {
          rejectionReason: null,
        });
        status = applied.verificationStatus;
      }
    }

    return {
      document: { type: document.type, reviewStatus: document.reviewStatus },
      verificationStatus: status,
    };
  }

  async getVerification(userId: string): Promise<{
    verificationStatus: string;
    rejectionReason: string | null;
    suspensionReason: string | null;
    documents: Array<{
      document: DoctorDocumentField | null;
      type: string;
      fileName: string;
      reviewStatus: string;
      reviewNotes: string | null;
      uploadedAt: Date;
    }>;
    missingRequired: DoctorDocumentField[];
  }> {
    const doctor = await this.ownDoctor(userId);
    const documents = await this.deps.doctorDocuments.listByDoctor(doctor.id);
    const present = new Set(documents.map((doc) => doc.type));
    return {
      verificationStatus: doctor.verificationStatus,
      rejectionReason: doctor.rejectionReason,
      suspensionReason: doctor.suspensionReason,
      documents: documents.map((doc) => ({
        document: TYPE_TO_FIELD[doc.type] ?? null,
        type: doc.type,
        fileName: doc.fileName,
        reviewStatus: doc.reviewStatus,
        reviewNotes: doc.reviewNotes,
        uploadedAt: doc.uploadedAt,
      })),
      missingRequired: REQUIRED_DOCUMENT_TYPES.filter((type) => !present.has(type)).map(
        (type) => TYPE_TO_FIELD[type]!,
      ),
    };
  }

  // ── Admin verification workflow ────────────────────────────────────────────

  /**
   * Admin review detail (Phase 11 portal): the doctor's credentials plus every
   * uploaded document with a short-lived signed URL from the storage port, so
   * the reviewer can open the scan without the app proxying file bytes.
   */
  async adminDoctorDetail(doctorId: string): Promise<{
    doctorId: string;
    fullName: string;
    phone: string;
    tmcRegistrationNumber: string;
    specialty: string;
    subSpecialty: string | null;
    yearsOfExperience: number;
    consultationFeeTzs: number;
    region: string | null;
    verificationStatus: string;
    rejectionReason: string | null;
    suspensionReason: string | null;
    claimedByUserId: string | null;
    documents: Array<{
      document: DoctorDocumentField | null;
      type: string;
      fileName: string;
      reviewStatus: string;
      reviewNotes: string | null;
      uploadedAt: Date;
      /** Signed, expiring URL for the reviewer's document viewer. */
      url: string;
    }>;
    missingRequired: DoctorDocumentField[];
  }> {
    const doctor = await this.deps.doctors.findByIdWithUser(doctorId);
    if (!doctor) throw DOCTOR_NOT_FOUND();
    const documents = await this.deps.doctorDocuments.listByDoctor(doctor.id);
    const present = new Set(documents.map((doc) => doc.type));

    const withUrls = await Promise.all(
      documents.map(async (doc) => ({
        document: TYPE_TO_FIELD[doc.type] ?? null,
        type: doc.type,
        fileName: doc.fileName,
        reviewStatus: doc.reviewStatus,
        reviewNotes: doc.reviewNotes,
        uploadedAt: doc.uploadedAt,
        url: await this.deps.storage.getSignedUrl(doc.fileKey, DOCUMENT_URL_TTL_SECONDS),
      })),
    );

    return {
      doctorId: doctor.id,
      fullName: doctor.user.fullName,
      phone: doctor.user.phone,
      tmcRegistrationNumber: doctor.tmcRegistrationNumber,
      specialty: doctor.specialty,
      subSpecialty: doctor.subSpecialty,
      yearsOfExperience: doctor.yearsOfExperience,
      consultationFeeTzs: doctor.consultationFeeTzs,
      region: doctor.region,
      verificationStatus: doctor.verificationStatus,
      rejectionReason: doctor.rejectionReason,
      suspensionReason: doctor.suspensionReason,
      claimedByUserId: doctor.claimedByUserId,
      documents: withUrls,
      missingRequired: REQUIRED_DOCUMENT_TYPES.filter((type) => !present.has(type)).map(
        (type) => TYPE_TO_FIELD[type]!,
      ),
    };
  }

  /** Admin doctor list — every status (the public directory is APPROVED-only). */
  async adminListDoctors(query: {
    status?: Doctor['verificationStatus'];
    page: number;
    pageSize: number;
  }): Promise<{
    items: Array<{
      doctorId: string;
      fullName: string;
      phone: string;
      specialty: string;
      tmcRegistrationNumber: string;
      verificationStatus: string;
      averageRating: number;
      totalConsultations: number;
    }>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const { items, total } = await this.deps.doctors.adminList({
      ...(query.status !== undefined ? { status: query.status } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: items.map((doctor: DoctorWithUser) => ({
        doctorId: doctor.id,
        fullName: doctor.user.fullName,
        phone: doctor.user.phone,
        specialty: doctor.specialty,
        tmcRegistrationNumber: doctor.tmcRegistrationNumber,
        verificationStatus: doctor.verificationStatus,
        averageRating: doctor.averageRating,
        totalConsultations: doctor.totalConsultations,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async adminQueue(page: number, pageSize: number): Promise<{
    items: Array<{
      doctorId: string;
      fullName: string;
      specialty: string;
      verificationStatus: string;
      claimedByUserId: string | null;
      updatedAt: Date;
    }>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const { items, total } = await this.deps.doctors.listVerificationQueue(page, pageSize);
    return {
      items: items.map((doctor: DoctorWithUser) => ({
        doctorId: doctor.id,
        fullName: doctor.user.fullName,
        specialty: doctor.specialty,
        verificationStatus: doctor.verificationStatus,
        claimedByUserId: doctor.claimedByUserId,
        updatedAt: doctor.updatedAt,
      })),
      page,
      pageSize,
      total,
    };
  }

  async adminClaim(adminUserId: string, doctorId: string): Promise<{ verificationStatus: string }> {
    const doctor = await this.deps.doctors.findById(doctorId);
    if (!doctor) throw DOCTOR_NOT_FOUND();
    const applied = await this.applyVerificationTransition(doctor, 'CLAIM', adminUserId, {
      claimedByUserId: adminUserId,
    });
    return { verificationStatus: applied.verificationStatus };
  }

  async adminDecide(
    adminUserId: string,
    doctorId: string,
    input: DoctorVerificationDecisionInput,
  ): Promise<{ verificationStatus: string }> {
    const doctor = await this.deps.doctors.findById(doctorId);
    if (!doctor) throw DOCTOR_NOT_FOUND();

    // Per-document reviews land first so the APPROVE guard sees them.
    for (const review of input.perDocument) {
      await this.deps.doctorDocuments.setReview(
        doctorId,
        DOCUMENT_FIELD_TO_TYPE[review.document] as DoctorDocumentType,
        {
          status: review.status,
          notes: review.notes ?? null,
          reviewedByUserId: adminUserId,
        },
      );
    }

    if (input.decision === 'APPROVED') {
      const documents = await this.deps.doctorDocuments.listByDoctor(doctorId);
      const approved = new Set(
        documents.filter((doc) => doc.reviewStatus === 'APPROVED').map((doc) => doc.type),
      );
      const missing = REQUIRED_DOCUMENT_TYPES.filter((type) => !approved.has(type));
      if (missing.length > 0) {
        throw new ApiError(
          409,
          'REQUIRED_DOCUMENTS_NOT_APPROVED',
          msg(
            'Nyaraka zote za lazima lazima zithibitishwe kabla ya kuidhinisha',
            'All required documents must be individually approved before approval',
          ),
          { missing: missing.map((type) => TYPE_TO_FIELD[type]) },
        );
      }
      const applied = await this.applyVerificationTransition(doctor, 'APPROVE', adminUserId, {
        verifiedByUserId: adminUserId,
        verifiedAt: this.now(),
        rejectionReason: null,
      });
      return { verificationStatus: applied.verificationStatus };
    }

    // REJECTED — schema guarantees notes are present.
    const applied = await this.applyVerificationTransition(doctor, 'REJECT', adminUserId, {
      rejectionReason: input.notes ?? null,
      claimedByUserId: null,
    });
    return { verificationStatus: applied.verificationStatus };
  }

  async adminSuspend(
    adminUserId: string,
    doctorId: string,
    reason: string,
  ): Promise<{ verificationStatus: string }> {
    const doctor = await this.deps.doctors.findById(doctorId);
    if (!doctor) throw DOCTOR_NOT_FOUND();
    const applied = await this.applyVerificationTransition(doctor, 'SUSPEND', adminUserId, {
      suspensionReason: reason,
    });
    return { verificationStatus: applied.verificationStatus };
  }

  // ── Public directory ───────────────────────────────────────────────────────

  private toPublicProfile(doctor: DoctorWithUser): Record<string, unknown> {
    // Public shape: no phone, no documents, no earnings, no internal reviewer ids.
    return {
      id: doctor.id,
      fullName: doctor.user.fullName,
      specialty: doctor.specialty,
      subSpecialty: doctor.subSpecialty,
      yearsOfExperience: doctor.yearsOfExperience,
      consultationFeeTzs: doctor.consultationFeeTzs,
      bio: doctor.bio,
      languages: doctor.languages,
      region: doctor.region,
      acceptsNhif: doctor.acceptsNhif,
      averageRating: doctor.averageRating,
      totalConsultations: doctor.totalConsultations,
      isAvailable: doctor.isAvailable,
      // Mobile booking offers IN_PERSON only for hospital-affiliated doctors.
      hospitalAffiliated: doctor.hospitalId !== null,
    };
  }

  async directory(query: DoctorDirectoryQuery): Promise<{
    items: Array<Record<string, unknown>>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const { items, total } = await this.deps.doctors.listDirectory({
      ...(query.specialization !== undefined ? { specialty: query.specialization } : {}),
      ...(query.region !== undefined ? { region: query.region } : {}),
      ...(query.language !== undefined ? { language: query.language } : {}),
      ...(query.acceptsNhif !== undefined ? { acceptsNhif: query.acceptsNhif } : {}),
      ...(query.maxFee !== undefined ? { maxFeeTzs: query.maxFee } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: items.map((doctor) => this.toPublicProfile(doctor)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Public profile — only APPROVED doctors exist to the outside world. */
  async publicProfile(doctorId: string): Promise<Record<string, unknown>> {
    const doctor = await this.deps.doctors.findByIdWithUser(doctorId);
    if (!doctor || doctor.verificationStatus !== 'APPROVED') throw DOCTOR_NOT_FOUND();
    return this.toPublicProfile(doctor);
  }

  // ── Weekly schedule + availability ─────────────────────────────────────────

  async getOwnSchedule(userId: string): Promise<{
    slots: Array<{
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      breaks: Array<{ startTime: string; endTime: string }>;
      slotDurationMinutes: number;
    }>;
  }> {
    const doctor = await this.ownDoctor(userId);
    const schedules = await this.deps.schedules.listForDoctor(doctor.id);
    return {
      slots: schedules.map((slot) => ({
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
        breaks: (slot.breaks ?? []) as Array<{ startTime: string; endTime: string }>,
        slotDurationMinutes: slot.slotDurationMinutes,
      })),
    };
  }

  async setOwnSchedule(userId: string, input: SetDoctorScheduleInput): ReturnType<DoctorService['getOwnSchedule']> {
    const doctor = await this.ownDoctor(userId);
    await this.deps.schedules.replaceForDoctor(
      doctor.id,
      input.slots.map((slot) => ({
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
        breaks: slot.breaks,
        slotDurationMinutes: slot.slotDurationMinutes,
      })),
    );
    return this.getOwnSchedule(userId);
  }

  /**
   * Bookable slots for one EAT calendar date: weekday schedule minus breaks
   * minus slot-holding appointments, past slots excluded. Suspended/unverified
   * doctors are invisible here, same as the directory.
   */
  async availability(doctorId: string, date: string): Promise<{ date: string; slots: AvailabilitySlot[] }> {
    const doctor = await this.deps.doctors.findById(doctorId);
    if (!doctor || doctor.verificationStatus !== 'APPROVED') throw DOCTOR_NOT_FOUND();

    const weekday = eatDayOfWeek(date);
    const { start, end } = eatDayRangeUtc(date);
    const [schedules, appointments] = await Promise.all([
      this.deps.schedules.listForDoctor(doctor.id),
      this.deps.appointments.listActiveForDoctorBetween(doctor.id, start, end),
    ]);

    const slots = computeAvailability({
      date,
      windows: schedules
        .filter((slot) => slot.dayOfWeek === weekday)
        .map((slot) => ({
          startTime: slot.startTime,
          endTime: slot.endTime,
          breaks: (slot.breaks ?? []) as Array<{ startTime: string; endTime: string }>,
          slotDurationMinutes: slot.slotDurationMinutes,
        })),
      booked: appointments.map((appointment) => ({
        scheduledAt: appointment.scheduledAt,
        durationMinutes: appointment.durationMinutes,
      })),
      now: this.now(),
    });

    return { date, slots };
  }
}
