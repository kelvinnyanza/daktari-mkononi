import { AnthropicProvider } from './anthropic.js';
import { DevFakeAi } from './dev-fake.js';
import { OpenAiProvider } from './openai.js';
import type { AIProvider, AiProviderName } from './port.js';

export interface AiProviderConfig {
  provider: AiProviderName;
  /** env AI_MODEL; undefined ⇒ the selected provider's own default. */
  model?: string | undefined;
  anthropicApiKey?: string | undefined;
  openaiApiKey?: string | undefined;
  /** NODE_ENV === 'production'. The fake is refused here as well as by the boot guard. */
  production?: boolean;
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
      if (config.production === true) {
        throw new Error('AI_PROVIDER=fake is dev-only and refused in production');
      }
      return new DevFakeAi();
  }
}
