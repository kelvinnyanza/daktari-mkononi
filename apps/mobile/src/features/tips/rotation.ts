/**
 * The Home carousel shows a rotating set, not every tip: the top few
 * (highest priority / newest — the server's order) always, plus a slice of
 * the rest that moves on every day, so a returning patient sees something
 * new each day without 100 dots. Pure and date-driven (EAT calendar day).
 */
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function eatDayNumber(now: Date): number {
  return Math.floor((now.getTime() + EAT_OFFSET_MS) / DAY_MS);
}

export function dailySet<T>(ordered: readonly T[], now: Date, size = 10, pinned = 3): T[] {
  if (ordered.length <= size) return [...ordered];
  const fixed = ordered.slice(0, pinned);
  const rest = ordered.slice(pinned);
  const take = size - fixed.length;
  const start = (eatDayNumber(now) * take) % rest.length;
  const rotating = Array.from({ length: take }, (_, i) => rest[(start + i) % rest.length]!);
  return [...fixed, ...rotating];
}
