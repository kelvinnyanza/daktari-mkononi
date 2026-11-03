import { describe, expect, it } from 'vitest';
import { canStartConsultation, consultationOpensAt } from './consultation-rules';

describe('consultation start window mirror', () => {
  const slot = '2026-11-03T07:00:00.000Z'; // 10:00 EAT
  it('opens 15 minutes before the slot, not earlier', () => {
    expect(consultationOpensAt(slot).toISOString()).toBe('2026-11-03T06:45:00.000Z');
    expect(canStartConsultation(slot, new Date('2026-11-03T06:44:59.000Z'))).toBe(false);
    expect(canStartConsultation(slot, new Date('2026-11-03T06:45:00.000Z'))).toBe(true);
    expect(canStartConsultation(slot, new Date('2026-11-03T09:00:00.000Z'))).toBe(true); // late is fine
  });
});
