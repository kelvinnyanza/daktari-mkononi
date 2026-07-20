import type { ConsultationRating } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export interface CreateRatingInput {
  consultationId: string;
  patientId: string;
  doctorId: string;
  rating: number;
  communication?: number | null;
  professionalism?: number | null;
  timeliness?: number | null;
  comment?: string | null;
}

/** Thrown when the unique constraint rejects a second rating for a consultation. */
export class AlreadyRatedError extends Error {
  constructor() {
    super('consultation already rated');
    this.name = 'AlreadyRatedError';
  }
}

export const ratingRepository = {
  findByConsultationId(consultationId: string): Promise<ConsultationRating | null> {
    return prisma.consultationRating.findUnique({ where: { consultationId } });
  },

  /**
   * Create the rating and fold it into the doctor's aggregates atomically.
   * The aggregate update is a single SQL UPDATE that computes the new average
   * from the row's own columns — no read-modify-write window, so two
   * concurrent ratings for the same doctor both land correctly.
   */
  async createWithAggregates(input: CreateRatingInput): Promise<ConsultationRating> {
    try {
      return await prisma.$transaction(async (tx) => {
        const rating = await tx.consultationRating.create({
          data: {
            consultationId: input.consultationId,
            patientId: input.patientId,
            doctorId: input.doctorId,
            rating: input.rating,
            communication: input.communication ?? null,
            professionalism: input.professionalism ?? null,
            timeliness: input.timeliness ?? null,
            comment: input.comment ?? null,
          },
        });
        await tx.$executeRaw(Prisma.sql`
          UPDATE "Doctor"
          SET "averageRating" = ("averageRating" * "totalRatings" + ${input.rating}) / ("totalRatings" + 1),
              "totalRatings"  = "totalRatings" + 1
          WHERE "id" = ${input.doctorId}
        `);
        return rating;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AlreadyRatedError();
      }
      throw error;
    }
  },
};
