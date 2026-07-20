import type { DoctorDocument, DoctorDocumentType, DocumentReviewStatus } from '@prisma/client';
import { prisma } from '../client.js';

export interface UpsertDoctorDocumentInput {
  doctorId: string;
  type: DoctorDocumentType;
  fileKey: string;
  fileName: string;
  mimeType: string;
}

export const doctorDocumentRepository = {
  /** Re-uploading a type replaces the file and resets its review state. */
  upsertForType(input: UpsertDoctorDocumentInput): Promise<DoctorDocument> {
    const fresh = {
      fileKey: input.fileKey,
      fileName: input.fileName,
      mimeType: input.mimeType,
      reviewStatus: 'PENDING' as const,
      reviewedByUserId: null,
      reviewedAt: null,
      reviewNotes: null,
      uploadedAt: new Date(),
    };
    return prisma.doctorDocument.upsert({
      where: { doctorId_type: { doctorId: input.doctorId, type: input.type } },
      create: { doctorId: input.doctorId, type: input.type, ...fresh },
      update: fresh,
    });
  },

  listByDoctor(doctorId: string): Promise<DoctorDocument[]> {
    return prisma.doctorDocument.findMany({
      where: { doctorId },
      orderBy: { uploadedAt: 'asc' },
    });
  },

  setReview(
    doctorId: string,
    type: DoctorDocumentType,
    review: { status: DocumentReviewStatus; notes: string | null; reviewedByUserId: string },
  ): Promise<DoctorDocument> {
    return prisma.doctorDocument.update({
      where: { doctorId_type: { doctorId, type } },
      data: {
        reviewStatus: review.status,
        reviewNotes: review.notes,
        reviewedByUserId: review.reviewedByUserId,
        reviewedAt: new Date(),
      },
    });
  },
};
