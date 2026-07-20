/**
 * East Africa Time helpers. Tanzania is Africa/Dar_es_Salaam — a fixed UTC+3
 * with no daylight saving — so the conversion is pure arithmetic and needs no
 * timezone database. All timestamps are STORED in UTC; schedules and
 * availability are COMPUTED in EAT (see CLAUDE.md).
 */

export const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a YYYY-MM-DD string into its numeric parts (throws on bad input). */
function parseDateOnly(date: string): { year: number; month: number; day: number } {
  const match = DATE_ONLY.exec(date);
  if (!match) throw new Error(`not a YYYY-MM-DD date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Weekday (0 = Sunday … 6 = Saturday) of a calendar date in EAT. */
export function eatDayOfWeek(date: string): number {
  const { year, month, day } = parseDateOnly(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** UTC instant of `HH:mm` local EAT time on an EAT calendar date. */
export function eatTimeToUtc(date: string, timeHHmm: string): Date {
  const { year, month, day } = parseDateOnly(date);
  const [hours = 0, minutes = 0] = timeHHmm.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours, minutes) - EAT_OFFSET_MS);
}

/** UTC range [start, end) covering one full EAT calendar day. */
export function eatDayRangeUtc(date: string): { start: Date; end: Date } {
  const start = eatTimeToUtc(date, '00:00');
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** The EAT calendar date (YYYY-MM-DD) that a UTC instant falls on. */
export function utcToEatDate(instant: Date): string {
  const shifted = new Date(instant.getTime() + EAT_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/** The `HH:mm` EAT wall-clock time of a UTC instant. */
export function utcToEatTime(instant: Date): string {
  const shifted = new Date(instant.getTime() + EAT_OFFSET_MS);
  return shifted.toISOString().slice(11, 16);
}

/** Minutes since local EAT midnight for a `HH:mm` string. */
export function hhmmToMinutes(timeHHmm: string): number {
  const [hours = 0, minutes = 0] = timeHHmm.split(':').map(Number);
  return hours * 60 + minutes;
}
