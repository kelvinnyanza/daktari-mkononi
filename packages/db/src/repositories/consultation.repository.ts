import type {
  Consultation,
  ConsultationStatus,
  Diagnosis,
  DiagnosisType,
  Prisma,
} from '@prisma/client';
import { prisma } from '../client.js';

export interface CreateConsultationInput {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  startedAt: Date;
  videoRoomId?: string | null;
  videoRoomUrl?: string | null;
}

export interface AddDiagnosisInput {
  consultationId: string;
  icd10Code: string;
  description: string;
  type: DiagnosisType;
}

export const consultationRepository = {
  findById(id: string): Promise<Consultation | null> {
    return prisma.consultation.findUnique({ where: { id } });
  },

  findByAppointmentId(appointmentId: string): Promise<Consultation | null> {
    return prisma.consultation.findUnique({ where: { appointmentId } });
  },

  create(input: CreateConsultationInput): Promise<Consultation> {
    return prisma.consultation.create({
      data: {
        appointmentId: input.appointmentId,
        patientId: input.patientId,
        doctorId: input.doctorId,
        startedAt: input.startedAt,
        videoRoomId: input.videoRoomId ?? null,
        videoRoomUrl: input.videoRoomUrl ?? null,
      },
    });
  },

  update(id: string, data: Prisma.ConsultationUpdateInput): Promise<Consultation> {
    return prisma.consultation.update({ where: { id }, data });
  },

  /**
   * Guarded status transition (same pattern as appointments): applies only
   * while the row is still in `from`; null on a miss → caller answers 409.
   */
  async transitionStatus(
    id: string,
    from: ConsultationStatus,
    data: Prisma.ConsultationUpdateManyMutationInput & { status: ConsultationStatus },
  ): Promise<Consultation | null> {
    const { count } = await prisma.consultation.updateMany({ where: { id, status: from }, data });
    if (count === 0) return null;
    return prisma.consultation.findUnique({ where: { id } });
  },

  // ── Diagnoses ──────────────────────────────────────────────────────────────

  listDiagnoses(consultationId: string): Promise<Diagnosis[]> {
    return prisma.diagnosis.findMany({
      where: { consultationId },
      orderBy: { createdAt: 'asc' },
    });
  },

  addDiagnosis(input: AddDiagnosisInput): Promise<Diagnosis> {
    return prisma.diagnosis.create({ data: input });
  },

  removeDiagnosis(consultationId: string, diagnosisId: string): Promise<number> {
    return prisma.diagnosis
      .deleteMany({ where: { id: diagnosisId, consultationId } })
      .then((result) => result.count);
  },

  /** Increment the doctor's completed-consultation counter. */
  incrementDoctorConsultations(doctorId: string): Promise<unknown> {
    return prisma.doctor.update({
      where: { id: doctorId },
      data: { totalConsultations: { increment: 1 } },
    });
  },
};
