import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAiProvider } from '../src/factory.js';
import {
  DEFAULT_OPENAI_MODEL,
  OpenAiProvider,
  REASONING_HEADROOM_TOKENS,
  openAiModelProfile,
} from '../src/openai.js';
import { AiOutputInvalidError, type AiRequest } from '../src/port.js';

type CreateParams = OpenAI.Responses.ResponseCreateParamsNonStreaming;
type Outcome = Partial<OpenAI.Responses.Response> | Error;

/** Minimal stand-in for the SDK client: records params, replays outcomes. */
function stubClient(outcomes: Outcome[]): { client: OpenAI; calls: CreateParams[] } {
  const calls: CreateParams[] = [];
  const client = {
    responses: {
      create: (params: CreateParams) => {
        calls.push(params);
        const next = outcomes.shift();
        if (next === undefined) return Promise.reject(new Error('stub exhausted'));
        if (next instanceof Error) return Promise.reject(next);
        return Promise.resolve(next);
      },
    },
  } as unknown as OpenAI;
  return { client, calls };
}

const ok = (text: string, input = 120, output = 40): Partial<OpenAI.Responses.Response> => ({
  output_text: text,
  status: 'completed',
  incomplete_details: null,
  usage: {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  } as OpenAI.Responses.ResponseUsage,
});

const request: AiRequest = {
  system: 'Wewe ni msaidizi wa uchunguzi. Dharura: piga 112 au 115.',
  messages: [
    { role: 'user', content: 'Nina homa' },
    { role: 'assistant', content: 'Pole. Imeanza lini?' },
    { role: 'user', content: 'Jana' },
  ],
  maxTokens: 500,
  temperature: 0.2,
};

describe('openAiModelProfile', () => {
  it('maps known families and falls back to the conservative reasoning profile', () => {
    expect(openAiModelProfile('gpt-6.1-sol')).toBe('reasoning');
    expect(openAiModelProfile('gpt-6-astra')).toBe('reasoning');
    expect(openAiModelProfile('gpt-6.1-terra')).toBe('reasoning-none');
    expect(openAiModelProfile('gpt-6-luna')).toBe('reasoning-none');
    expect(openAiModelProfile('gpt-4.1-mini')).toBe('classic');
    expect(openAiModelProfile('gpt-4o')).toBe('classic');
    expect(openAiModelProfile('some-future-model')).toBe('reasoning');
  });
});

describe('OpenAiProvider request parameters', () => {
  it('default model is gpt-6.1-sol', () => {
    const { client } = stubClient([]);
    expect(new OpenAiProvider({ apiKey: undefined, client }).model).toBe(DEFAULT_OPENAI_MODEL);
    expect(DEFAULT_OPENAI_MODEL).toBe('gpt-6.1-sol');
  });

  it('always asks OpenAI not to store the request (store: false)', () => {
    const { client } = stubClient([]);
    for (const model of ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-4.1']) {
      expect(new OpenAiProvider({ apiKey: undefined, client, model }).buildParams(request).store).toBe(
        false,
      );
    }
  });

  it('reasoning models (no "none" effort): effort low, NO temperature, reasoning headroom', () => {
    const { client } = stubClient([]);
    const params = new OpenAiProvider({ apiKey: undefined, client, model: 'gpt-6.1-sol' }).buildParams(
      request,
    );
    expect(params.reasoning).toEqual({ effort: 'low' });
    expect('temperature' in params).toBe(false);
    expect('top_p' in params).toBe(false);
    expect(params.max_output_tokens).toBe(500 + REASONING_HEADROOM_TOKENS);
  });

  it('models that accept effort "none" turn reasoning off and keep temperature', () => {
    const { client } = stubClient([]);
    const params = new OpenAiProvider({ apiKey: undefined, client, model: 'gpt-6.1-terra' }).buildParams(
      request,
    );
    expect(params.reasoning).toEqual({ effort: 'none' });
    expect(params.temperature).toBe(0.2);
    expect(params.max_output_tokens).toBe(500);
  });

  it('classic models get no reasoning parameter at all', () => {
    const { client } = stubClient([]);
    const params = new OpenAiProvider({ apiKey: undefined, client, model: 'gpt-4.1' }).buildParams(
      request,
    );
    expect('reasoning' in params).toBe(false);
    expect(params.temperature).toBe(0.2);
  });

  it('system prompt goes to instructions; patient turns stay in user/assistant roles', () => {
    const { client } = stubClient([]);
    const params = new OpenAiProvider({ apiKey: undefined, client }).buildParams(request);
    expect(params.instructions).toBe(request.system);
    expect(params.input).toEqual(request.messages);
  });
});

