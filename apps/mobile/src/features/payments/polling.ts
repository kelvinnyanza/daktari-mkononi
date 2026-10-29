/**
 * Payment-pending polling decisions — pure and testable. The screen wires
 * these into react-query's refetchInterval and a focus listener.
 */
import { deriveMno } from '@daktari/payments/mno';

export const POLL_INTERVAL_MS = 5_000;

/**
 * Poll every 5s while the screen is focused and a server-side change is
 * awaited: PENDING_PAYMENT (payment result), or a remote CONFIRMED appointment
 * (the doctor may start it at any time — there is no user-level push channel
 * before the consultation exists, so the Join action appears via this poll).
 */
export function pollInterval(
  status: string | undefined,
  focused: boolean,
  remote = false,
): number | false {
  if (!focused) return false;
  if (status === 'PENDING_PAYMENT') return POLL_INTERVAL_MS;
  return status === 'CONFIRMED' && remote ? POLL_INTERVAL_MS : false;
}

/**
 * True when polling observed the appointment leave PENDING_PAYMENT. Only the
 * appointment query polls; the payments query must be refetched at that
 * moment, or the screen keeps the cached PROCESSING payment line (plus the
 * still-valid Cancel button) and looks stuck on the payment step.
 */
export function leftPendingPayment(previous: string | undefined, current: string | undefined): boolean {
  return previous === 'PENDING_PAYMENT' && current !== undefined && current !== 'PENDING_PAYMENT';
}

/** "M-Pesa" / "Tigo Pesa" / "Airtel Money" / "Halopesa" from the MSISDN. */
export function mnoWalletLabel(phoneE164: string): string {
  switch (deriveMno(phoneE164)?.network) {
    case 'VODACOM':
      return 'M-Pesa';
    case 'TIGO':
      return 'Tigo Pesa';
    case 'AIRTEL':
      return 'Airtel Money';
    case 'HALOTEL':
      return 'Halopesa';
    default:
      return 'Mobile Money';
  }
}
