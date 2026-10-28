import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OpenAiProvider, type OpenAiProviderOptions } from '@daktari/ai';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import { SlidingWindowLimiter } from '../src/lib/rate-limiter.js';
import { ScreeningService } from '../src/modules/ai/screening.service.js';

/**
 * ScreeningService over REAL provider adapters (SDK client stubbed), proving
 * that what the service guarantees does not depend on which provider answers.
 */

const NOW = new Date('2026-07-16T09:00:00.000Z');

type StubResponse = { output_text: string; inputTokens?: number; outputTokens?: number };

/** Stand-in for the OpenAI SDK client: records params, replays outcomes. */
function stubOpenAiClient(outcomes: StubResponse[]): {
  client: NonNullable<OpenAiProviderOptions['client']>;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    responses: {
      create: (params: Record<string, unknown>) => {
        calls.push(params);
        const next = outcomes.shift();
        if (next === undefined) return Promise.reject(new Error('stub exhausted'));
        const input = next.inputTokens ?? 100;
        const output = next.outputTokens ?? 50;
        return Promise.resolve({
          output_text: next.output_text,
          status: 'completed',
          incomplete_details: null,
          usage: {
            input_tokens: input,
            output_tokens: output,
            total_tokens: input + output,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        });
      },
    },
  } as unknown as NonNullable<OpenAiProviderOptions['client']>;
  return { client, calls };
}

const INCOMPLETE_TRIAGE = JSON.stringify({
  triageComplete: false,
  urgencyScore: 3,
  confidence: 0.5,
  rationale: 'Need more information',
});

let deps: FakeDeps;
let limiter: SlidingWindowLimiter;

beforeAll(() => {
  applyTestEnv();
});

beforeEach(() => {
  deps = makeFakeDeps();
  limiter = new SlidingWindowLimiter(() => NOW);
});

function serviceWith(ai: FakeDeps['ai'] | OpenAiProvider): ScreeningService {
  return new ScreeningService({ ...deps, ai }, limiter, () => NOW);
}

describe('OpenAI provider through ScreeningService', () => {
  it('maps token usage into tokensUsed (what admin/ai-usage aggregates)', async () => {
    const { client } = stubOpenAiClient([
      { output_text: 'Pole sana. Homa imeanza lini?', inputTokens: 300, outputTokens: 60 },
      { output_text: INCOMPLETE_TRIAGE, inputTokens: 200, outputTokens: 40 },
    ]);
    const service = serviceWith(new OpenAiProvider({ apiKey: undefined, client }));
    const { user } = deps.seedPatient();
    const { sessionId } = await service.startSession(user.id);

    const reply = await service.handleMessage(user.id, sessionId, 'Nina homa tangu jana');
    expect(reply).toMatchObject({ status: 'ACTIVE', reply: 'Pole sana. Homa imeanza lini?' });
    expect(deps.state.screenings.get(sessionId)!.tokensUsed).toBe(600);
    expect((await service.usageSummary()).tokensUsed).toBe(600);
  });

  it('invalid structured output twice → same safe failure as Anthropic: hiccup, ACTIVE, audited', async () => {
    const { client, calls } = stubOpenAiClient([
      { output_text: 'Asante.' },
      { output_text: 'broken{' },
      { output_text: '{"triageComplete":"maybe"}' }, // parses, fails triageCheckSchema
    ]);
    const service = serviceWith(new OpenAiProvider({ apiKey: undefined, client }));
    const { user } = deps.seedPatient();
    const { sessionId } = await service.startSession(user.id);

    const reply = await service.handleMessage(user.id, sessionId, 'Nina kizunguzungu');
    expect(reply.status).toBe('ACTIVE');
    expect(reply.reply).toMatch(/hitilafu ya kiufundi/);
    expect(reply.triage).toBeUndefined();
    expect(deps.state.screenings.get(sessionId)!.status).toBe('ACTIVE');
    expect(
      deps.state.auditEntries.some((entry) => entry.action === 'SCREENING_TRIAGE_CHECK_FAILED'),
    ).toBe(true);
    expect(calls).toHaveLength(3); // one reply + exactly one structured retry
  });

  it('every OpenAI call carries store: false (patient data is not retained)', async () => {
    const { client, calls } = stubOpenAiClient([
      { output_text: 'Pole.' },
      { output_text: INCOMPLETE_TRIAGE },
    ]);
    const service = serviceWith(new OpenAiProvider({ apiKey: undefined, client }));
    const { user } = deps.seedPatient();
    const { sessionId } = await service.startSession(user.id);
    await service.handleMessage(user.id, sessionId, 'Nina kikohozi');
    expect(calls).toHaveLength(2);
    expect(calls.every((params) => params.store === false)).toBe(true);
  });
});
