import { describe, expect, it } from 'vitest';
import { createPrescriptionSchema } from '../src/prescription.schema.js';

const consultationId = 'clx1q2w3e4r5t6y7u8i9o0p1';

const paracetamol = {
  name: 'Paracetamol',
  dosage: '500 mg',
  frequency: 'mara 3 kwa siku',
  durationDays: 5,
  quantity: 15,
};

describe('createPrescriptionSchema', () => {
  it('accepts a valid prescription and defaults validityDays to 30', () => {
    const parsed = createPrescriptionSchema.parse({
      consultationId,
      medications: [paracetamol],
    });
    expect(parsed.validityDays).toBe(30);
    expect(parsed.medications).toHaveLength(1);
  });

  it('rejects an empty medication list', () => {
    expect(() =>
      createPrescriptionSchema.parse({ consultationId, medications: [] }),
    ).toThrowError(/at least one medication/);
  });

  it('rejects more than 20 medications', () => {
    const medications = Array.from({ length: 21 }, (_, index) => ({
      ...paracetamol,
      name: `Dawa ${index + 1}`,
    }));
    expect(() =>
      createPrescriptionSchema.parse({ consultationId, medications }),
    ).toThrowError(/at most 20/);
  });

  it('rejects out-of-range validityDays', () => {
    expect(() =>
      createPrescriptionSchema.parse({
        consultationId,
        medications: [paracetamol],
        validityDays: 0,
      }),
    ).toThrow();
    expect(() =>
      createPrescriptionSchema.parse({
        consultationId,
        medications: [paracetamol],
        validityDays: 120,
      }),
    ).toThrow();
  });

  it('rejects a medication with an invalid duration', () => {
    expect(() =>
      createPrescriptionSchema.parse({
        consultationId,
        medications: [{ ...paracetamol, durationDays: 0 }],
      }),
    ).toThrow();
  });
});
