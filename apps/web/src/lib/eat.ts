/**
 * EAT rendering for the portal. Tanzania is UTC+3 with no DST, so wall-clock
 * conversion is pure arithmetic — the same rule as the server's eat-time.ts
 * and the mobile app's datetime.ts. No tz database, no Intl timezone calls
 * (which would silently follow the operator's laptop timezone instead).
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

/** "dd/MM/yyyy HH:mm" EAT — table rendering. */
export function eatDateTimeLabel(utcIso: string): string {
  const shifted = new Date(new Date(utcIso).getTime() + EAT_OFFSET_MS).toISOString();
  return `${shifted.slice(8, 10)}/${shifted.slice(5, 7)}/${shifted.slice(0, 4)} ${shifted.slice(11, 16)}`;
}

/** "dd/MM/yyyy" EAT. */
export function eatDateLabel(utcIso: string): string {
  const shifted = new Date(new Date(utcIso).getTime() + EAT_OFFSET_MS).toISOString();
  return `${shifted.slice(8, 10)}/${shifted.slice(5, 7)}/${shifted.slice(0, 4)}`;
}

/** Shift a YYYY-MM-DD EAT calendar date by whole days. */
export function shiftEatDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`).getTime() + days * 24 * 60 * 60 * 1000;
  return new Date(shifted).toISOString().slice(0, 10);
}

/** Weekday index (0 = Sunday) for a YYYY-MM-DD EAT calendar date. */
export function eatWeekday(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

/** Money display: whole TZS, "TSh 30,000" — never decimals (see CLAUDE.md). */
export function formatTzs(amountTzs: number): string {
  const digits = Math.trunc(Math.abs(amountTzs)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `TSh ${amountTzs < 0 ? '-' : ''}${grouped}`;
}
