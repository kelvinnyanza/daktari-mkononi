import type { BadgeTone } from '@/components/ui/badge';

/** Verification status → badge tone. Terminal-bad states read as danger. */
export function verificationStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'APPROVED':
      return 'success';
    case 'REJECTED':
    case 'SUSPENDED':
      return 'danger';
    case 'UNDER_REVIEW':
      return 'info';
    case 'DOCUMENTS_SUBMITTED':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function paymentStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'REFUNDED':
      return 'info';
    case 'PROCESSING':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function appointmentStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'danger';
    case 'IN_PROGRESS':
      return 'info';
    case 'CHECKED_IN':
    case 'CONFIRMED':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** Triage urgency → tone. EMERGENCY must always read as danger. */
export function triageTone(level: string): BadgeTone {
  switch (level) {
    case 'EMERGENCY':
      return 'danger';
    case 'URGENT':
      return 'warning';
    case 'ROUTINE':
      return 'info';
    default:
      return 'neutral';
  }
}
