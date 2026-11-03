/**
 * Mirror of the server's start window (ConsultationService.start,
 * CONSULTATION_START_EARLY_MINUTES, default 15): only explains a disabled
 * "Start consultation" button before the click. The server re-enforces it;
 * a stale mirror degrades to a 409 CONSULTATION_TOO_EARLY, never an unsafe start.
 */
export const CONSULTATION_START_EARLY_MINUTES = 15;

export function consultationOpensAt(scheduledAt: string | Date, earlyMinutes = CONSULTATION_START_EARLY_MINUTES): Date {
  return new Date(new Date(scheduledAt).getTime() - earlyMinutes * 60_000);
}

export function canStartConsultation(scheduledAt: string | Date, now: Date): boolean {
  return now.getTime() >= consultationOpensAt(scheduledAt).getTime();
}
