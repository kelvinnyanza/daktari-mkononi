/**
 * EAT rendering — Tanzania is UTC+3 with no DST, so wall-clock conversion is
 * pure arithmetic (mirrors the server's eat-time.ts; no tz database).
 */
export const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** HH:mm EAT wall-clock for a UTC instant. */
export function eatTimeLabel(utcIso: string): string {
  return new Date(new Date(utcIso).getTime() + EAT_OFFSET_MS).toISOString().slice(11, 16);
}

/** YYYY-MM-DD EAT calendar date for a UTC instant. */
export function eatDateOf(utc: Date): string {
  return new Date(utc.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

/** "dd/MM HH:mm" EAT — compact list rendering. */
export function eatDateTimeLabel(utcIso: string): string {
  const shifted = new Date(new Date(utcIso).getTime() + EAT_OFFSET_MS).toISOString();
  return `${shifted.slice(8, 10)}/${shifted.slice(5, 7)} ${shifted.slice(11, 16)}`;
}

export interface DateStripDay {
  /** YYYY-MM-DD in EAT — what the availability endpoint expects. */
  date: string;
  /** Short weekday index 0-6 (Sun-Sat) for localized labels. */
  weekday: number;
  /** Day-of-month for display. */
  dayOfMonth: number;
}

/** The next `days` EAT calendar days starting today (EAT). */
export function buildDateStrip(now: Date, days = 7): DateStripDay[] {
  const strip: DateStripDay[] = [];
  const startEat = new Date(now.getTime() + EAT_OFFSET_MS);
  for (let i = 0; i < days; i += 1) {
    const day = new Date(startEat.getTime() + i * 24 * 60 * 60 * 1000);
    strip.push({
      date: day.toISOString().slice(0, 10),
      weekday: day.getUTCDay(),
      dayOfMonth: day.getUTCDate(),
    });
  }
  return strip;
}

/** Seconds remaining until a UTC ISO deadline (never negative). */
export function secondsUntil(utcIso: string, now: Date): number {
  return Math.max(0, Math.floor((new Date(utcIso).getTime() - now.getTime()) / 1000));
}

/** mm:ss for countdowns. */
export function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
