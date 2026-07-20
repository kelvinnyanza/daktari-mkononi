import type { DoctorSchedule, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export interface ScheduleSlotInput {
  dayOfWeek: number;
  startTime: string; // HH:mm, Africa/Dar_es_Salaam
  endTime: string;
  breaks: Array<{ startTime: string; endTime: string }>;
  slotDurationMinutes: number;
}

export const scheduleRepository = {
  listForDoctor(doctorId: string): Promise<DoctorSchedule[]> {
    return prisma.doctorSchedule.findMany({
      where: { doctorId, isActive: true },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  },

  /** Full replace: the weekly schedule is set as one unit (validated upstream). */
  async replaceForDoctor(doctorId: string, slots: ScheduleSlotInput[]): Promise<DoctorSchedule[]> {
    return prisma.$transaction(async (tx) => {
      await tx.doctorSchedule.deleteMany({ where: { doctorId } });
      for (const slot of slots) {
        await tx.doctorSchedule.create({
          data: {
            doctorId,
            dayOfWeek: slot.dayOfWeek,
            startTime: slot.startTime,
            endTime: slot.endTime,
            breaks: slot.breaks as unknown as Prisma.InputJsonValue,
            slotDurationMinutes: slot.slotDurationMinutes,
          },
        });
      }
      return tx.doctorSchedule.findMany({
        where: { doctorId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
    });
  },
};
