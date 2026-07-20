import { describe, expect, it } from 'vitest';
import {
  aiScreeningMessageSchema,
  triageCheckSchema,
  triageLevelSchema,
} from '../src/screening.schema.js';

describe('aiScreeningMessageSchema', () => {
  it('accepts a valid message', () => {
    const parsed = aiScreeningMessageSchema.parse({
      message: 'Nina homa na kichwa kinauma tangu jana',
    });
    expect(parsed.message).toMatch(/homa/);
  });

  it('rejects messages over 500 characters', () => {
    expect(() => aiScreeningMessageSchema.parse({ message: 'a'.repeat(501) })).toThrowError(/500/);
  });

  it('rejects an empty message', () => {
    expect(() => aiScreeningMessageSchema.parse({ message: '   ' })).toThrow();
  });
});

describe('triageCheckSchema', () => {
  it('accepts a complete triage with a level', () => {
    const parsed = triageCheckSchema.parse({
      triageComplete: true,
      triageLevel: 'TELECONSULTATION',
      urgencyScore: 5,
      confidence: 0.8,
      rationale: 'Persistent fever needs remote review',
    });
    expect(parsed.triageLevel).toBe('TELECONSULTATION');
  });

  it('requires triageLevel when triageComplete is true', () => {
    expect(() =>
      triageCheckSchema.parse({
        triageComplete: true,
        urgencyScore: 5,
        confidence: 0.8,
        rationale: 'x',
      }),
    ).toThrowError(/triageLevel/);
  });

  it('accepts an incomplete triage without a level and bounds the scores', () => {
    const parsed = triageCheckSchema.parse({
      triageComplete: false,
      urgencyScore: 2,
      confidence: 0.4,
      rationale: 'Need more information',
    });
    expect(parsed.triageLevel).toBeUndefined();
    expect(() =>
      triageCheckSchema.parse({
        triageComplete: false,
        urgencyScore: 11,
        confidence: 0.4,
        rationale: 'x',
      }),
    ).toThrow();
  });
});

describe('triageLevelSchema', () => {
  it('covers exactly the four triage levels', () => {
    expect(triageLevelSchema.options).toEqual([
      'SELF_CARE',
      'TELECONSULTATION',
      'IN_PERSON_VISIT',
      'EMERGENCY',
    ]);
  });
});
