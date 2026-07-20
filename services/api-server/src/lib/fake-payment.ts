import { randomUUID } from 'node:crypto';
import type { PaymentPort } from './ports.js';

/**
 * Stand-in for the Tanzania mobile-money aggregator client (Phase 7).
 * Records initiations and mints a reference; completion is driven manually by
 * calling AppointmentService.handlePaymentCompleted — exactly what the real
 * webhook will do.
 */
export class FakePaymentPort implements PaymentPort {
  readonly initiated: Array<{
    reference: string;
    appointmentId: string;
    patientId: string;
    amountTzs: number;
    payerPhone: string;
  }> = [];
  readonly refunds: Array<{ appointmentId: string; reason: string }> = [];
  readonly accruals: Array<{ appointmentId: string; doctorId: string; consultationId: string }> = [];

  initiateMobileMoney(input: {
    appointmentId: string;
    patientId: string;
    amountTzs: number;
    payerPhone: string;
  }): Promise<{ reference: string }> {
    const reference = `fake-pay-${randomUUID()}`;
    this.initiated.push({ reference, ...input });
    return Promise.resolve({ reference });
  }

  refundIfPaid(appointmentId: string, reason: string): Promise<void> {
    this.refunds.push({ appointmentId, reason });
    return Promise.resolve();
  }

  accrueForConsultation(input: {
    appointmentId: string;
    doctorId: string;
    consultationId: string;
  }): Promise<void> {
    this.accruals.push(input);
    return Promise.resolve();
  }
}
