import { buildDateStrip, eatDateOf, eatTimeLabel, formatCountdown, secondsUntil } from './datetime';
import { formatTzs } from './money';

// Fixed fake clock: 2026-07-20T20:30:00Z == 23:30 EAT on the 20th.
const FAKE_NOW = new Date('2026-07-20T20:30:00.000Z');

describe('EAT rendering (fixed fake clock)', () => {
  it('renders UTC slots as EAT wall-clock', () => {
    expect(eatTimeLabel('2026-07-20T06:00:00.000Z')).toBe('09:00'); // 06:00 UTC → 09:00 EAT
    expect(eatTimeLabel('2026-07-20T20:00:00.000Z')).toBe('23:00'); // late slot, same EAT day
  });

  it('maps late-UTC instants to the NEXT EAT calendar date', () => {
    expect(eatDateOf(new Date('2026-07-20T20:30:00.000Z'))).toBe('2026-07-20'); // 23:30 EAT
    expect(eatDateOf(new Date('2026-07-20T21:30:00.000Z'))).toBe('2026-07-21'); // 00:30 EAT next day
  });

  it('the 7-day strip starts on the EAT today, even when UTC is still yesterday evening', () => {
    const strip = buildDateStrip(FAKE_NOW, 7);
    expect(strip).toHaveLength(7);
    expect(strip[0]!.date).toBe('2026-07-20'); // 23:30 EAT — still the 20th
    expect(strip[6]!.date).toBe('2026-07-26');

    // 30 minutes later it is 00:00 EAT on the 21st — the strip rolls over.
    const rolled = buildDateStrip(new Date('2026-07-20T21:00:00.000Z'), 7);
    expect(rolled[0]!.date).toBe('2026-07-21');
  });

  it('countdowns clamp at zero and format mm:ss', () => {
    expect(secondsUntil('2026-07-20T20:35:00.000Z', FAKE_NOW)).toBe(300);
    expect(secondsUntil('2026-07-20T20:00:00.000Z', FAKE_NOW)).toBe(0); // already past
    expect(formatCountdown(300)).toBe('05:00');
    expect(formatCountdown(61)).toBe('01:01');
    expect(formatCountdown(0)).toBe('00:00');
  });
});

describe('TZS formatting', () => {
  it.each([
    [30_000, 'TSh 30,000'],
    [25_001, 'TSh 25,001'],
    [1_000_000, 'TSh 1,000,000'],
    [500, 'TSh 500'],
    [0, 'TSh 0'],
  ])('%d → %s', (amount, expected) => {
    expect(formatTzs(amount)).toBe(expected);
  });
});
