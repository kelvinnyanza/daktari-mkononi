import { AnthropicProvider } from './anthropic.js';
import { OpenAiProvider } from './openai.js';
import type { AIProvider, AiProviderName } from './port.js';

export interface AiProviderConfig {
  provider: AiProviderName;
  /** env AI_MODEL; undefined ⇒ the selected provider's own default. */
  model?: string | undefined;
  anthropicApiKey?: string | undefined;
  openaiApiKey?: string | undefined;
}

/**
 * The single place a provider name becomes a concrete adapter.
 *
 * Returns null when the selected provider has no key: screening then answers
 * 503 AI_NOT_CONFIGURED rather than silently falling back to another backend.
 */
export function createAiProvider(config: AiProviderConfig): AIProvider | null {
  switch (config.provider) {
    case 'anthropic':
      return config.anthropicApiKey === undefined
        ? null
        : new AnthropicProvider({
            apiKey: config.anthropicApiKey,
            ...(config.model !== undefined ? { model: config.model } : {}),
          });
    case 'openai':
      return config.openaiApiKey === undefined
        ? null
        : new OpenAiProvider({
            apiKey: config.openaiApiKey,
            ...(config.model !== undefined ? { model: config.model } : {}),
          });
    case 'fake':
      throw new Error(`AI provider "${config.provider}" is not implemented yet`);
  }
}
