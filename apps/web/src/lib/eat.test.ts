import { describe, expect, it } from 'vitest';
import { eatDateOf, eatDateTimeLabel, eatTimeLabel, formatTzs, shiftEatDate } from './eat';

describe('EAT conversion (UTC+3, no DST)', () => {
  it('renders a UTC instant as EAT wall-clock', () => {
    expect(eatTimeLabel('2026-07-20T06:00:00.000Z')).toBe('09:00');
  });

  it('handles the day-boundary case from CLAUDE.md: 23:00 EAT is 20:00 UTC', () => {
    expect(eatTimeLabel('2026-07-20T20:00:00.000Z')).toBe('23:00');
    expect(eatDateOf(new Date('2026-07-20T20:00:00.000Z'))).toBe('2026-07-20');
  });

  it('rolls the EAT calendar date forward after 21:00 UTC', () => {
    // 21:00 UTC is midnight EAT — already the next calendar day in Dar.
    expect(eatDateOf(new Date('2026-07-20T21:00:00.000Z'))).toBe('2026-07-21');
    expect(eatDateOf(new Date('2026-07-20T20:59:59.000Z'))).toBe('2026-07-20');
  });

  it('formats a full EAT timestamp', () => {
    expect(eatDateTimeLabel('2026-07-20T06:30:00.000Z')).toBe('20/07/2026 09:30');
  });

  it('shifts calendar dates without drifting across month ends', () => {
    expect(shiftEatDate('2026-07-31', 1)).toBe('2026-08-01');
    expect(shiftEatDate('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('does not apply a DST offset in either half of the year', () => {
    // Tanzania has no DST; January and July must convert identically.
    expect(eatTimeLabel('2026-01-15T06:00:00.000Z')).toBe('09:00');
    expect(eatTimeLabel('2026-07-15T06:00:00.000Z')).toBe('09:00');
  });
});

describe('formatTzs', () => {
  it('groups thousands and never shows decimals', () => {
    expect(formatTzs(30_000)).toBe('TSh 30,000');
    expect(formatTzs(1_250_000)).toBe('TSh 1,250,000');
    expect(formatTzs(500)).toBe('TSh 500');
  });

  it('handles zero and negatives', () => {
    expect(formatTzs(0)).toBe('TSh 0');
    expect(formatTzs(-2_500)).toBe('TSh -2,500');
  });
});
