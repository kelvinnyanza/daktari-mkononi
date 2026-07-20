import { canEnterWaitingRoom, waitingRoomTransition } from './waiting-room';
import type { ConsultationStatusFrame } from '../../services/ws-frames';

const NOW = new Date('2026-07-20T08:55:00.000Z');
const statusFrame = (status: ConsultationStatusFrame['status']): ConsultationStatusFrame => ({
  type: 'consultation.status',
  consultationId: 'c1',
  status,
});

describe('canEnterWaitingRoom', () => {
  it('opens 10 minutes before a CONFIRMED remote appointment', () => {
    // Scheduled 09:00, now 08:55 → 5 min out → open.
    expect(
      canEnterWaitingRoom({ status: 'CONFIRMED', type: 'VIDEO', scheduledAt: '2026-07-20T09:00:00Z' }, NOW),
    ).toBe(true);
    // 09:10 → 15 min out → not yet.
    expect(
      canEnterWaitingRoom({ status: 'CONFIRMED', type: 'VIDEO', scheduledAt: '2026-07-20T09:10:00Z' }, NOW),
    ).toBe(false);
  });

  it('is closed for non-confirmed, in-person, or already-started appointments', () => {
    expect(
      canEnterWaitingRoom({ status: 'PENDING_PAYMENT', type: 'VIDEO', scheduledAt: '2026-07-20T09:00:00Z' }, NOW),
    ).toBe(false);
    expect(
      canEnterWaitingRoom({ status: 'CONFIRMED', type: 'IN_PERSON', scheduledAt: '2026-07-20T09:00:00Z' }, NOW),
    ).toBe(false);
  });

  it('remains open after the scheduled time (doctor may run late)', () => {
    expect(
      canEnterWaitingRoom({ status: 'CONFIRMED', type: 'AUDIO', scheduledAt: '2026-07-20T08:30:00Z' }, NOW),
    ).toBe(true);
  });
});

describe('waitingRoomTransition', () => {
  it('IN_PROGRESS enters the call (doctor started)', () => {
    expect(waitingRoomTransition(statusFrame('IN_PROGRESS'))).toBe('enter-call');
  });
  it('COMPLETED and ABANDONED map to their end states', () => {
    expect(waitingRoomTransition(statusFrame('COMPLETED'))).toBe('completed');
    expect(waitingRoomTransition(statusFrame('ABANDONED'))).toBe('interrupted');
  });
});
