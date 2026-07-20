import { AlreadyRatedError } from '@daktari/db';
import type { RateConsultationInput } from '@daktari/schemas';
import { ApiError, msg } from '../../lib/errors.js';
import type {
  AuditLogPort,
  ConsultationRepoPort,
  PatientRepoPort,
  RatingRepoPort,
} from '../../lib/ports.js';

export interface RatingServiceDeps {
  ratings: RatingRepoPort;
  consultations: ConsultationRepoPort;
  patients: PatientRepoPort;
  auditLogs: AuditLogPort;
}

export class RatingService {
  constructor(private readonly deps: RatingServiceDeps) {}

  /**
   * Rating status for an appointment (mobile rate-CTA, Phase 9): the
   * patient-owner sees the consultation id, its status, and their rating if
   * one exists. 404 for non-owners — ids stay non-enumerable.
   */
  async statusForAppointment(
    userId: string,
    appointmentId: string,
  ): Promise<{
    consultationId: string;
    status: string;
    rating: { rating: number; comment: string | null; createdAt: Date } | null;
  }> {
    const consultation = await this.deps.consultations.findByAppointmentId(appointmentId);
    if (!consultation) {
      throw new ApiError(404, 'CONSULTATION_NOT_FOUND', msg('Ushauri haujapatikana', 'Consultation not found'));
    }
    const patient = await this.deps.patients.findById(consultation.patientId);
    if (!patient || patient.userId !== userId) {
      throw new ApiError(404, 'CONSULTATION_NOT_FOUND', msg('Ushauri haujapatikana', 'Consultation not found'));
    }
    const rating = await this.deps.ratings.findByConsultationId(consultation.id);
    return {
      consultationId: consultation.id,
      status: consultation.status,
      rating: rating
        ? { rating: rating.rating, comment: rating.comment, createdAt: rating.createdAt }
        : null,
    };
  }

  /**
   * Patient-only, COMPLETED consultations only, exactly one per consultation
   * (DB unique constraint is the arbiter). Doctor aggregates fold in
   * atomically inside the same transaction — see ratingRepository.
   */
  async rate(
    userId: string,
    consultationId: string,
    input: RateConsultationInput,
  ): Promise<{ id: string; rating: number }> {
    const consultation = await this.deps.consultations.findById(consultationId);
    if (!consultation) {
      throw new ApiError(404, 'CONSULTATION_NOT_FOUND', msg('Ushauri haujapatikana', 'Consultation not found'));
    }
    const patient = await this.deps.patients.findById(consultation.patientId);
    // 404 for non-owners — consultation ids are not enumerable.
    if (!patient || patient.userId !== userId) {
      throw new ApiError(404, 'CONSULTATION_NOT_FOUND', msg('Ushauri haujapatikana', 'Consultation not found'));
    }
    if (consultation.status !== 'COMPLETED') {
      throw new ApiError(
        409,
        'CONSULTATION_NOT_COMPLETED',
        msg('Unaweza kutoa tathmini baada ya ushauri kukamilika tu', 'You can only rate a completed consultation'),
      );
    }

    try {
      const rating = await this.deps.ratings.createWithAggregates({
        consultationId: consultation.id,
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
        rating: input.rating,
        communication: input.communication ?? null,
        professionalism: input.professionalism ?? null,
        timeliness: input.timeliness ?? null,
        comment: input.comment ?? null,
      });
      await this.deps.auditLogs.append({
        actorUserId: userId,
        action: 'CONSULTATION_RATED',
        resourceType: 'Consultation',
        resourceId: consultation.id,
        ipAddress: null,
        userAgent: null,
        metadata: { rating: input.rating },
      });
      return { id: rating.id, rating: rating.rating };
    } catch (error) {
      if (error instanceof AlreadyRatedError) {
        throw new ApiError(
          409,
          'ALREADY_RATED',
          msg('Ushauri huu tayari umetathminiwa', 'This consultation has already been rated'),
        );
      }
      throw error;
    }
  }
}
