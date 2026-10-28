import type { z } from 'zod';

/** One conversational turn sent to the model. */
export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  system: string;
  messages: AiMessage[];
  maxTokens: number;
  temperature?: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiResponse {
  text: string;
  stopReason: string;
  usage: AiUsage;
}

export interface AiStructuredResult<T> {
  value: T;
  /** Total usage across the attempt(s), including the one retry if it ran. */
  usage: AiUsage;
  retried: boolean;
}

/** Typed provider failures — callers branch on `code`, never on messages. */
export type AiErrorCode = 'RATE_LIMITED' | 'TIMEOUT' | 'PROVIDER_ERROR';

export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    detail: string,
    cause?: unknown,
  ) {
    super(detail, cause === undefined ? undefined : { cause });
    this.name = 'AiProviderError';
  }
}

/** The model failed to produce schema-valid JSON twice in a row. */
export class AiOutputInvalidError extends Error {
  constructor(
    detail: string,
    readonly lastOutput: string,
  ) {
    super(detail);
    this.name = 'AiOutputInvalidError';
  }
}

/** Which backend answers. `fake` is dev-only (DevFakeAi) or the scripted test double. */
export type AiProviderName = 'anthropic' | 'openai' | 'fake';

/**
 * The one interface the screening service talks to. Prompts, safety rules
 * (emergency pre-screen, 112/115, output gate) and the structured-output
 * retry all live ABOVE this line, so swapping the provider cannot change them.
 */
export interface AIProvider {
  /** Backend identity — for smoke checks and logs, never for branching. */
  readonly name: AiProviderName;
  /** Concrete model id sent to the backend. */
  readonly model: string;
  complete(request: AiRequest): Promise<AiResponse>;
  /**
   * Demand JSON-only output, parse it, and validate against the schema. On a
   * parse/validation failure, retry ONCE with the errors appended to the
   * conversation; a second failure throws AiOutputInvalidError.
   */
  completeStructured<T>(request: AiRequest, schema: z.ZodType<T>): Promise<AiStructuredResult<T>>;
}

const JSON_ONLY_DIRECTIVE =
  'Respond with ONLY a single valid JSON object — no prose, no markdown fences, no commentary before or after it.';

/** Tolerate models that wrap JSON in markdown fences or stray prose. */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return candidate.trim();
  return candidate.slice(start, end + 1).trim();
}

/**
 * Shared implementation base: providers implement complete(); the structured
 * flow (JSON demand → parse → validate → one retry with errors) is identical
 * for every provider, so it lives here.
 */
export abstract class BaseAi implements AIProvider {
  abstract readonly name: AiProviderName;
  abstract readonly model: string;
  abstract complete(request: AiRequest): Promise<AiResponse>;

  async completeStructured<T>(
    request: AiRequest,
    schema: z.ZodType<T>,
  ): Promise<AiStructuredResult<T>> {
    const structured: AiRequest = {
      ...request,
      system: `${request.system}\n\n${JSON_ONLY_DIRECTIVE}`,
    };

    const first = await this.complete(structured);
    const firstAttempt = this.tryParse(first.text, schema);
    if (firstAttempt.ok) {
      return { value: firstAttempt.value, usage: first.usage, retried: false };
    }

    // Retry once, appending the model's invalid output and the validation errors.
    const retryRequest: AiRequest = {
      ...structured,
      messages: [
        ...structured.messages,
        { role: 'assistant', content: first.text },
        {
          role: 'user',
          content:
            `Your previous response was not valid: ${firstAttempt.error}\n` +
            `Respond again with ONLY the corrected JSON object.`,
        },
      ],
    };
    const second = await this.complete(retryRequest);
    const usage: AiUsage = {
      inputTokens: first.usage.inputTokens + second.usage.inputTokens,
      outputTokens: first.usage.outputTokens + second.usage.outputTokens,
    };
    const secondAttempt = this.tryParse(second.text, schema);
    if (secondAttempt.ok) {
      return { value: secondAttempt.value, usage, retried: true };
    }
    throw new AiOutputInvalidError(
      `model output failed schema validation twice: ${secondAttempt.error}`,
      second.text,
    );
  }

  private tryParse<T>(
    text: string,
    schema: z.ZodType<T>,
  ): { ok: true; value: T } | { ok: false; error: string } {
    let raw: unknown;
    try {
      raw = JSON.parse(extractJson(text));
    } catch (error) {
      return { ok: false, error: `not valid JSON (${(error as Error).message})` };
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      return { ok: false, error: `schema validation failed (${issues})` };
    }
    return { ok: true, value: parsed.data };
  }
}
