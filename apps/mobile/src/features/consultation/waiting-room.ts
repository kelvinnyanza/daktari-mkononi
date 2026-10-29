/** Waiting-room / call gating rules — pure and testable. */
import type { ConsultationStatusFrame } from '../../services/ws-frames';

/** "Enter waiting room" opens 10 minutes before the scheduled start. */
export const WAITING_ROOM_LEAD_MS = 10 * 60_000;

export function isRemoteType(type: string): boolean {
  return type === 'VIDEO' || type === 'AUDIO' || type === 'CHAT';
}

export function canEnterWaitingRoom(
  appointment: { status: string; type: string; scheduledAt: string },
  now: Date,
): boolean {
  if (!isRemoteType(appointment.type) || appointment.status !== 'CONFIRMED') return false;
  return new Date(appointment.scheduledAt).getTime() - now.getTime() <= WAITING_ROOM_LEAD_MS;
}

export type ConsultationEntry = 'join' | 'waiting-room' | null;

/**
 * The action Appointment details offers for a remote appointment. Remote
 * types have no patient check-in step (check-in is IN_PERSON only), and the
 * server lets the doctor start a CONFIRMED remote appointment at ANY time —
 * so once it is IN_PROGRESS the patient must always be able to join,
 * regardless of the waiting-room window.
 */
export function consultationEntry(
  appointment: { status: string; type: string; scheduledAt: string },
  now: Date,
): ConsultationEntry {
  if (!isRemoteType(appointment.type)) return null;
  if (appointment.status === 'IN_PROGRESS') return 'join';
  return canEnterWaitingRoom(appointment, now) ? 'waiting-room' : null;
}

export interface WaitingRoomView {
  /** i18n key for the status line. */
  statusKey:
    | 'consult.waiting.status.connecting'
    | 'consult.waiting.status.open'
    | 'consult.waiting.status.entering';
  /** Consultation to enter now, or null to keep waiting. */
  enterConsultationId: string | null;
}

/**
 * What the waiting room shows for the latest by-appointment status.
 *
 * A consultation that is ALREADY IN_PROGRESS when the patient (re)enters
 * means "go in now" — not "wait for the doctor to start": the start already
 * happened and will not be announced again. (The old screen only reacted to
 * a change of the query data; on a rejoin the cached IN_PROGRESS never
 * changed, so it sat on "waiting for the doctor" forever.)
 */
export function waitingRoomView(query: {
  data: { consultationId: string; status: string } | undefined;
  isError: boolean;
}): WaitingRoomView {
  const data = query.data;
  if (data !== undefined && (data.status === 'IN_PROGRESS' || data.status === 'COMPLETED')) {
    return { statusKey: 'consult.waiting.status.entering', enterConsultationId: data.consultationId };
  }
  if (data === undefined || query.isError) {
    // 404 before the doctor starts — still waiting.
    return { statusKey: 'consult.waiting.status.connecting', enterConsultationId: null };
  }
  return { statusKey: 'consult.waiting.status.open', enterConsultationId: null };
}

export type WaitingRoomTransition = 'enter-call' | 'completed' | 'interrupted' | 'wait';

/** Map a consultation.status frame to what the waiting room should do next. */
export function waitingRoomTransition(frame: ConsultationStatusFrame): WaitingRoomTransition {
  switch (frame.status) {
    case 'IN_PROGRESS':
      return 'enter-call'; // doctor started → auto-transition to the call
    case 'COMPLETED':
      return 'completed';
    case 'ABANDONED':
      return 'interrupted';
    default:
      return 'wait';
  }
}
