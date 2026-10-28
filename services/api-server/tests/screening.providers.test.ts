import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEV_FAKE_MARKER,
  DevFakeAi,
  OpenAiProvider,
  type AIProvider,
  type OpenAiProviderOptions,
} from '@daktari/ai';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import { SlidingWindowLimiter } from '../src/lib/rate-limiter.js';
import { MESSAGES_PER_HOUR, ScreeningService } from '../src/modules/ai/screening.service.js';
import { buildScreeningSystemPrompt, toAgeBand } from '../src/modules/ai/prompts.js';

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

function serviceWith(ai: AIProvider): ScreeningService {
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

/**
 * The emergency keyword pre-screen is provider-independent: it runs BEFORE the
 * rate limit and BEFORE any provider call, whichever provider is selected.
 */
describe.each([
  {
    label: 'openai',
    build: () => {
      const { client, calls } = stubOpenAiClient([]);
      return { ai: new OpenAiProvider({ apiKey: undefined, client }), providerCalls: () => calls.length };
    },
  },
  {
    label: 'fake',
    build: () => {
      const ai = new DevFakeAi();
      const spy = vi.spyOn(ai, 'complete');
      return { ai, providerCalls: () => spy.mock.calls.length };
    },
  },
])('emergency pre-screen with AI_PROVIDER=$label', ({ build }) => {
  it.each([
    ['Swahili', 'Nina maumivu ya kifua na jasho jingi'],
    ['English', 'I have severe chest pain since morning'],
  ])('%s emergency → 112/115 completion with zero provider calls', async (_lang, message) => {
    const { ai, providerCalls } = build();
    const service = serviceWith(ai);
    const { user } = deps.seedPatient();
    const { sessionId } = await service.startSession(user.id);

    const reply = await service.handleMessage(user.id, sessionId, message);
    expect(providerCalls()).toBe(0);
    expect(reply.status).toBe('COMPLETED');
    expect(reply.triage?.triageLevel).toBe('EMERGENCY');
    expect(reply.reply).toContain('112');
    expect(reply.reply).toContain('115');
    expect(deps.state.screenings.get(sessionId)!.escalatedToEmergency).toBe(true);
  });

  it('runs BEFORE the rate limit: an exhausted patient still gets 112/115, never a 429', async () => {
    const { ai, providerCalls } = build();
    const service = serviceWith(ai);
    const { user, patient } = deps.seedPatient();
    const { sessionId } = await service.startSession(user.id);
    for (let i = 0; i < MESSAGES_PER_HOUR; i += 1) {
      limiter.tryAcquire(`screening-msg:${patient.id}`, MESSAGES_PER_HOUR, 60 * 60_000);
    }

    const reply = await service.handleMessage(user.id, sessionId, 'maumivu ya kifua');
    expect(reply.status).toBe('COMPLETED');
    expect(reply.triage?.triageLevel).toBe('EMERGENCY');
    expect(reply.reply).toContain('112');
    expect(providerCalls()).toBe(0);
  });
});

describe('one source of truth for the system prompt', () => {
  it('every provider receives the identical Swahili prompt with the 112/115 rule', async () => {
    const { client, calls } = stubOpenAiClient([
      { output_text: 'Pole.' },
      { output_text: INCOMPLETE_TRIAGE },
    ]);
    const openai = new OpenAiProvider({ apiKey: undefined, client });
    const fake = new DevFakeAi();
    const fakeSpy = vi.spyOn(fake, 'complete');
    const { user, patient } = deps.seedPatient();

    for (const ai of [openai, fake]) {
      const service = serviceWith(ai);
      const { sessionId } = await service.startSession(user.id);
      await service.handleMessage(user.id, sessionId, 'Nina homa');
    }

    const expected = buildScreeningSystemPrompt('sw', {
      ageBand: toAgeBand(patient.dateOfBirth, NOW),
      gender: patient.gender,
      chronicConditions: patient.chronicConditions,
      allergies: patient.allergies,
    });
    const openaiSystem = calls[0]!.instructions as string;
    const fakeSystem = fakeSpy.mock.calls[0]![0].system;
    // Both providers get exactly the prompt prompts.ts builds — nothing provider-specific.
    expect(openaiSystem).toBe(expected);
    expect(fakeSystem).toBe(expected);
    expect(openaiSystem).toContain('112');
    expect(openaiSystem).toContain('115');
    expect(openaiSystem).not.toMatch(/\b(999|911|114)\b/);
  });
});

describe('DevFakeAi through ScreeningService', () => {
  it('[JARIBIO] replies, then a schema-valid TELECONSULTATION result with suggested doctors', async () => {
    const service = serviceWith(new DevFakeAi());
    const { user } = deps.seedPatient();
    const { sessionId } = await service.startSession(user.id);

    const first = await service.handleMessage(user.id, sessionId, 'Nina homa');
    expect(first.status).toBe('ACTIVE');
    expect(first.reply.startsWith(DEV_FAKE_MARKER)).toBe(true);

    const second = await service.handleMessage(user.id, sessionId, 'Tangu jana');
    expect(second.status).toBe('COMPLETED');
    expect(second.reply.startsWith(DEV_FAKE_MARKER)).toBe(true);
    expect(second.triage).toMatchObject({
      triageLevel: 'TELECONSULTATION',
      recommendedSpecialty: 'GENERAL_PRACTICE',
    });
    expect(second.suggestedDoctors).toBeDefined();
    expect(deps.state.screenings.get(sessionId)!.tokensUsed).toBeGreaterThan(0);
  });
});
