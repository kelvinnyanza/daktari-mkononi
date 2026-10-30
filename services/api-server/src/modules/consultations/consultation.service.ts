import type { Consultation, Diagnosis } from '@daktari/db';
import { decryptHealthData, encryptHealthData } from '@daktari/encryption';
import type {
  AddDiagnosisInput as AddDiagnosisSchemaInput,
  ClinicalNotes,
  ConsultationNotesInput,
  ReferralInput,
} from '@daktari/schemas';
import type { VideoPort } from '@daktari/video';
import { ApiError, msg } from '../../lib/errors.js';
import type { PubSubPort } from '../../lib/pubsub.js';
import type {
  AppointmentRepoPort,
  AuditLogPort,
  ConsultationMessageRepoPort,
  ConsultationRepoPort,
  DoctorRepoPort,
  PatientRepoPort,
  ScreeningRepoPort,
} from '../../lib/ports.js';
import { toAgeBand } from '../ai/prompts.js';
import { findAppointmentTransition } from '../appointments/appointment.machine.js';
import type { MedicalRecordService } from '../medical-records/medical-record.service.js';

const MEETING_TOKEN_TTL_SECONDS = 2 * 60 * 60;

const CONSULTATION_NOT_FOUND = (): ApiError =>
  new ApiError(404, 'CONSULTATION_NOT_FOUND', msg('Ushauri haujapatikana', 'Consultation not found'));

const INVALID_TRANSITION = (from: string, event: string): ApiError =>
  new ApiError(
    409,
    'INVALID_STATE_TRANSITION',
    msg('Hatua hii hairuhusiwi kwa hali ya sasa', 'This action is not allowed in the current state'),
    { from, event },
  );

export const consultationChannel = (consultationId: string): string =>
  `consultation:${consultationId}`;

export interface ConsultationParticipants {
  patientUserId: string;
  doctorUserId: string;
}

export interface ConsultationView {
  id: string;
  appointmentId: string;
  status: Consultation['status'];
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  endReason: string | null;
  videoRoomUrl: string | null;
  recordingConsentGiven: boolean;
  referredToInPerson: boolean;
  referralNotes: string | null;
  followUpRequired: boolean;
  followUpDate: Date | null;
  diagnoses: Array<{ id: string; icd10Code: string; description: string; type: Diagnosis['type'] }>;
  /** Decrypted clinical notes — doctor-side reads only. */
  notes?: ClinicalNotes;
}

export interface ConsultationServiceDeps {
  consultations: ConsultationRepoPort;
  consultationMessages: ConsultationMessageRepoPort;
  appointments: AppointmentRepoPort;
  patients: PatientRepoPort;
  doctors: DoctorRepoPort;
  /** Linked screening transcript for the doctor's patient-context panel. */
  screenings: Pick<ScreeningRepoPort, 'findById'>;
  video: VideoPort;
  pubsub: PubSubPort;
  auditLogs: AuditLogPort;
  medicalRecords: MedicalRecordService;
  /** Doctor-earnings accrual on completion (Phase 7). */
  payments: {
    accrueForConsultation(input: {
      appointmentId: string;
      doctorId: string;
      consultationId: string;
    }): Promise<void>;
  };
}

