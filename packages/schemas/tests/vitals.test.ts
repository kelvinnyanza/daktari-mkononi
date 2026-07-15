import { describe, expect, it } from 'vitest';
import { recordVitalsSchema } from '../src/vitals.schema.js';

const patientId = 'clx1q2w3e4r5t6y7u8i9o0p1';

describe('recordVitalsSchema', () => {
  it('accepts a normal set of readings', () => {
    const parsed = recordVitalsSchema.parse({
      patientId,
      systolicBp: 120,
      diastolicBp: 80,
      heartRate: 72,
      temperatureC: 36.8,
      oxygenSaturation: 98,
    });
    expect(parsed.systolicBp).toBe(120);
  });

  it('accepts a single reading', () => {
    expect(recordVitalsSchema.parse({ patientId, temperatureC: 38.5 }).temperatureC).toBe(38.5);
  });

  it('rejects an entry with no readings at all', () => {
    expect(() => recordVitalsSchema.parse({ patientId, notes: 'anaumwa kichwa' })).toThrowError(
      /at least one vital sign/,
    );
  });

  it('rejects physiologically impossible values', () => {
    expect(() => recordVitalsSchema.parse({ patientId, temperatureC: 50 })).toThrow();
    expect(() => recordVitalsSchema.parse({ patientId, heartRate: 400 })).toThrow();
    expect(() => recordVitalsSchema.parse({ patientId, oxygenSaturation: 101 })).toThrow();
    expect(() =>
      recordVitalsSchema.parse({ patientId, systolicBp: 20, diastolicBp: 10 }),
    ).toThrow();
  });

  it('requires both halves of a blood pressure reading', () => {
    expect(() => recordVitalsSchema.parse({ patientId, systolicBp: 120 })).toThrowError(
      /both systolic and diastolic/,
    );
  });

  it('rejects systolic <= diastolic', () => {
    expect(() =>
      recordVitalsSchema.parse({ patientId, systolicBp: 80, diastolicBp: 120 }),
    ).toThrowError(/systolic must be greater/);
  });

  it('rejects a future recordedAt', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(() =>
      recordVitalsSchema.parse({ patientId, heartRate: 70, recordedAt: tomorrow }),
    ).toThrowError(/future/);
  });
});
