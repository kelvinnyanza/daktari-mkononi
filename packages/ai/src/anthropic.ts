import Anthropic from '@anthropic-ai/sdk';
import {
  AiProviderError,
  BaseAi,
  type AiRequest,
  type AiResponse,
} from './port.js';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * What a model accepts — the adapter sends nothing a model would 400 on.
 *
 * - sampling: temperature / top_p / top_k. Removed (non-default ⇒ 400) on
 *   Claude Sonnet 5.5 and the other 4.7+ / 5.x models.
 * - thinking: what to send so a short triage turn runs WITHOUT extended
 *   thinking (thinking tokens count against max_tokens and would eat the
 *   500-token reply). Sonnet 5.5: omitting `thinking` means adaptive ON and
 *   `{type:"disabled"}` is a 400 — `{type:"between_tools"}` is its lowest
 *   setting (valid at the default effort `high`, no other field allowed).
 *   Sonnet 4.6: omitting it already means no thinking.
 *
 * A new model id needs a row here (unknown ids get the conservative profile:
 * no sampling parameters, `thinking` omitted).
 */
export interface AnthropicModelProfile {
  sampling: boolean;
  thinking: Anthropic.ThinkingConfigParam | null;
}

const MODEL_PROFILES: Record<string, AnthropicModelProfile> = {
  'claude-sonnet-5-5': { sampling: false, thinking: { type: 'between_tools' } },
  'claude-sonnet-4-6': { sampling: true, thinking: null },
};

export function anthropicModelProfile(model: string): AnthropicModelProfile {
  return MODEL_PROFILES[model] ?? { sampling: false, thinking: null };
}

export interface AnthropicProviderOptions {
  apiKey: string | undefined;
  /** Model id; env AI_MODEL upstream, default claude-sonnet-5-5. */
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
    const profile = anthropicModelProfile(this.model);
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        ...(profile.thinking !== null ? { thinking: profile.thinking } : {}),
        ...(profile.sampling && request.temperature !== undefined ? { temperature: request.temperature } : {}),
      });
      // A safety decline is HTTP 200 with stop_reason "refusal" and no usable
      // text: surface it as a typed failure (never parse/retry an empty reply).
      if (response.stop_reason === 'refusal') {
        const category = response.stop_details?.category ?? 'unspecified';
        throw new AiProviderError('PROVIDER_ERROR', `provider declined the request (refusal: ${category})`);
      }
      // Read text blocks by type: a response may also carry thinking blocks.
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
