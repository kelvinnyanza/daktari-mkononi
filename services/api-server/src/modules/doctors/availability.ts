import { eatTimeToUtc, hhmmToMinutes, utcToEatTime } from '../../lib/eat-time.js';

/**
 * Pure availability computation for one doctor on one EAT calendar date:
 * schedule windows for that weekday, minus breaks, minus slot-holding
 * appointments, sliced by the window's slot duration, past slots excluded.
 * Times are stored UTC and computed in Africa/Dar_es_Salaam (UTC+3, no DST).
 */

export interface ScheduleWindowInput {
  startTime: string; // HH:mm EAT
  endTime: string;
  breaks: Array<{ startTime: string; endTime: string }>;
  slotDurationMinutes: number;
}

export interface BookedInterval {
  scheduledAt: Date; // UTC
  durationMinutes: number;
}

export interface AvailabilitySlot {
  /** UTC instant to POST back as scheduledAt. */
  startUtc: string;
  /** EAT wall-clock label for display (HH:mm). */
  startEat: string;
  durationMinutes: number;
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
  aStart < bEnd && bStart < aEnd;

export function computeAvailability(input: {
  date: string; // YYYY-MM-DD, EAT calendar date
  windows: ScheduleWindowInput[];
  booked: BookedInterval[];
  now: Date;
}): AvailabilitySlot[] {
  const slots: AvailabilitySlot[] = [];
  const bookedUtc = input.booked.map((interval) => ({
    start: interval.scheduledAt.getTime(),
    end: interval.scheduledAt.getTime() + interval.durationMinutes * 60_000,
  }));

  for (const window of input.windows) {
    const windowStart = hhmmToMinutes(window.startTime);
    const windowEnd = hhmmToMinutes(window.endTime);
    const breaks = window.breaks.map((b) => ({
      start: hhmmToMinutes(b.startTime),
      end: hhmmToMinutes(b.endTime),
    }));

    for (
      let slotStart = windowStart;
      slotStart + window.slotDurationMinutes <= windowEnd;
      slotStart += window.slotDurationMinutes
    ) {
      const slotEnd = slotStart + window.slotDurationMinutes;
      if (breaks.some((b) => overlaps(slotStart, slotEnd, b.start, b.end))) continue;

      const startUtc = eatTimeToUtc(
        input.date,
        `${String(Math.floor(slotStart / 60)).padStart(2, '0')}:${String(slotStart % 60).padStart(2, '0')}`,
      );
      if (startUtc.getTime() <= input.now.getTime()) continue;

      const endUtcMs = startUtc.getTime() + window.slotDurationMinutes * 60_000;
      if (bookedUtc.some((b) => overlaps(startUtc.getTime(), endUtcMs, b.start, b.end))) continue;

      slots.push({
        startUtc: startUtc.toISOString(),
        startEat: utcToEatTime(startUtc),
        durationMinutes: window.slotDurationMinutes,
      });
    }
  }

  return slots.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}
