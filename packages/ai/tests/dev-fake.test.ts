import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEV_FAKE_MARKER, DevFakeAi } from '../src/dev-fake.js';
import { createAiProvider } from '../src/factory.js';

// Mirror of @daktari/schemas triageCheckSchema (that package is not a
// dependency here); the api-server tests run the real one through the service.
const triageCheckSchema = z
  .object({
    triageComplete: z.boolean(),
    triageLevel: z.enum(['SELF_CARE', 'TELECONSULTATION', 'IN_PERSON', 'EMERGENCY']).optional(),
    urgencyScore: z.number().min(0).max(10),
    suggestedSpecialty: z.string().max(100).optional(),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(500),
  })
  .refine((value) => !value.triageComplete || value.triageLevel !== undefined);

const triageRequest = (patientTurns: number) => ({
  system: 'Triage check',
  messages: [
    {
      role: 'user' as const,
      content: Array.from({ length: patientTurns }, (_, i) => `PATIENT: dalili ${i}\nASSISTANT: sawa`).join(
        '\n',
      ),
    },
  ],
  maxTokens: 500,
});

describe('DevFakeAi', () => {
  it('conversation replies are short Swahili text marked [JARIBIO]', async () => {
    const reply = await new DevFakeAi().complete({
      system: 'Wewe ni msaidizi',
      messages: [{ role: 'user', content: 'Nina homa' }],
      maxTokens: 500,
    });
    expect(reply.text.startsWith(DEV_FAKE_MARKER)).toBe(true);
    expect(reply.text).toMatch(/majaribio/);
    expect(reply.text.length).toBeLessThan(200);
    expect(reply.usage.inputTokens + reply.usage.outputTokens).toBeGreaterThan(0);
  });

  it('structured triage is schema-valid: incomplete first, TELECONSULTATION after 2 patient turns', async () => {
    const ai = new DevFakeAi();
    const first = await ai.completeStructured(triageRequest(1), triageCheckSchema);
    expect(first.retried).toBe(false);
    expect(first.value.triageComplete).toBe(false);
    expect(first.value.rationale.startsWith(DEV_FAKE_MARKER)).toBe(true);

    const second = await ai.completeStructured(triageRequest(2), triageCheckSchema);
    expect(second.value).toMatchObject({
      triageComplete: true,
      triageLevel: 'TELECONSULTATION',
      suggestedSpecialty: 'GENERAL_PRACTICE',
    });
  });

  it('factory: fake is built in dev and refused in production', () => {
    expect(createAiProvider({ provider: 'fake' })).toBeInstanceOf(DevFakeAi);
    expect(createAiProvider({ provider: 'fake' })?.name).toBe('fake');
    expect(() => createAiProvider({ provider: 'fake', production: true })).toThrow(/dev-only/);
  });
});
