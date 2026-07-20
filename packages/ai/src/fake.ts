import { AiProviderError, BaseAi, type AiRequest, type AiResponse } from './port.js';

type ScriptEntry =
  | { kind: 'text'; text: string; inputTokens: number; outputTokens: number }
  | { kind: 'error'; error: AiProviderError };

/**
 * Scripted AiPort for tests: enqueue responses, assert on recorded requests.
 * completeStructured runs the REAL retry logic from BaseAi over these scripts,
 * so structured-output tests exercise the production parse/retry path.
 */
export class FakeAi extends BaseAi {
  /** Every request passed to complete(), in order — including structured retries. */
  readonly requests: AiRequest[] = [];
  private readonly script: ScriptEntry[] = [];

  /** Queue a plain text reply (default small token usage). */
  reply(text: string, usage: { inputTokens?: number; outputTokens?: number } = {}): this {
    this.script.push({
      kind: 'text',
      text,
      inputTokens: usage.inputTokens ?? 100,
      outputTokens: usage.outputTokens ?? 50,
    });
    return this;
  }

  /** Queue a JSON reply (stringified). */
  replyJson(value: unknown, usage: { inputTokens?: number; outputTokens?: number } = {}): this {
    return this.reply(JSON.stringify(value), usage);
  }

  /** Queue a typed provider failure. */
  fail(code: 'RATE_LIMITED' | 'TIMEOUT' | 'PROVIDER_ERROR'): this {
    this.script.push({ kind: 'error', error: new AiProviderError(code, `scripted ${code}`) });
    return this;
  }

  get callCount(): number {
    return this.requests.length;
  }

  complete(request: AiRequest): Promise<AiResponse> {
    this.requests.push(request);
    const entry = this.script.shift();
    if (!entry) {
      return Promise.reject(
        new AiProviderError('PROVIDER_ERROR', 'FakeAi: script exhausted — queue more replies'),
      );
    }
    if (entry.kind === 'error') return Promise.reject(entry.error);
    return Promise.resolve({
      text: entry.text,
      stopReason: 'end_turn',
      usage: { inputTokens: entry.inputTokens, outputTokens: entry.outputTokens },
    });
  }
}
