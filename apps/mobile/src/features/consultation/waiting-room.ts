/** Waiting-room / call gating rules — pure and testable. */
import type { ConsultationStatusFrame } from '../../services/ws-frames';

/** "Enter waiting room" opens 10 minutes before the scheduled start. */
export const WAITING_ROOM_LEAD_MS = 10 * 60_000;

export function canEnterWaitingRoom(
  appointment: { status: string; type: string; scheduledAt: string },
  now: Date,
): boolean {
  const remote = appointment.type === 'VIDEO' || appointment.type === 'AUDIO' || appointment.type === 'CHAT';
  if (!remote || appointment.status !== 'CONFIRMED') return false;
  return new Date(appointment.scheduledAt).getTime() - now.getTime() <= WAITING_ROOM_LEAD_MS;
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