export class ConsultationService {
  constructor(
    private readonly deps: ConsultationServiceDeps,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── Participant resolution ─────────────────────────────────────────────────

  async participants(consultation: Consultation): Promise<ConsultationParticipants> {
    const [patient, doctor] = await Promise.all([
      this.deps.patients.findById(consultation.patientId),
      this.deps.doctors.findById(consultation.doctorId),
    ]);
    if (!patient || !doctor) throw CONSULTATION_NOT_FOUND();
    return { patientUserId: patient.userId, doctorUserId: doctor.userId };
  }

  /** 404 (not 403) when the caller is not a participant — no id enumeration. */
  private async requireParticipant(
    userId: string,
    consultationId: string,
  ): Promise<{ consultation: Consultation; participants: ConsultationParticipants; isDoctor: boolean }> {
    const consultation = await this.deps.consultations.findById(consultationId);
    if (!consultation) throw CONSULTATION_NOT_FOUND();
    const participants = await this.participants(consultation);
    if (userId !== participants.patientUserId && userId !== participants.doctorUserId) {
      throw CONSULTATION_NOT_FOUND();
    }
    return { consultation, participants, isDoctor: userId === participants.doctorUserId };
  }

  private async requireOwnDoctorConsultation(
    userId: string,
    consultationId: string,
  ): Promise<Consultation> {
    const { consultation, isDoctor } = await this.requireParticipant(userId, consultationId);
    if (!isDoctor) throw CONSULTATION_NOT_FOUND();
    return consultation;
  }

  /** Public for the WS layer: is this user a participant of the consultation? */
  async isParticipant(userId: string, consultationId: string): Promise<boolean> {
    try {
      await this.requireParticipant(userId, consultationId);
      return true;
    } catch {
      return false;
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Doctor starts the consultation from a CONFIRMED (remote) or CHECKED_IN
   * (in-person) appointment — the Phase 4 START_CONSULTATION transition is the
   * gate. A restart after TECHNICAL_FAILURE reuses the existing consultation
   * row (appointmentId is unique) and gets a fresh video room.
   */
  async start(
    doctorUserId: string,
    appointmentId: string,
  ): Promise<ConsultationView & { meetingToken?: string }> {
    const doctor = await this.deps.doctors.findByUserId(doctorUserId);
    const appointment = await this.deps.appointments.findById(appointmentId);
    if (!doctor || !appointment || appointment.doctorId !== doctor.id) {
      throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', msg('Miadi haijapatikana', 'Appointment not found'));
    }

    const transition = findAppointmentTransition('START_CONSULTATION', appointment.status);
    if (!transition) throw INVALID_TRANSITION(appointment.status, 'START_CONSULTATION');
    // remote-consultation-only guard: from CONFIRMED only for remote types.
    if (appointment.status === 'CONFIRMED' && appointment.type === 'IN_PERSON') {
      throw new ApiError(
        409,
        'CHECK_IN_REQUIRED',
        msg('Mgonjwa lazima aripoti kwanza (check-in)', 'The patient must check in first'),
      );
    }

    const existing = await this.deps.consultations.findByAppointmentId(appointmentId);
    if (existing && existing.status !== 'ABANDONED') {
      throw INVALID_TRANSITION(existing.status, 'START_CONSULTATION');
    }

    const applied = await this.deps.appointments.transition(appointment.id, transition.from, {
      status: transition.to,
    });
    if (!applied) throw INVALID_TRANSITION(appointment.status, 'START_CONSULTATION');
    await this.audit(doctorUserId, 'APPOINTMENT_TRANSITION', appointment.id, {
      event: 'START_CONSULTATION',
      from: transition.from,
      to: transition.to,
    });

    // Video room for remote audio/video consultations.
    let room: { roomId: string; roomUrl: string } | null = null;
    if (appointment.type === 'VIDEO' || appointment.type === 'AUDIO') {
      const scheduledEnd = new Date(
        appointment.scheduledAt.getTime() + appointment.durationMinutes * 60_000,
      );
      const roomKey = existing ? `${appointmentId}-r2` : appointmentId;
      room = await this.deps.video.createRoom(roomKey, { scheduledEnd, maxParticipants: 2 });
    }

    const consultation = existing
      ? await (async () => {
          const restarted = await this.deps.consultations.transitionStatus(existing.id, 'ABANDONED', {
            status: 'IN_PROGRESS',
            endedAt: null,
            endReason: null,
            startedAt: this.now(),
            ...(room ? { videoRoomId: room.roomId, videoRoomUrl: room.roomUrl } : {}),
          });
          if (!restarted) throw INVALID_TRANSITION('ABANDONED', 'START_CONSULTATION');
          return restarted;
        })()
      : await this.deps.consultations.create({
          appointmentId,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          startedAt: this.now(),
          videoRoomId: room?.roomId ?? null,
          videoRoomUrl: room?.roomUrl ?? null,
        });

    await this.audit(doctorUserId, 'CONSULTATION_STARTED', consultation.id, {
      appointmentId,
      restarted: existing !== null,
    });
    this.deps.pubsub.publish(consultationChannel(consultation.id), {
      type: 'consultation.status',
      consultationId: consultation.id,
      status: 'IN_PROGRESS',
    });

    const view = await this.toView(consultation, { includeNotes: true });
    if (room) {
      const meetingToken = await this.deps.video.createMeetingToken(room.roomId, {
        userId: doctorUserId,
        role: 'doctor',
        ttlSeconds: MEETING_TOKEN_TTL_SECONDS,
      });
      return { ...view, meetingToken };
    }
    return view;
  }

  /** Role-scoped meeting token — each participant fetches their own. */
  async meetingToken(userId: string, consultationId: string): Promise<{ meetingToken: string; roomUrl: string }> {
    const { consultation, isDoctor } = await this.requireParticipant(userId, consultationId);
    if (consultation.status !== 'IN_PROGRESS' || consultation.videoRoomId === null) {
      throw new ApiError(
        409,
        'NO_ACTIVE_ROOM',
        msg('Hakuna chumba cha video kinachoendelea', 'No active video room for this consultation'),
      );
    }
    const meetingToken = await this.deps.video.createMeetingToken(consultation.videoRoomId, {
      userId,
      role: isDoctor ? 'doctor' : 'patient',
      ttlSeconds: MEETING_TOKEN_TTL_SECONDS,
    });
    return { meetingToken, roomUrl: consultation.videoRoomUrl ?? '' };
  }

  async get(userId: string, consultationId: string): Promise<ConsultationView> {
    const { consultation, isDoctor } = await this.requireParticipant(userId, consultationId);
    await this.audit(userId, 'CONSULTATION_VIEWED', consultation.id);
    return this.toView(consultation, { includeNotes: isDoctor });
  }

  /**
   * Resolve an appointment to its consultation (Phase 11 portal): the doctor's
   * day view holds appointment ids, but resuming an already-started
   * consultation needs the consultation id. Participants only — the same
   * ownership check as `get`.
   */
  async findForAppointment(
    userId: string,
    appointmentId: string,
  ): Promise<{ consultation: ConsultationView | null }> {
    const consultation = await this.deps.consultations.findByAppointmentId(appointmentId);
    if (!consultation) return { consultation: null };
    const { isDoctor } = await this.requireParticipant(userId, consultation.id);
    await this.audit(userId, 'CONSULTATION_VIEWED', consultation.id);
    return { consultation: await this.toView(consultation, { includeNotes: isDoctor }) };
  }

  /**
   * Patient clinical context for the doctor's workspace (Phase 11 portal):
   * age BAND (never the date of birth), gender, chronic conditions, allergies,
   * and the linked screening transcript when the booking came from triage.
   * Assigned doctor only; PHI-audited.
   */
  async patientContext(
    doctorUserId: string,
    consultationId: string,
  ): Promise<{
    ageBand: string;
    gender: string;
    bloodType: string | null;
    chronicConditions: string[];
    allergies: string[];
    currentMedications: string[];
    screening: {
      triageLevel: string | null;
      urgencyScore: number | null;
      transcript: Array<{ role: string; content: string }>;
    } | null;
  }> {
    const consultation = await this.requireOwnDoctorConsultation(doctorUserId, consultationId);
    const patient = await this.deps.patients.findById(consultation.patientId);
    if (!patient) throw CONSULTATION_NOT_FOUND();

    // Linked screening (if the appointment came from triage) — decrypted here.
    let screening: {
      triageLevel: string | null;
      urgencyScore: number | null;
      transcript: Array<{ role: string; content: string }>;
    } | null = null;
    const appointment = await this.deps.appointments.findById(consultation.appointmentId);
    if (appointment?.screeningResultId != null) {
      const session = await this.deps.screenings.findById(appointment.screeningResultId);
      if (session && session.patientId === patient.id) {
        screening = {
          triageLevel: session.triageLevel,
          urgencyScore: session.urgencyScore,
          transcript:
            session.encryptedConversation === null
              ? []
              : (JSON.parse(decryptHealthData(session.encryptedConversation)) as Array<{
                  role: string;
                  content: string;
                }>),
        };
      }
    }

    await this.audit(doctorUserId, 'PATIENT_CONTEXT_VIEWED', consultation.id, {
      patientId: patient.id,
    });

    return {
      ageBand: toAgeBand(patient.dateOfBirth, this.now()),
      gender: patient.gender,
      bloodType: patient.bloodType,
      chronicConditions: patient.chronicConditions,
      allergies: patient.allergies,
      currentMedications: patient.currentMedications,
      screening,
    };
  }

  // ── Clinical documentation (doctor-only, IN_PROGRESS only) ────────────────

  /** Merge the given fields into the single encrypted clinical-notes blob. */
  async updateNotes(
    doctorUserId: string,
    consultationId: string,
    input: ConsultationNotesInput,
  ): Promise<ConsultationView> {
    const consultation = await this.requireOwnDoctorConsultation(doctorUserId, consultationId);
    this.requireInProgress(consultation, 'UPDATE_NOTES');

    const notes = { ...this.decryptNotes(consultation), ...input };
    const updated = await this.deps.consultations.update(consultation.id, {
      encryptedNotes: encryptHealthData(JSON.stringify(notes)),
    });
    await this.audit(doctorUserId, 'CONSULTATION_NOTES_UPDATED', consultation.id, {
      fields: Object.keys(input),
    });
    return this.toView(updated, { includeNotes: true });
  }

  async setReferral(
    doctorUserId: string,
    consultationId: string,
    input: ReferralInput,
  ): Promise<ConsultationView> {
    const consultation = await this.requireOwnDoctorConsultation(doctorUserId, consultationId);
    this.requireInProgress(consultation, 'SET_REFERRAL');
    const updated = await this.deps.consultations.update(consultation.id, {
      ...(input.referredToInPerson !== undefined ? { referredToInPerson: input.referredToInPerson } : {}),
      ...(input.referralNotes !== undefined ? { referralNotes: input.referralNotes } : {}),
      ...(input.followUpRequired !== undefined ? { followUpRequired: input.followUpRequired } : {}),
      ...(input.followUpDate !== undefined ? { followUpDate: input.followUpDate } : {}),
    });
    return this.toView(updated, { includeNotes: true });
  }

  async addDiagnosis(
    doctorUserId: string,
    consultationId: string,
    input: AddDiagnosisSchemaInput,
  ): Promise<ConsultationView> {
    const consultation = await this.requireOwnDoctorConsultation(doctorUserId, consultationId);
    this.requireInProgress(consultation, 'ADD_DIAGNOSIS');

    if (input.type === 'PRIMARY') {
      const existing = await this.deps.consultations.listDiagnoses(consultation.id);
      if (existing.some((diagnosis) => diagnosis.type === 'PRIMARY')) {
        throw new ApiError(
          409,
          'PRIMARY_DIAGNOSIS_EXISTS',
          msg('Tayari kuna utambuzi mkuu — ondoa wa kwanza kwanza', 'A primary diagnosis already exists — remove it first'),
        );
      }
    }
    await this.deps.consultations.addDiagnosis({
      consultationId: consultation.id,
      icd10Code: input.icd10Code,
      description: input.description,
      type: input.type,
    });
    await this.audit(doctorUserId, 'DIAGNOSIS_ADDED', consultation.id, { icd10Code: input.icd10Code });
    return this.toView(consultation, { includeNotes: true });
  }

  async removeDiagnosis(
    doctorUserId: string,
    consultationId: string,
    diagnosisId: string,
  ): Promise<ConsultationView> {
    const consultation = await this.requireOwnDoctorConsultation(doctorUserId, consultationId);
    this.requireInProgress(consultation, 'REMOVE_DIAGNOSIS');
    const removed = await this.deps.consultations.removeDiagnosis(consultation.id, diagnosisId);
    if (removed === 0) {
      throw new ApiError(404, 'DIAGNOSIS_NOT_FOUND', msg('Utambuzi haujapatikana', 'Diagnosis not found'));
    }
    await this.audit(doctorUserId, 'DIAGNOSIS_REMOVED', consultation.id, { diagnosisId });
    return this.toView(consultation, { includeNotes: true });
  }

  // ── Completion / abort ─────────────────────────────────────────────────────

  /**
   * Complete: requires assessment + plan in the notes blob; drives the
   * appointment COMPLETE_CONSULTATION transition; ends the video room;
   * generates the immutable medical record.
   */
  async complete(doctorUserId: string, consultationId: string): Promise<ConsultationView> {
    const consultation = await this.requireOwnDoctorConsultation(doctorUserId, consultationId);
    this.requireInProgress(consultation, 'COMPLETE_CONSULTATION');

    const notes = this.decryptNotes(consultation);
    if (notes.assessment === undefined || notes.plan === undefined) {
      throw new ApiError(
        400,
        'CLINICAL_NOTES_INCOMPLETE',
        msg('Tathmini (assessment) na mpango (plan) vinahitajika kabla ya kumaliza', 'Assessment and plan are required before completing'),
      );
    }

    const appointment = await this.deps.appointments.findById(consultation.appointmentId);
    if (!appointment) throw CONSULTATION_NOT_FOUND();
    const transition = findAppointmentTransition('COMPLETE_CONSULTATION', appointment.status);
    if (!transition) throw INVALID_TRANSITION(appointment.status, 'COMPLETE_CONSULTATION');
    const appliedAppointment = await this.deps.appointments.transition(appointment.id, transition.from, {
      status: transition.to,
    });
    if (!appliedAppointment) throw INVALID_TRANSITION(appointment.status, 'COMPLETE_CONSULTATION');
    await this.audit(doctorUserId, 'APPOINTMENT_TRANSITION', appointment.id, {
      event: 'COMPLETE_CONSULTATION',
      from: transition.from,
      to: transition.to,
    });

    const endedAt = this.now();
    const durationSeconds = Math.max(
      0,
      Math.round((endedAt.getTime() - consultation.startedAt.getTime()) / 1000),
    );
    const completed = await this.deps.consultations.transitionStatus(consultation.id, 'IN_PROGRESS', {
      status: 'COMPLETED',
      endedAt,
      durationSeconds,
      endReason: 'COMPLETED',
    });
    if (!completed) throw INVALID_TRANSITION(consultation.status, 'COMPLETE_CONSULTATION');

    await this.deps.consultations.incrementDoctorConsultations(consultation.doctorId);
    // Phase 7: accrue the doctor's share (paid mobile-money appointments only).
    await this.deps.payments.accrueForConsultation({
      appointmentId: consultation.appointmentId,
      doctorId: consultation.doctorId,
      consultationId: consultation.id,
    });

    const diagnoses = await this.deps.consultations.listDiagnoses(consultation.id);
    await this.deps.medicalRecords.generateFromConsultation({
      consultation: completed,
      doctorUserId,
      notes,
      diagnoses,
    });

    await this.audit(doctorUserId, 'CONSULTATION_COMPLETED', consultation.id, { durationSeconds });
    this.deps.pubsub.publish(consultationChannel(consultation.id), {
      type: 'consultation.status',
      consultationId: consultation.id,
      status: 'COMPLETED',
    });
    await this.endVideoRoom(doctorUserId, consultation);
    return this.toView(completed, { includeNotes: true });
  }

  /**
   * Abort on technical failure — either participant (or the system). The
   * appointment returns to CONFIRMED exactly once (technicalFailureAt is the
   * once-only guard from the transition table); the consultation is marked
   * ABANDONED and can be restarted via start().
   */
  async abort(userId: string, consultationId: string, reason: string): Promise<ConsultationView> {
    const { consultation } = await this.requireParticipant(userId, consultationId);
    this.requireInProgress(consultation, 'TECHNICAL_FAILURE');

    const appointment = await this.deps.appointments.findById(consultation.appointmentId);
    if (!appointment) throw CONSULTATION_NOT_FOUND();
    const transition = findAppointmentTransition('TECHNICAL_FAILURE', appointment.status);
    if (!transition) throw INVALID_TRANSITION(appointment.status, 'TECHNICAL_FAILURE');
    // once-only-per-appointment guard.
    if (appointment.technicalFailureAt !== null) {
      throw new ApiError(
        409,
        'RESTART_ALREADY_USED',
        msg('Miadi hii tayari ilirudishwa mara moja baada ya hitilafu', 'This appointment was already restarted once after a failure'),
      );
    }
    const appliedAppointment = await this.deps.appointments.transition(appointment.id, transition.from, {
      status: transition.to,
      technicalFailureAt: this.now(),
    });
    if (!appliedAppointment) throw INVALID_TRANSITION(appointment.status, 'TECHNICAL_FAILURE');
    await this.audit(userId, 'APPOINTMENT_TRANSITION', appointment.id, {
      event: 'TECHNICAL_FAILURE',
      from: transition.from,
      to: transition.to,
    });

    const aborted = await this.deps.consultations.transitionStatus(consultation.id, 'IN_PROGRESS', {
      status: 'ABANDONED',
      endedAt: this.now(),
      endReason: `TECHNICAL_FAILURE:${reason}`,
    });
    if (!aborted) throw INVALID_TRANSITION(consultation.status, 'TECHNICAL_FAILURE');

    await this.audit(userId, 'CONSULTATION_ABORTED', consultation.id, { reason });
    this.deps.pubsub.publish(consultationChannel(consultation.id), {
      type: 'consultation.status',
      consultationId: consultation.id,
      status: 'ABANDONED',
    });
    await this.endVideoRoom(userId, consultation);
    return this.toView(aborted, { includeNotes: false });
  }

  // ── Recording consent ──────────────────────────────────────────────────────

  /** Only the PATIENT account can grant recording consent; audited. */
  async grantRecordingConsent(userId: string, consultationId: string): Promise<{ recordingConsentGiven: boolean }> {
    const { consultation, participants } = await this.requireParticipant(userId, consultationId);
    if (userId !== participants.patientUserId) {
      throw new ApiError(
        403,
        'PATIENT_CONSENT_REQUIRED',
        msg('Ridhaa ya kurekodi inaweza kutolewa na mgonjwa pekee', 'Recording consent can only be given by the patient'),
      );
    }
    this.requireInProgress(consultation, 'RECORDING_CONSENT');
    await this.deps.consultations.update(consultation.id, {
      recordingConsentGiven: true,
      recordingConsentAt: this.now(),
    });
    await this.audit(userId, 'RECORDING_CONSENT_GIVEN', consultation.id);
    return { recordingConsentGiven: true };
  }

  // ── Chat ───────────────────────────────────────────────────────────────────

  /** Persist (encrypted at rest) then broadcast. Used by the WS layer. */
  async postMessage(
    userId: string,
    consultationId: string,
    body: string,
  ): Promise<{ id: string; sentAt: Date }> {
    const { consultation } = await this.requireParticipant(userId, consultationId);
    this.requireInProgress(consultation, 'CHAT_MESSAGE');
    const sentAt = this.now();
    const message = await this.deps.consultationMessages.create({
      consultationId: consultation.id,
      senderUserId: userId,
      encryptedBody: encryptHealthData(body),
      sentAt,
    });
    this.deps.pubsub.publish(consultationChannel(consultation.id), {
      type: 'chat.message',
      consultationId: consultation.id,
      messageId: message.id,
      senderUserId: userId,
      body,
      sentAt: sentAt.toISOString(),
    });
    return { id: message.id, sentAt };
  }

  /** Participants only; decrypted server-side; audited as a PHI read. */
  async listMessages(
    userId: string,
    consultationId: string,
    query: { page: number; pageSize: number },
  ): Promise<{
    items: Array<{ id: string; senderUserId: string; body: string; sentAt: Date }>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const { consultation } = await this.requireParticipant(userId, consultationId);
    const { items, total } = await this.deps.consultationMessages.listForConsultation(
      consultation.id,
      query,
    );
    await this.audit(userId, 'CONSULTATION_MESSAGES_VIEWED', consultation.id, { count: items.length });
    return {
      items: items.map((message) => ({
        id: message.id,
        senderUserId: message.senderUserId,
        body: decryptHealthData(message.encryptedBody),
        sentAt: message.sentAt,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private requireInProgress(consultation: Consultation, event: string): void {
    if (consultation.status !== 'IN_PROGRESS') {
      throw INVALID_TRANSITION(consultation.status, event);
    }
  }

  private decryptNotes(consultation: Consultation): ClinicalNotes {
    if (consultation.encryptedNotes === null) return {};
    return JSON.parse(decryptHealthData(consultation.encryptedNotes)) as ClinicalNotes;
  }

  private async toView(
    consultation: Consultation,
    options: { includeNotes: boolean },
  ): Promise<ConsultationView> {
    const diagnoses = await this.deps.consultations.listDiagnoses(consultation.id);
    return {
      id: consultation.id,
      appointmentId: consultation.appointmentId,
      status: consultation.status,
      startedAt: consultation.startedAt,
      endedAt: consultation.endedAt,
      durationSeconds: consultation.durationSeconds,
      endReason: consultation.endReason,
      videoRoomUrl: consultation.videoRoomUrl,
      recordingConsentGiven: consultation.recordingConsentGiven,
      referredToInPerson: consultation.referredToInPerson,
      referralNotes: consultation.referralNotes,
      followUpRequired: consultation.followUpRequired,
      followUpDate: consultation.followUpDate,
      diagnoses: diagnoses.map((diagnosis) => ({
        id: diagnosis.id,
        icd10Code: diagnosis.icd10Code,
        description: diagnosis.description,
        type: diagnosis.type,
      })),
      ...(options.includeNotes ? { notes: this.decryptNotes(consultation) } : {}),
    };
  }

  /**
   * Close the Daily room (ejects whoever is still in the call). Runs LAST and
   * never throws: the status change is already committed, so a Daily/network
   * failure here must not skip the medical record, the earnings accrual or
   * the consultation.status broadcast (it used to run before all three). The
   * room still expires on its own (exp = scheduled end + 2h); the failure is
   * audited.
   */
  private async endVideoRoom(
    actorUserId: string,
    consultation: { id: string; videoRoomId: string | null },
  ): Promise<void> {
    if (consultation.videoRoomId === null) return;
    try {
      await this.deps.video.endRoom(consultation.videoRoomId);
    } catch (error) {
      await this.audit(actorUserId, 'VIDEO_ROOM_END_FAILED', consultation.id, {
        roomId: consultation.videoRoomId,
        error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
    }
  }

  private audit(
    actorUserId: string,
    action: string,
    resourceId: string,
    metadata?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.deps.auditLogs.append({
      actorUserId,
      action,
      resourceType: action.startsWith('APPOINTMENT') ? 'Appointment' : 'Consultation',
      resourceId,
      ipAddress: null,
      userAgent: null,
      ...(metadata !== undefined ? { metadata: metadata as never } : {}),
    });
  }
}
