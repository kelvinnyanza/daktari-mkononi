import Anthropic from '@anthropic-ai/sdk';
import {
  AiProviderError,
  BaseAi,
  type AiRequest,
  type AiResponse,
} from './port.js';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface AnthropicProviderOptions {
  apiKey: string | undefined;
  /** Model id; env AI_MODEL upstream, default claude-sonnet-4-6. */
  model?: string;
  timeoutMs?: number;
  /** Test hook. */
  client?: Anthropic;
}

/**
 * Anthropic implementation of AIProvider. Typed errors distinguish
 * RATE_LIMITED / TIMEOUT / PROVIDER_ERROR so the screening layer can degrade
 * gracefully without string-matching provider messages.
 */
export class AnthropicProvider extends BaseAi {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions) {
    super();
    if (!options.client && (options.apiKey === undefined || options.apiKey === '')) {
      throw new AiProviderError('PROVIDER_ERROR', 'ANTHROPIC_API_KEY is not set');
    }
    this.client =
      options.client ??
      new Anthropic({
        apiKey: options.apiKey,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, // milliseconds in the TS SDK
        maxRetries: 1,
      });
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  }

  async complete(request: AiRequest): Promise<AiResponse> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      });
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      return {
        text,
        stopReason: response.stop_reason ?? 'end_turn',
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      throw this.toTypedError(error);
    }
  }

  private toTypedError(error: unknown): AiProviderError {
    if (error instanceof AiProviderError) return error;
    if (error instanceof Anthropic.RateLimitError) {
      return new AiProviderError('RATE_LIMITED', 'provider rate limit exceeded', error);
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return new AiProviderError('TIMEOUT', 'provider request timed out', error);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      // Connection failures behave like timeouts for the caller: transient, retry later.
      return new AiProviderError('TIMEOUT', 'provider connection failed', error);
    }
    if (error instanceof Anthropic.APIError) {
      return new AiProviderError(
        'PROVIDER_ERROR',
        `provider error ${String(error.status)}: ${error.message}`,
        error,
      );
    }
    return new AiProviderError('PROVIDER_ERROR', 'unexpected provider failure', error);
  }
}
