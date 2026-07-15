import type { Appointment, AppointmentStatus, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export const appointmentRepository = {
  findById(id: string): Promise<Appointment | null> {
    return prisma.appointment.findUnique({ where: { id } });
  },

  listForDoctor(doctorId: string, from: Date, to: Date): Promise<Appointment[]> {
    return prisma.appointment.findMany({
      where: { doctorId, scheduledAt: { gte: from, lte: to } },
      orderBy: { scheduledAt: 'asc' },
    });
  },

  listForPatient(patientId: string): Promise<Appointment[]> {
    return prisma.appointment.findMany({
      where: { patientId },
      orderBy: { scheduledAt: 'desc' },
    });
  },

  create(data: Prisma.AppointmentCreateInput): Promise<Appointment> {
    return prisma.appointment.create({ data });
  },

  setStatus(id: string, status: AppointmentStatus): Promise<Appointment> {
    return prisma.appointment.update({ where: { id }, data: { status } });
  },
};
