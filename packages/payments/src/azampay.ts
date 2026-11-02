import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { deriveMno } from './mno-prefixes.js';
import {
  MobileMoneyError,
  type InitiateCollectionInput,
  type InitiateCollectionResult,
  type MobileMoneyPort,
  type QueryStatusResult,
  type RefundInput,
  type RefundResult,
} from './port.js';

const SANDBOX_AUTH_URL = 'https://authenticator-sandbox.azampay.co.tz';
const SANDBOX_CHECKOUT_URL = 'https://sandbox.azampay.co.tz';
const PRODUCTION_AUTH_URL = 'https://authenticator.azampay.co.tz';
const PRODUCTION_CHECKOUT_URL = 'https://checkout.azampay.co.tz';
const TOKEN_REFRESH_MARGIN_MS = 60_000;

// Provider payloads are never trusted — every response is Zod-validated.
const tokenResponseSchema = z.object({
  data: z.object({
    accessToken: z.string().min(1),
    expire: z.string().min(1), // ISO timestamp
  }),
});

const checkoutResponseSchema = z.object({
  transactionId: z.string().min(1),
  success: z.boolean(),
  message: z.string().optional(),
});

const statusResponseSchema = z.object({
  data: z.object({
    transactionStatus: z.enum(['success', 'failure', 'pending']),
    message: z.string().optional(),
  }),
});

const refundResponseSchema = z.object({
  refundId: z.string().min(1),
  success: z.boolean(),
  message: z.string().optional(),
});

