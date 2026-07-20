import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { idSchema } from '@daktari/schemas';
import { ApiError, msg } from '../../lib/errors.js';
import type { AppointmentRepoPort, PaymentRepoPort, SessionRepoPort } from '../../lib/ports.js';
import { makeAuthenticate } from '../../middleware/authenticate.js';
import type { PaymentService } from '../payments/payment.service.js';

const paramsSchema = z.object({ appointmentId: idSchema });

/**
 * DEV-ONLY routes. app.ts registers this plugin ONLY when
 * NODE_ENV !== 'production' (asserted in the production-guard test), so these
 * endpoints do not exist in a production build at all.
 *
 * Why it exists: a phone on the LAN can complete a mobile-money booking
 * without hand-signing an AzamPay webhook. It drives the SAME
 * applyPaymentResult path the real webhook uses, so the dev flip and
 * production behave identically (no divergent test-only transition logic).
 */
export function buildDevRoutes(
  payments: PaymentService,
  paymentsRepo: PaymentRepoPort,
  appointments: AppointmentRepoPort,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);

  return async (app) => {
    app.post(
      '/payments/:appointmentId/complete',
      { preHandler: [authenticate] },
      async (request) => {
        const { appointmentId } = paramsSchema.parse(request.params);
        const appointment = await appointments.findById(appointmentId);
        if (!appointment) {
          throw new ApiError(
            404,
            'APPOINTMENT_NOT_FOUND',
            msg('Miadi haijapatikana', 'Appointment not found'),
          );
        }
        const payment = await paymentsRepo.findByAppointmentId(appointmentId);
        if (!payment) {
          throw new ApiError(
            404,
            'PAYMENT_NOT_FOUND',
            msg('Malipo hayajapatikana', 'No payment exists for this appointment'),
          );
        }

        // Exactly the webhook's path — guarded transition, replay-safe.
        const result = await payments.applyPaymentResult(
          payment,
          {
            status: 'COMPLETED',
            providerReference: payment.aggregatorTransactionId ?? `dev:${payment.idempotencyKey}`,
          },
          'webhook',
        );
        return { applied: result.applied, paymentId: payment.id };
      },
    );
  };
}
