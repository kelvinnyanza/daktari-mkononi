import type { Consultation, Diagnosis, MedicalRecord } from '@daktari/db';
import { decryptHealthData, encryptHealthData } from '@daktari/encryption';
import type { ClinicalNotes } from '@daktari/schemas';
import { ApiError, msg } from '../../lib/errors.js';
import type {
  AppointmentRepoPort,
  AuditLogPort,
  DoctorRepoPort,
  MedicalRecordRepoPort,
  PatientRepoPort,
} from '../../lib/ports.js';

const RECORD_NOT_FOUND = (): ApiError =>
  new ApiError(404, 'RECORD_NOT_FOUND', msg('Kumbukumbu haijapatikana', 'Medical record not found'));

export interface MedicalRecordServiceDeps {
  medicalRecords: MedicalRecordRepoPort;
  patients: PatientRepoPort;
  doctors: DoctorRepoPort;
  appointments: AppointmentRepoPort;
  auditLogs: AuditLogPort;
}

export interface MedicalRecordView {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  consultationId: string | null;
  addendumToId: string | null;
  createdAt: Date;
  /** Decrypted clinical detail — present only on single-record reads. */
  content?: unknown;
}

export class MedicalRecordService {
  constructor(
    private readonly deps: MedicalRecordServiceDeps,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Auto-generation on consultation completion: the full clinical detail goes
   * into ONE encrypted blob; title/summary stay deliberately non-sensitive.
   */
  async generateFromConsultation(input: {
    consultation: Consultation;
    doctorUserId: string;
    notes: ClinicalNotes;
    diagnoses: Diagnosis[];
  }): Promise<MedicalRecord> {
    const detail = {
      notes: input.notes,
      diagnoses: input.diagnoses.map((diagnosis) => ({
        icd10Code: diagnosis.icd10Code,
        description: diagnosis.description,
        type: diagnosis.type,
      })),
      referral: {
        referredToInPerson: input.consultation.referredToInPerson,
        referralNotes: input.consultation.referralNotes,
        followUpRequired: input.consultation.followUpRequired,
        followUpDate: input.consultation.followUpDate,
      },
      consultation: {
        startedAt: input.consultation.startedAt,
        endedAt: this.now(),
        durationSeconds: input.consultation.durationSeconds,
      },
    };
    return this.deps.medicalRecords.create({
      patientId: input.consultation.patientId,
      consultationId: input.consultation.id,
      type: 'CONSULTATION_NOTE',
      title: 'Muhtasari wa ushauri / Consultation summary',
      // Non-sensitive by design: no symptoms, no diagnoses in plaintext.
      summary: `Teleconsultation on ${this.now().toISOString().slice(0, 10)}`,
      encryptedContent: encryptHealthData(JSON.stringify(detail)),
      createdByUserId: input.doctorUserId,
    });
  }

  /** Patient's own records — list view never decrypts content. */
  async listMine(userId: string, query: { page: number; pageSize: number }): Promise<{
    items: MedicalRecordView[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const patient = await this.deps.patients.findByUserId(userId);
    if (!patient) throw RECORD_NOT_FOUND();
    const { items, total } = await this.deps.medicalRecords.listForPatient(patient.id, query);
    await this.audit(userId, 'MEDICAL_RECORD_LIST_VIEWED', patient.id);
    return {
      items: items.map((record) => this.toView(record)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /**
   * Single-record read with decrypted content. Allowed for:
   *  - the patient who owns the record,
   *  - the doctor who authored it,
   *  - a doctor with an active (CONFIRMED/IN_PROGRESS) appointment with the
   *    patient (permission medical-record:read:assigned checked at the route).
   * Every read is audited with the entity id.
   */
  async getById(userId: string, recordId: string): Promise<MedicalRecordView> {
    const record = await this.deps.medicalRecords.findById(recordId);
    if (!record) throw RECORD_NOT_FOUND();

    const allowed = await this.canRead(userId, record);
    // 404, not 403 — record ids must not be enumerable.
    if (!allowed) throw RECORD_NOT_FOUND();

    await this.audit(userId, 'MEDICAL_RECORD_VIEWED', record.id);
    return {
      ...this.toView(record),
      content: JSON.parse(decryptHealthData(record.encryptedContent)) as unknown,
    };
  }

  private async canRead(userId: string, record: MedicalRecord): Promise<boolean> {
    if (record.createdByUserId === userId) return true; // authoring doctor
    const patient = await this.deps.patients.findById(record.patientId);
    if (patient?.userId === userId) return true; // owner
    const doctor = await this.deps.doctors.findByUserId(userId);
    if (doctor) {
      return this.deps.appointments.hasActiveWith(doctor.id, record.patientId);
    }
    return false;
  }

  private toView(record: MedicalRecord): MedicalRecordView {
    return {
      id: record.id,
      type: record.type,
      title: record.title,
      summary: record.summary,
      consultationId: record.consultationId,
      addendumToId: record.addendumToId,
      createdAt: record.createdAt,
    };
  }

  private audit(actorUserId: string, action: string, resourceId: string): Promise<unknown> {
    return this.deps.auditLogs.append({
      actorUserId,
      action,
      resourceType: 'MedicalRecord',
      resourceId,
      ipAddress: null,
      userAgent: null,
    });
  }
}
