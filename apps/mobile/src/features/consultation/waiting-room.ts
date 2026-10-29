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
