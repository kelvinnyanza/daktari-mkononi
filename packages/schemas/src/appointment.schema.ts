import { z } from 'zod';
import { idSchema } from './common.js';

export const appointmentTypeSchema = z.enum(['VIDEO', 'AUDIO', 'CHAT', 'IN_PERSON']);
export type AppointmentType = z.infer<typeof appointmentTypeSchema>;

export const appointmentStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export const bookAppointmentSchema = z.object({
  doctorId: idSchema,
  type: appointmentTypeSchema,
  scheduledAt: z.coerce
    .date()
    .refine((date) => date.getTime() > Date.now(), 'appointment must be in the future')
    .refine(
      (date) => date.getTime() < Date.now() + 90 * 24 * 60 * 60 * 1000,
      'appointment cannot be more than 90 days ahead',
    ),
  reason: z.string().trim().min(3).max(500),
  /** Link to a prior AI screening session, if the booking came from triage. */
  screeningResultId: idSchema.optional(),
});
export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;

export const rescheduleAppointmentSchema = z.object({
  appointmentId: idSchema,
  scheduledAt: z.coerce
    .date()
    .refine((date) => date.getTime() > Date.now(), 'new time must be in the future'),
  reason: z.string().trim().max(500).optional(),
});
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const cancelAppointmentSchema = z.object({
  appointmentId: idSchema,
  reason: z.string().trim().min(3).max(500),
});
export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

export const listAppointmentsQuerySchema = z.object({
  status: appointmentStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;
