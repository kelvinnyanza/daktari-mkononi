import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AiOutputInvalidError, extractJson } from '../src/port.js';
import { FakeAi } from '../src/fake.js';

const triageSchema = z.object({
  triageComplete: z.boolean(),
  urgencyScore: z.number().min(0).max(10),
});

const request = {
  system: 'You are a triage assistant.',
  messages: [{ role: 'user' as const, content: 'Nina homa' }],
  maxTokens: 500,
};

describe('extractJson', () => {
  it('passes bare JSON through and strips fences/prose', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Here you go:\n{"a": 1}\nHope that helps!')).toBe('{"a": 1}');
  });
});

describe('completeStructured', () => {
  it('parses valid JSON on the first attempt (no retry)', async () => {
    const ai = new FakeAi().replyJson({ triageComplete: false, urgencyScore: 3 });
    const result = await ai.completeStructured(request, triageSchema);
    expect(result.value).toEqual({ triageComplete: false, urgencyScore: 3 });
    expect(result.retried).toBe(false);
    expect(ai.callCount).toBe(1);
    // The JSON-only directive is appended to the system prompt.
    expect(ai.requests[0]!.system).toMatch(/ONLY a single valid JSON object/);
  });

  it('retries ONCE with validation errors appended, then succeeds', async () => {
    const ai = new FakeAi()
      .reply('sure! { "triageComplete": "yes" }') // invalid: wrong type
      .replyJson({ triageComplete: true, urgencyScore: 7 });

    const result = await ai.completeStructured(request, triageSchema);
    expect(result.value.urgencyScore).toBe(7);
    expect(result.retried).toBe(true);
    expect(ai.callCount).toBe(2);

    // The retry carries the invalid output and the validation errors.
    const retry = ai.requests[1]!;
    expect(retry.messages.at(-2)?.role).toBe('assistant');
    expect(retry.messages.at(-1)?.content).toMatch(/was not valid/);
    expect(retry.messages.at(-1)?.content).toMatch(/triageComplete/);

    // Usage accumulates across both attempts.
    expect(result.usage.inputTokens).toBe(200);
    expect(result.usage.outputTokens).toBe(100);
  });

  it('throws AiOutputInvalidError after a second failure', async () => {
    const ai = new FakeAi().reply('not json at all').reply('still {broken');
    await expect(ai.completeStructured(request, triageSchema)).rejects.toBeInstanceOf(
      AiOutputInvalidError,
    );
    expect(ai.callCount).toBe(2); // exactly one retry, never more
  });

  it('propagates typed provider errors without retrying', async () => {
    const ai = new FakeAi().fail('RATE_LIMITED');
    await expect(ai.completeStructured(request, triageSchema)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(ai.callCount).toBe(1);
  });
});
