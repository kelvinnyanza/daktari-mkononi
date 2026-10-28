import { describe, expect, it } from 'vitest';
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from '../src/anthropic.js';
import { createAiProvider } from '../src/factory.js';

describe('createAiProvider', () => {
  it('anthropic + key ⇒ AnthropicProvider with its default model', () => {
    const ai = createAiProvider({ provider: 'anthropic', anthropicApiKey: 'sk-ant-test' });
    expect(ai).toBeInstanceOf(AnthropicProvider);
    expect(ai?.name).toBe('anthropic');
    expect(ai?.model).toBe(DEFAULT_ANTHROPIC_MODEL);
  });

  it('honours an explicit model', () => {
    const ai = createAiProvider({
      provider: 'anthropic',
      anthropicApiKey: 'sk-ant-test',
      model: 'claude-opus-4-1',
    });
    expect(ai?.model).toBe('claude-opus-4-1');
  });

  it('anthropic without a key ⇒ null (screening answers 503)', () => {
    expect(createAiProvider({ provider: 'anthropic' })).toBeNull();
  });
});
