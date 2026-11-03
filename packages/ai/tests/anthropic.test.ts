import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL, anthropicModelProfile } from '../src/anthropic.js';
import { AiProviderError } from '../src/port.js';

type CreateParams = Anthropic.MessageCreateParamsNonStreaming;

/** Stand-in for the SDK client: records params, replays one response. */
function stubClient(response: Partial<Anthropic.Message>): { client: Anthropic; calls: CreateParams[] } {
  const calls: CreateParams[] = [];
  const client = {
    messages: {
      create: (params: CreateParams) => {
        calls.push(params);
        return Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_details: null,
          usage: { input_tokens: 10, output_tokens: 2 },
          ...response,
        });
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const request = {
  system: 'Wewe ni msaidizi wa uchunguzi wa awali.',
  messages: [{ role: 'user' as const, content: 'Nina homa' }],
  maxTokens: 500,
  temperature: 0.2,
};

describe('AnthropicProvider — only parameters the model accepts (13b)', () => {
  it('defaults to claude-sonnet-5-5', () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe('claude-sonnet-5-5');
  });

  it('Sonnet 5.5: no temperature/top_p/top_k (400 there), thinking between_tools (its "off"), nothing else', async () => {
    const { client, calls } = stubClient({});
    const ai = new AnthropicProvider({ apiKey: 'k', client });
    await ai.complete(request);
    const params = calls[0]!;
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.thinking).toEqual({ type: 'between_tools' });
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('top_p');
    expect(params).not.toHaveProperty('top_k');
    expect(params).not.toHaveProperty('tool_choice');
    expect(Object.keys(params).sort()).toEqual(['max_tokens', 'messages', 'model', 'system', 'thinking']);
  });

  it('Sonnet 4.6 (switch back by AI_MODEL): keeps temperature, omits thinking (already off there)', async () => {
    const { client, calls } = stubClient({});
    const ai = new AnthropicProvider({ apiKey: 'k', client, model: 'claude-sonnet-4-6' });
    await ai.complete(request);
    expect(calls[0]).toMatchObject({ model: 'claude-sonnet-4-6', temperature: 0.2 });
    expect(calls[0]).not.toHaveProperty('thinking');
  });

  it('an unknown model id gets the conservative profile: no sampling, thinking omitted', () => {
    expect(anthropicModelProfile('claude-something-new')).toEqual({ sampling: false, thinking: null });
  });

  it('reads text blocks by type (a thinking block first is ignored)', async () => {
    const { client } = stubClient({
      content: [
        { type: 'thinking', thinking: 'progress note', signature: 's' },
        { type: 'text', text: 'Pumzika, kunywa maji.' },
      ] as Anthropic.ContentBlock[],
    });
    const result = await new AnthropicProvider({ apiKey: 'k', client }).complete(request);
    expect(result.text).toBe('Pumzika, kunywa maji.');
  });

  it('stop_reason "refusal" → typed PROVIDER_ERROR naming the category (never an empty reply to parse)', async () => {
    const { client } = stubClient({
      content: [],
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'bio', explanation: null } as Anthropic.Message['stop_details'],
    });
    const failure = new AnthropicProvider({ apiKey: 'k', client }).complete(request);
    await expect(failure).rejects.toBeInstanceOf(AiProviderError);
    await expect(failure).rejects.toMatchObject({ code: 'PROVIDER_ERROR', message: expect.stringContaining('refusal: bio') });
  });
});