describe('OpenAiProvider.complete', () => {
  it('returns text and maps usage into our AiUsage shape', async () => {
    const { client, calls } = stubClient([ok('Pole sana.', 321, 45)]);
    const ai = new OpenAiProvider({ apiKey: undefined, client });
    const response = await ai.complete(request);
    expect(response).toEqual({
      text: 'Pole sana.',
      stopReason: 'end_turn',
      usage: { inputTokens: 321, outputTokens: 45 },
    });
    expect(calls).toHaveLength(1);
  });

  it('empty output (e.g. reasoning used the whole budget) is a typed PROVIDER_ERROR', async () => {
    const { client } = stubClient([
      { ...ok(''), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    ]);
    await expect(new OpenAiProvider({ apiKey: undefined, client }).complete(request)).rejects.toMatchObject({
      name: 'AiProviderError',
      code: 'PROVIDER_ERROR',
    });
  });

  it('maps SDK errors to typed codes without echoing provider messages', async () => {
    const rate = new OpenAI.RateLimitError(429, undefined, 'slow down', new Headers());
    const timeout = new OpenAI.APIConnectionTimeoutError();
    const auth = new OpenAI.AuthenticationError(
      401,
      { type: 'invalid_request_error' },
      'Incorrect API key provided: sk-proj-****abcd',
      new Headers(),
    );
    const { client } = stubClient([rate, timeout, auth]);
    const ai = new OpenAiProvider({ apiKey: undefined, client });
    await expect(ai.complete(request)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(ai.complete(request)).rejects.toMatchObject({ code: 'TIMEOUT' });
    const error = await ai.complete(request).then(
      () => new Error('expected a rejection'),
      (e: unknown) => e as Error,
    );
    expect(error).toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(error.message).not.toMatch(/sk-/);
  });

  it('insufficient_quota (a 429) is a billing PROVIDER_ERROR, not a transient RATE_LIMITED', async () => {
    const quota = new OpenAI.RateLimitError(
      429,
      { type: 'insufficient_quota', code: 'insufficient_quota' },
      'You exceeded your current quota',
      new Headers(),
    );
    const { client } = stubClient([quota]);
    await expect(new OpenAiProvider({ apiKey: undefined, client }).complete(request)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: expect.stringMatching(/insufficient_quota/) as unknown,
    });
  });

  it('structured output runs the shared parse → one retry → AiOutputInvalidError path', async () => {
    const schema = z.object({ triageComplete: z.boolean() });
    const { client, calls } = stubClient([ok('not json'), ok('{"triageComplete":"yes"}')]);
    const ai = new OpenAiProvider({ apiKey: undefined, client });
    await expect(ai.completeStructured(request, schema)).rejects.toBeInstanceOf(AiOutputInvalidError);
    expect(calls).toHaveLength(2);
  });
});

describe('createAiProvider(openai)', () => {
  it('key ⇒ OpenAiProvider; no key ⇒ null', () => {
    expect(createAiProvider({ provider: 'openai', openaiApiKey: 'sk-test' })).toBeInstanceOf(OpenAiProvider);
    expect(createAiProvider({ provider: 'openai' })).toBeNull();
    // An Anthropic key never satisfies the OpenAI selection (no silent fallback).
    expect(createAiProvider({ provider: 'openai', anthropicApiKey: 'sk-ant' })).toBeNull();
  });
});
