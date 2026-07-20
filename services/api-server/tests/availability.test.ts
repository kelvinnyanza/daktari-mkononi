import { describe, expect, it } from 'vitest';
import { eatDayOfWeek, eatDayRangeUtc, eatTimeToUtc, utcToEatDate, utcToEatTime } from '../src/lib/eat-time.js';
import { computeAvailability } from '../src/modules/doctors/availability.js';

// 2026-07-20 is a Monday.
const MONDAY = '2026-07-20';
/** 06:00 UTC on the day == 09:00 EAT — well before the first afternoon slot. */
const MORNING_UTC = new Date('2026-07-20T06:00:00.000Z');

describe('EAT time helpers', () => {
  it('converts EAT wall-clock to UTC (-3h) and back', () => {
    expect(eatTimeToUtc(MONDAY, '09:00').toISOString()).toBe('2026-07-20T06:00:00.000Z');
    expect(utcToEatTime(new Date('2026-07-20T06:00:00.000Z'))).toBe('09:00');
    expect(eatDayOfWeek(MONDAY)).toBe(1);
  });

  it('a 23:00 EAT slot lands on the same EAT calendar date but 20:00 UTC', () => {
    const utc = eatTimeToUtc(MONDAY, '23:00');
    expect(utc.toISOString()).toBe('2026-07-20T20:00:00.000Z');
    expect(utcToEatDate(utc)).toBe(MONDAY);
  });

  it('early-morning EAT slots land on the PREVIOUS UTC calendar date', () => {
    const utc = eatTimeToUtc(MONDAY, '01:00');
    expect(utc.toISOString()).toBe('2026-07-19T22:00:00.000Z'); // Sunday in UTC
    expect(utcToEatDate(utc)).toBe(MONDAY); // still Monday in EAT
  });

  it('the EAT day range covers [21:00 previous UTC day, 21:00 this UTC day)', () => {
    const { start, end } = eatDayRangeUtc(MONDAY);
    expect(start.toISOString()).toBe('2026-07-19T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-20T21:00:00.000Z');
  });
});

describe('computeAvailability', () => {
  it('slices a window by slot duration', () => {
    const slots = computeAvailability({
      date: MONDAY,
      windows: [{ startTime: '09:00', endTime: '11:00', breaks: [], slotDurationMinutes: 30 }],
      booked: [],
      now: new Date('2026-07-19T12:00:00.000Z'),
    });
    expect(slots.map((slot) => slot.startEat)).toEqual(['09:00', '09:30', '10:00', '10:30']);
    expect(slots[0]!.startUtc).toBe('2026-07-20T06:00:00.000Z');
  });

  it('excludes slots that touch a break', () => {
    const slots = computeAvailability({
      date: MONDAY,
      windows: [
        {
          startTime: '09:00',
          endTime: '12:00',
          breaks: [{ startTime: '10:00', endTime: '10:30' }],
          slotDurationMinutes: 30,
        },
      ],
      booked: [],
      now: new Date('2026-07-19T12:00:00.000Z'),
    });
    expect(slots.map((slot) => slot.startEat)).toEqual(['09:00', '09:30', '10:30', '11:00', '11:30']);
  });

  it('excludes slots overlapping existing bookings (UTC comparison)', () => {
    const slots = computeAvailability({
      date: MONDAY,
      windows: [{ startTime: '09:00', endTime: '11:00', breaks: [], slotDurationMinutes: 30 }],
      booked: [{ scheduledAt: new Date('2026-07-20T06:30:00.000Z'), durationMinutes: 30 }], // 09:30 EAT
      now: new Date('2026-07-19T12:00:00.000Z'),
    });
    expect(slots.map((slot) => slot.startEat)).toEqual(['09:00', '10:00', '10:30']);
  });

  it('excludes past slots relative to the injected clock', () => {
    const slots = computeAvailability({
      date: MONDAY,
      windows: [{ startTime: '09:00', endTime: '11:00', breaks: [], slotDurationMinutes: 30 }],
      booked: [],
      now: new Date('2026-07-20T06:45:00.000Z'), // 09:45 EAT — 09:00/09:30 are gone
    });
    expect(slots.map((slot) => slot.startEat)).toEqual(['10:00', '10:30']);
  });

  it('handles a late window crossing into the next UTC day (23:00 EAT edge)', () => {
    const slots = computeAvailability({
      date: MONDAY,
      windows: [{ startTime: '22:00', endTime: '23:59', breaks: [], slotDurationMinutes: 30 }],
      booked: [],
      now: MORNING_UTC,
    });
    // 22:00, 22:30, 23:00 EAT fit (23:30 + 30min would exceed 23:59).
    expect(slots.map((slot) => slot.startEat)).toEqual(['22:00', '22:30', '23:00']);
    // The 23:00 EAT slot is 20:00 UTC on the SAME UTC date — not tomorrow.
    expect(slots[2]!.startUtc).toBe('2026-07-20T20:00:00.000Z');
  });

  it('a longer consultation duration reduces the slot count', () => {
    const slots = computeAvailability({
      date: MONDAY,
      windows: [{ startTime: '09:00', endTime: '11:00', breaks: [], slotDurationMinutes: 60 }],
      booked: [],
      now: MORNING_UTC,
    });
    expect(slots.map((slot) => slot.startEat)).toEqual(['10:00']); // 09:00 is past (== now)
  });
});
