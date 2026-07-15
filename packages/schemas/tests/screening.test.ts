import { describe, expect, it } from 'vitest';
import { aiScreeningMessageSchema, triageLevelSchema } from '../src/screening.schema.js';

const sessionId = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff';

describe('aiScreeningMessageSchema', () => {
  it('accepts a valid message and defaults language to Swahili', () => {
    const parsed = aiScreeningMessageSchema.parse({
      sessionId,
      message: 'Nina homa na kichwa kinauma tangu jana',
    });
    expect(parsed.language).toBe('sw');
  });

  it('accepts explicit English', () => {
    const parsed = aiScreeningMessageSchema.parse({
      sessionId,
      message: 'I have a fever and headache',
      language: 'en',
    });
    expect(parsed.language).toBe('en');
  });

  it('rejects messages over 500 characters', () => {
    expect(() =>
      aiScreeningMessageSchema.parse({ sessionId, message: 'a'.repeat(501) }),
    ).toThrowError(/500/);
  });

  it('rejects an empty message and a non-UUID sessionId', () => {
    expect(() => aiScreeningMessageSchema.parse({ sessionId, message: '   ' })).toThrow();
    expect(() =>
      aiScreeningMessageSchema.parse({ sessionId: 'session-1', message: 'homa' }),
    ).toThrow();
  });

  it('rejects unsupported languages', () => {
    expect(() =>
      aiScreeningMessageSchema.parse({ sessionId, message: 'bonjour', language: 'fr' }),
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