/** Wraps an error the read path may retry. */
class RetryableError extends Error {
  constructor(readonly mapped: MobileMoneyError) {
    super(mapped.message);
  }
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/** DNS failure / connection refused: the request never reached AzamPay. */
function neverReachedProvider(error: unknown): boolean {
  const code = (error as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  return code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN';
}

export interface AzamPayTimeouts {
  /** Token, status, name lookup, public key. */
  readMs: number;
  /** Checkout, disbursement. */
  writeMs: number;
}

export const DEFAULT_AZAMPAY_TIMEOUTS: AzamPayTimeouts = { readMs: 10_000, writeMs: 20_000 };

export interface AzamPayOptions {
  appName: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  environment?: 'sandbox' | 'production';
  /** Overrides for tests / future URL changes. */
  authBaseUrl?: string;
  checkoutBaseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeouts?: AzamPayTimeouts;
  /** Backoff between read retries; its length is the retry count (tests pass [0, 0]). */
  retryDelaysMs?: readonly number[];
}

/**
 * Verify an AzamPay webhook: HMAC-SHA256 of the RAW body, hex, timing-safe.
 * Runs before any parsing side effects — see the webhook route.
 */
export function verifyAzamPayWebhookSignature(
  rawBody: string,
  signatureHex: string | undefined,
  webhookSecret: string | undefined,
): boolean {
  if (signatureHex === undefined || webhookSecret === undefined || webhookSecret === '') {
    return false;
  }
  const expected = createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest();
  let presented: Buffer;
  try {
    presented = Buffer.from(signatureHex, 'hex');
  } catch {
    return false;
  }
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/** The webhook body we accept from AzamPay (Zod-validated after signature). */
export const azamPayWebhookSchema = z.object({
  transactionId: z.string().min(1),
  externalReference: z.string().min(1),
  status: z.enum(['success', 'failure']),
  amount: z.coerce.number().int().nonnegative(),
  currency: z.literal('TZS'),
  message: z.string().optional(),
});
export type AzamPayWebhookBody = z.infer<typeof azamPayWebhookSchema>;

/**
 * AzamPay implementation: token auth with expiry-aware caching, MNO checkout
 * (network derived from the MSISDN prefix), status query, refunds.
 */
export class AzamPayProvider implements MobileMoneyPort {
  private readonly authBaseUrl: string;
  private readonly checkoutBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly timeouts: AzamPayTimeouts;
  private readonly retryDelaysMs: readonly number[];
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(private readonly options: AzamPayOptions) {
    const production = options.environment === 'production';
    this.authBaseUrl =
      options.authBaseUrl ?? (production ? PRODUCTION_AUTH_URL : SANDBOX_AUTH_URL);
    this.checkoutBaseUrl =
      options.checkoutBaseUrl ?? (production ? PRODUCTION_CHECKOUT_URL : SANDBOX_CHECKOUT_URL);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? ((): Date => new Date());
    this.timeouts = options.timeouts ?? DEFAULT_AZAMPAY_TIMEOUTS;
    this.retryDelaysMs = options.retryDelaysMs ?? [500, 2_000];
  }

  private assertConfigured(): { appName: string; clientId: string; clientSecret: string } {
    const { appName, clientId, clientSecret } = this.options;
    if (!appName || !clientId || !clientSecret) {
      throw new MobileMoneyError('NOT_CONFIGURED', 'AZAMPAY_* credentials are not set');
    }
    return { appName, clientId, clientSecret };
  }

  /** Token auth, cached with expiry-aware refresh (refreshes 60s early). */
  private async accessToken(): Promise<string> {
    const config = this.assertConfigured();
    if (this.cachedToken && this.cachedToken.expiresAt > this.now().getTime()) {
      return this.cachedToken.token;
    }
    const response = await this.request(
      'POST',
      `${this.authBaseUrl}/AppRegistration/GenerateToken`,
      { appName: config.appName, clientId: config.clientId, clientSecret: config.clientSecret },
      undefined,
      'read',
    );
    const parsed = this.parse(tokenResponseSchema, response, 'token');
    const expiresAt = Date.parse(parsed.data.expire);
    this.cachedToken = {
      token: parsed.data.accessToken,
      expiresAt: (Number.isNaN(expiresAt) ? this.now().getTime() + 10 * 60_000 : expiresAt) -
        TOKEN_REFRESH_MARGIN_MS,
    };
    return this.cachedToken.token;
  }

  async initiateCollection(input: InitiateCollectionInput): Promise<InitiateCollectionResult> {
    const mno = deriveMno(input.phoneE164);
    if (!mno) {
      throw new MobileMoneyError(
        'INVALID_MSISDN',
        `cannot derive a Tanzanian MNO from ${input.phoneE164}`,
      );
    }
    const token = await this.accessToken();
    const response = await this.request(
      'POST',
      `${this.checkoutBaseUrl}/azampay/mno/checkout`,
      {
        accountNumber: input.phoneE164.replace('+', ''),
        amount: String(input.amountTzs), // whole TZS
        currency: input.currency,
        externalId: input.externalReference,
        provider: mno.azamProvider,
        additionalProperties: { description: input.description },
      },
      token,
      'write',
    );
    const parsed = this.parse(checkoutResponseSchema, response, 'checkout');
    if (!parsed.success) {
      if (/insufficient/i.test(parsed.message ?? '')) {
        throw new MobileMoneyError('INSUFFICIENT_FUNDS_HINT', parsed.message ?? 'insufficient funds');
      }
      return { providerReference: parsed.transactionId, status: 'FAILED' };
    }
    return { providerReference: parsed.transactionId, status: 'PENDING' };
  }

  async queryStatus(providerReference: string): Promise<QueryStatusResult> {
    const token = await this.accessToken();
    const response = await this.request(
      'GET',
      `${this.checkoutBaseUrl}/api/v1/Partner/GetTransactionStatus?pgReferenceId=${encodeURIComponent(providerReference)}`,
      undefined,
      token,
      'read',
    );
    const parsed = this.parse(statusResponseSchema, response, 'status');
    const status =
      parsed.data.transactionStatus === 'success'
        ? 'COMPLETED'
        : parsed.data.transactionStatus === 'failure'
          ? 'FAILED'
          : 'PENDING';
    return {
      providerReference,
      status,
      ...(parsed.data.message !== undefined ? { failureReason: parsed.data.message } : {}),
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const token = await this.accessToken();
    const response = await this.request(
      'POST',
      `${this.checkoutBaseUrl}/api/v1/Partner/Refund`,
      {
        pgReferenceId: input.providerReference,
        amount: String(input.amountTzs),
        currency: 'TZS',
        reason: input.reason,
      },
      token,
      'write',
    );
    const parsed = this.parse(refundResponseSchema, response, 'refund');
    return { refundReference: parsed.refundId, status: parsed.success ? 'COMPLETED' : 'FAILED' };
  }

  // ── HTTP plumbing ──────────────────────────────────────────────────────────

  /**
   * Every AzamPay call has a deadline. Retry rules:
   *  - 'read' calls (token, status, name lookup, public key) are idempotent:
   *    retried on network errors, timeouts, 429 and 5xx with backoff.
   *  - 'write' calls (checkout, disbursement) move money and are NEVER
   *    retried here. A failure before the request could reach AzamPay (DNS,
   *    connection refused) is PROVIDER_UNAVAILABLE; anything after (timeout,
   *    reset, 429/5xx, unreadable 2xx) is OUTCOME_UNKNOWN — the caller must
   *    leave the payment for the status check, never mark it failed.
   */
  private async request(
    method: 'GET' | 'POST',
    url: string,
    body: Record<string, unknown> | undefined,
    bearer: string | undefined,
    kind: 'read' | 'write',
  ): Promise<unknown> {
    const attempts = kind === 'read' ? this.retryDelaysMs.length + 1 : 1;
    let lastError: MobileMoneyError | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(this.retryDelaysMs[attempt - 1] ?? 0);
      try {
        return await this.requestOnce(method, url, body, bearer, kind);
      } catch (error) {
        if (!(error instanceof RetryableError)) throw error;
        lastError = error.mapped;
      }
    }
    throw lastError ?? new MobileMoneyError('PROVIDER_UNAVAILABLE', `provider call failed: ${url}`);
  }

  private async requestOnce(
    method: 'GET' | 'POST',
    url: string,
    body: Record<string, unknown> | undefined,
    bearer: string | undefined,
    kind: 'read' | 'write',
  ): Promise<unknown> {
    const label = `${method} ${new URL(url).pathname}`;
    const afterSend = (detail: string, cause?: unknown): MobileMoneyError =>
      new MobileMoneyError(kind === 'write' ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', detail, cause);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(bearer !== undefined ? { authorization: `Bearer ${bearer}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(kind === 'write' ? this.timeouts.writeMs : this.timeouts.readMs),
      });
    } catch (error) {
      if (neverReachedProvider(error)) {
        throw new RetryableError(
          new MobileMoneyError('PROVIDER_UNAVAILABLE', `could not reach provider: ${label}`, error),
        );
      }
      const timedOut =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      const mapped = afterSend(`${timedOut ? 'timeout' : 'network failure'} on ${label}`, error);
      if (kind === 'write') throw mapped;
      throw new RetryableError(mapped);
    }

    if (response.status === 401 || response.status === 403) {
      this.cachedToken = null; // force re-auth on the next call
      throw new MobileMoneyError('PROVIDER_UNAVAILABLE', `provider auth rejected (${response.status}) on ${label}`);
    }
    if (response.status === 429 || response.status >= 500) {
      const mapped = afterSend(`provider error ${response.status} on ${label}`);
      if (kind === 'write') throw mapped;
      throw new RetryableError(mapped);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (/msisdn|phone|account/i.test(text) && response.status === 400) {
        throw new MobileMoneyError('INVALID_MSISDN', `provider rejected the account number on ${label}`);
      }
      throw new MobileMoneyError('PROVIDER_UNAVAILABLE', `provider error ${response.status} on ${label}`);
    }
    try {
      return await response.json();
    } catch (error) {
      // A 2xx with an unreadable body: a write may well have been accepted.
      throw afterSend(`unreadable provider response on ${label}`, error);
    }
  }

  private parse<T>(schema: z.ZodType<T>, payload: unknown, label: string): T {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new MobileMoneyError(
        'PROVIDER_UNAVAILABLE',
        `provider ${label} response failed validation: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      );
    }
    return parsed.data;
  }
}
