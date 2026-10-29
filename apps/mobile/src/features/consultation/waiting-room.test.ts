import { canEnterWaitingRoom, consultationEntry, waitingRoomTransition } from './waiting-room';
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

describe('consultationEntry (Appointment details action)', () => {
  const at = (status: string, type = 'VIDEO', scheduledAt = '2026-07-20T09:00:00Z') => ({
    status,
    type,
    scheduledAt,
  });

  it('IN_PROGRESS always offers Join — even hours before the slot (doctor started early)', () => {
    expect(consultationEntry(at('IN_PROGRESS', 'VIDEO', '2026-07-21T06:00:00Z'), NOW)).toBe('join');
    expect(consultationEntry(at('IN_PROGRESS', 'AUDIO'), NOW)).toBe('join');
    expect(consultationEntry(at('IN_PROGRESS', 'CHAT'), NOW)).toBe('join');
  });

  it('CONFIRMED offers the waiting room inside the 10-minute window only', () => {
    expect(consultationEntry(at('CONFIRMED'), NOW)).toBe('waiting-room');
    expect(consultationEntry(at('CONFIRMED', 'VIDEO', '2026-07-20T09:10:00Z'), NOW)).toBeNull();
  });

  it('offers nothing for in-person, unpaid, or finished appointments', () => {
    expect(consultationEntry(at('IN_PROGRESS', 'IN_PERSON'), NOW)).toBeNull();
    for (const status of ['PENDING_PAYMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) {
      expect(consultationEntry(at(status), NOW)).toBeNull();
    }
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
