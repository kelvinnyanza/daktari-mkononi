import OpenAI from 'openai';
import {
  AiProviderError,
  BaseAi,
  type AiRequest,
  type AiResponse,
} from './port.js';

/**
 * OpenAI's own "start here" general-purpose model (Using GPT-6 guide, Oct
 * 2026): standard access, no verification or access request needed.
 */
export const DEFAULT_OPENAI_MODEL = 'gpt-6.1-sol';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Reasoning tokens are billed as output and count against max_output_tokens.
 * Without headroom a 500-token turn cap can be spent entirely on reasoning,
 * leaving an empty reply — so reasoning profiles get this much on top.
 */
export const REASONING_HEADROOM_TOKENS = 1_500;

/**
 * What a model accepts, decided once at construction from the model id — so a
 * request never carries a parameter the model rejects, and there is no
 * send-then-retry-without dance.
 *
 *   - `reasoning-none`: reasoning model that accepts effort "none"; with
 *     reasoning off it behaves like a chat model and takes temperature.
 *   - `reasoning`: effort cannot be "none" (GPT-6 Astra, GPT-6.1 Sol); OpenAI
 *     requires temperature/top_p to be ABSENT whenever effort ≠ none.
 *   - `classic`: non-reasoning model; sending `reasoning` at all is a 400.
 */
export type OpenAiModelProfile = 'reasoning-none' | 'reasoning' | 'classic';

/** Longest prefix wins. Unknown ids get the conservative `reasoning` profile. */
const MODEL_PROFILES: ReadonlyArray<readonly [prefix: string, profile: OpenAiModelProfile]> = [
  ['gpt-6.1-terra', 'reasoning-none'],
  ['gpt-6-luna', 'reasoning-none'],
  ['gpt-6.1-sol', 'reasoning'],
  ['gpt-6-astra', 'reasoning'],
  ['gpt-4.1', 'classic'],
  ['gpt-4o', 'classic'],
];

export function openAiModelProfile(model: string): OpenAiModelProfile {
  let best: { length: number; profile: OpenAiModelProfile } | undefined;
  for (const [prefix, profile] of MODEL_PROFILES) {
    if (model.startsWith(prefix) && (best === undefined || prefix.length > best.length)) {
      best = { length: prefix.length, profile };
    }
  }
  // "low" is accepted by every current reasoning model and temperature is
  // omitted — the combination least likely to be rejected by a new model.
  return best?.profile ?? 'reasoning';
}

export interface OpenAiProviderOptions {
  apiKey: string | undefined;
  /** Model id; env AI_MODEL upstream, default gpt-6.1-sol. */
  model?: string;
  timeoutMs?: number;
  /** Test hook. */
  client?: OpenAI;
}

type ResponseCreateParams = OpenAI.Responses.ResponseCreateParamsNonStreaming;

/**
 * OpenAI implementation of AIProvider (Responses API). Same typed-error
 * contract as AnthropicProvider: RATE_LIMITED / TIMEOUT / PROVIDER_ERROR.
 */
export class OpenAiProvider extends BaseAi {
  readonly name = 'openai' as const;
  readonly model: string;
  readonly profile: OpenAiModelProfile;
  private readonly client: OpenAI;

  constructor(options: OpenAiProviderOptions) {
    super();
    if (!options.client && (options.apiKey === undefined || options.apiKey === '')) {
      throw new AiProviderError('PROVIDER_ERROR', 'OPENAI_API_KEY is not set');
    }
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxRetries: 1,
      });
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.profile = openAiModelProfile(this.model);
  }

  /** The exact request body — exposed so tests can pin per-profile parameters. */
  buildParams(request: AiRequest): ResponseCreateParams {
    const base: ResponseCreateParams = {
      model: this.model,
      instructions: request.system,
      input: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      // Patient health data: never retain the response server-side. The
      // Responses API defaults `store` to TRUE (30+ days), so this is explicit.
      store: false,
      max_output_tokens: request.maxTokens,
    };
    switch (this.profile) {
      case 'reasoning-none':
        return {
          ...base,
          reasoning: { effort: 'none' },
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        };
      case 'reasoning':
        // No temperature: rejected whenever reasoning effort is not "none".
        return {
          ...base,
          reasoning: { effort: 'low' },
          max_output_tokens: request.maxTokens + REASONING_HEADROOM_TOKENS,
        };
      case 'classic':
        return {
          ...base,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        };
    }
  }

  async complete(request: AiRequest): Promise<AiResponse> {
    let response: OpenAI.Responses.Response;
    try {
      response = await this.client.responses.create(this.buildParams(request));
    } catch (error) {
      throw this.toTypedError(error);
    }
    const text = response.output_text;
    const incomplete = response.incomplete_details?.reason;
    if (text.trim() === '') {
      // Reasoning ate the whole budget, a content filter fired, or the model
      // refused: there is nothing safe to show — the caller degrades gracefully.
      throw new AiProviderError(
        'PROVIDER_ERROR',
        `provider returned no text (status=${String(response.status)}${incomplete ? `, reason=${incomplete}` : ''})`,
      );
    }
    return {
      text,
      // Normalised to Anthropic's vocabulary, which is what callers already see.
      stopReason: incomplete === 'max_output_tokens' ? 'max_tokens' : (incomplete ?? 'end_turn'),
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        // Includes reasoning tokens — they are billed as output.
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    };
  }

  private toTypedError(error: unknown): AiProviderError {
    if (error instanceof AiProviderError) return error;
    if (error instanceof OpenAI.RateLimitError) {
      return new AiProviderError('RATE_LIMITED', 'provider rate limit exceeded', error);
    }
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      return new AiProviderError('TIMEOUT', 'provider request timed out', error);
    }
    if (error instanceof OpenAI.APIConnectionError) {
      return new AiProviderError('TIMEOUT', 'provider connection failed', error);
    }
    if (error instanceof OpenAI.APIError) {
      // Status + error type only: OpenAI's 401 message echoes a masked key.
      return new AiProviderError(
        'PROVIDER_ERROR',
        `provider error ${String(error.status)}: ${String(error.type ?? error.code ?? 'api_error')}`,
        error,
      );
    }
    return new AiProviderError('PROVIDER_ERROR', 'unexpected provider failure', error);
  }
}
