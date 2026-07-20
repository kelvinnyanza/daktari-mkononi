import { z } from 'zod';
import { idSchema, paginationSchema } from './common.js';

export const appointmentTypeSchema = z.enum(['VIDEO', 'AUDIO', 'CHAT', 'IN_PERSON']);
export type AppointmentType = z.infer<typeof appointmentTypeSchema>;

export const appointmentStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export const paymentIntentSchema = z.enum(['MOBILE_MONEY', 'NHIF', 'INSURANCE', 'CASH_AT_FACILITY']);
export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

/** POST /api/v1/appointments — CASH_AT_FACILITY is validated IN_PERSON-only in the service. */
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
  paymentIntent: paymentIntentSchema,
  /** Link to a prior AI screening session, if the booking came from triage. */
  screeningResultId: idSchema.optional(),
});
export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;

export const rescheduleAppointmentSchema = z.object({
  scheduledAt: z.coerce.date(),
  reason: z.string().trim().max(500).optional(),
});
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const cancelAppointmentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

export const checkInSchema = z.object({
  checkInToken: z.string().min(16).max(128),
});
export type CheckInInput = z.infer<typeof checkInSchema>;

/** GET /api/v1/appointments/me */
export const listMyAppointmentsQuerySchema = paginationSchema.extend({
  status: appointmentStatusSchema.optional(),
});
export type ListMyAppointmentsQuery = z.infer<typeof listMyAppointmentsQuerySchema>;

/** GET /api/v1/doctors/me/appointments — a single day (defaults to today, EAT). */
export const doctorDayQuerySchema = paginationSchema.extend({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});
export type DoctorDayQuery = z.infer<typeof doctorDayQuerySchema>;
