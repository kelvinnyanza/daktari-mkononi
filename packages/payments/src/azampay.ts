import { constants, createHash, createPublicKey, publicEncrypt, verify as verifySignature } from 'node:crypto';
import { z } from 'zod';
import { deriveMno } from './mno-prefixes.js';
import {
  MobileMoneyError,
  type CallbackSignatureCheck,
  type CheckoutCallbackSignedFields,
  type DisburseInput,
  type DisburseResult,
  type InitiateCollectionInput,
  type InitiateCollectionResult,
  type MobileMoneyPort,
  type NameLookupInput,
  type NameLookupResult,
  type PayoutDestinationOperator,
  type ProviderPaymentStatus,
  type QueryStatusResult,
  type RefundInput,
  type RefundResult,
  type StatusHint,
} from './port.js';

/**
 * AzamPay Tanzania API v1 — checked against the official OpenAPI document
 * served by developerdocs.azampay.co.tz (/tanzania/v1/schema.json, snapshot
 * in docs/vendor/azampay-tanzania-v1-openapi.json, fetched 2026-11-02).
 *
 * Hosts (every one overridable by env):
 *   auth          authenticator-sandbox.azampay.co.tz  POST /AppRegistration/GenerateToken
 *   checkout      sandbox.azampay.co.tz                POST /azampay/mno/checkout
 *   disbursement  api-disbursement-test.azampay.co.tz  POST /api/v1/azampay/disburse
 *                                                     POST /api/v1/azampay/namelookup
 *                                                     GET  /api/v1/azampay/transactionstatus
 *
 * Sandbox disbursement host (probed 2026-11-03): the spec's
 * api-disbursement-sandbox.azampay.co.tz completes TLS and then resets every
 * request, on every path, with or without auth. api-disbursement-test is the
 * live sandbox disbursement API (its transactionstatus route answers 401
 * unauthenticated). It rejects tokens from authenticator-sandbox, so the
 * disbursement authenticator is configurable separately.
 *
 * Callback public key: NOT fetched. GET /azampay/v1/public-key appears only in
 * the callback's prose, not as a path in the spec, and 404s on the sandbox
 * host. The key is configuration (AZAMPAY_CALLBACK_PUBLIC_KEY, falling back
 * to AZAMPAY_CHECKSUM_PUBLIC_KEY). No key ⇒ callbacks are treated as unsigned.
 *
 * Gaps in AzamPay's documentation, handled conservatively here and listed in
 * docs/payments-flow.md: no refund endpoint (refunds are disbursements back
 * to the payer); NO status endpoint for CHECKOUT payments — the only one is
 * documented for disbursements, its `data` shape is unspecified (parsed
 * leniently, "not found" ⇒ still pending), and asking it about a checkout is
 * best-effort (AZAMPAY_CHECKOUT_STATUS_QUERY); the checksum's input fields
 * are "contact us"; the callback signature is described over two different
 * field sets.
 */
const SANDBOX = {
  auth: 'https://authenticator-sandbox.azampay.co.tz',
  checkout: 'https://sandbox.azampay.co.tz',
  disbursement: 'https://api-disbursement-test.azampay.co.tz',
};
const PRODUCTION = {
  auth: 'https://authenticator.azampay.co.tz',
  checkout: 'https://checkout.azampay.co.tz',
  disbursement: 'https://api-disbursement.azampay.co.tz',
};
const TOKEN_REFRESH_MARGIN_MS = 60_000;
/** A webhook-time status query: one attempt, this deadline at most. */
const FAST_READ_TIMEOUT_MS = 4_000;
/** AzamPay limits: checkout externalId ≤ 128, disbursement externalReferenceId ≤ 30. */
const MAX_DISBURSE_REFERENCE = 30;

/** Disbursement `bankName` enum (spec: tigo | airtel | azampesa — no M-Pesa, no Halopesa, no banks). */
const DISBURSE_BANK_NAME: Partial<Record<PayoutDestinationOperator, string>> = {
  TIGO_PESA: 'tigo',
  AIRTEL_MONEY: 'airtel',
  AZAMPESA: 'azampesa',
};

const OPERATOR_BY_NETWORK: Record<string, PayoutDestinationOperator> = {
  VODACOM: 'MPESA',
  TIGO: 'TIGO_PESA',
  AIRTEL: 'AIRTEL_MONEY',
  HALOTEL: 'HALOPESA',
};

/** The API's disbursement bankName for an operator, or null when it cannot pay it. */
export function azamPayDisburseBankName(operator: PayoutDestinationOperator): string | null {
  return DISBURSE_BANK_NAME[operator] ?? null;
}

// Provider payloads are never trusted — every response is Zod-validated.
const tokenResponseSchema = z.object({
  data: z.object({
    accessToken: z.string().min(1),
    expire: z.string().min(1), // ISO timestamp
  }),
});

const checkoutResponseSchema = z.object({
  transactionId: z.string().min(1).nullable().optional(),
  success: z.boolean(),
  message: z.string().nullable().optional(),
});

const statusEnvelopeSchema = z.object({
  data: z.unknown().optional(),
  message: z.string().nullable().optional(),
  success: z.boolean().optional(),
  statusCode: z.number().optional(),
});

const disburseResponseSchema = z.object({
  pgReferenceId: z.string().min(1).nullable().optional(),
  success: z.boolean(),
  message: z.string().nullable().optional(),
});

const nameLookupResponseSchema = z.object({
  name: z.string().nullable().optional(),
  fname: z.string().nullable().optional(),
  lname: z.string().nullable().optional(),
  status: z.boolean().optional(),
  message: z.string().nullable().optional(),
});

/**
 * Checkout callback body (spec: CallbackRequest). Lenient on optional fields
 * so a field AzamPay omits does not turn a real payment into a 400; the
 * `user` / `password` / `clientId` fields AzamPay sends are deliberately NOT
 * part of the schema (stripped, never stored or logged).
 */
export const azamPayCallbackSchema = z.object({
  utilityref: z.string().min(1), // OUR reference (checkout externalId = Payment.idempotencyKey)
  transactionstatus: z.string().min(1), // "success" | "failure"
  externalreference: z.string().optional(), // AzamPay's reference
  operator: z.string().optional(),
  reference: z.string().optional(),
  transid: z.string().optional(),
  mnoreference: z.string().optional(),
  msisdn: z.string().optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  message: z.string().optional(),
  signature: z.string().nullable().optional(),
});
export type AzamPayCallbackBody = z.infer<typeof azamPayCallbackSchema>;

/** Disbursement callback body (spec: DisburseCallback) — never trusted, only a nudge to query status. */
export const azamPayDisbursementCallbackSchema = z
  .object({
    pgReferenceId: z.string().min(1).optional(),
    initiatorReferenceId: z.string().min(1).optional(),
    fspReferenceId: z.string().optional(),
    amount: z.union([z.string(), z.number()]).optional(),
    status: z.string().optional(),
    message: z.string().optional(),
    operator: z.string().optional(),
  })
  .refine((body) => body.pgReferenceId !== undefined || body.initiatorReferenceId !== undefined, {
    message: 'pgReferenceId or initiatorReferenceId required',
  });
export type AzamPayDisbursementCallbackBody = z.infer<typeof azamPayDisbursementCallbackSchema>;

/** "success" / "failure" / anything else → our three-state status. */
export function mapAzamPayStatus(word: string | undefined): ProviderPaymentStatus {
  if (word === undefined) return 'PENDING';
  if (/^(success|successful|succeeded|completed?|paid)$/i.test(word.trim())) return 'COMPLETED';
  if (/fail|reject|declin|cancel|expire|revers|error/i.test(word)) return 'FAILED';
  return 'PENDING';
}

/**
 * Provider amounts arrive as strings ("15000", maybe "15000.00"). Whole-TZS
 * values parse; anything else is `unreadable` — the caller must not confirm
 * on it (treated as an amount mismatch).
 */
export function parseAzamPayAmount(raw: string | number | undefined): { amountTzs?: number; unreadable: boolean } {
  if (raw === undefined || raw === '') return { unreadable: false };
  const value = typeof raw === 'number' ? raw : Number(raw.trim());
  if (Number.isSafeInteger(value) && value >= 0) return { amountTzs: value, unreadable: false };
  return { unreadable: true };
}

/** The string the callback signature covers, per AzamPay's "Signed Data" section. */
export function azamPayCallbackSignedData(fields: Omit<CheckoutCallbackSignedFields, 'signature'>): string {
  return `${fields.utilityref}${fields.externalreference}${fields.transactionstatus}${fields.operator}`;
}

/** True when `pem` parses as an RSA public key (env validation applies the same rule). */
export function isRsaPublicKeyPem(pem: string): boolean {
  try {
    return createPublicKey(pem).asymmetricKeyType === 'rsa';
  } catch {
    return false;
  }
}

/** RSA-SHA256 / PKCS#1 v1.5 over UTF-8 data, base64 signature (AzamPay callback signature). */
export function verifyAzamPayRsaSignature(data: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    return verifySignature(
      'sha256',
      Buffer.from(data, 'utf8'),
      { key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(signatureBase64, 'base64'),
    );
  } catch {
    return false; // malformed key / signature → not verified
  }
}

/**
 * Disbursement / name-lookup checksum: Base64(RSA_PKCS1(SHA512(input))) with
 * the public key AzamPay issues at onboarding. WHICH fields form `input` is
 * not published ("contact us") — see checksumInput below.
 */
export function azamPayChecksum(input: string, publicKeyPem: string): string {
  const digest = createHash('sha512').update(input, 'utf8').digest();
  return publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING }, digest).toString('base64');
}

/** Pull status / amount / fee / reason out of the status API's unspecified `data` object. */
function readStatusData(data: unknown): {
  status?: string;
  amount?: string | number;
  fee?: string | number;
  reason?: string;
} {
  if (data === null || typeof data !== 'object') return {};
  const record = data as Record<string, unknown>;
  const pick = (...names: string[]): unknown => {
    for (const [key, value] of Object.entries(record)) {
      if (names.includes(key.toLowerCase())) return value;
    }
    return undefined;
  };
  const asText = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  const asAmount = (value: unknown): string | number | undefined =>
    typeof value === 'string' || typeof value === 'number' ? value : undefined;
  const result: { status?: string; amount?: string | number; fee?: string | number; reason?: string } = {};
  const status = asText(pick('transactionstatus', 'status'));
  const amount = asAmount(pick('amount'));
  const fee = asAmount(pick('fee', 'fees', 'charge', 'charges', 'transactionfee'));
  const reason = asText(pick('failedreason', 'message'));
  if (status !== undefined) result.status = status;
  if (amount !== undefined) result.amount = amount;
  if (fee !== undefined) result.fee = fee;
  if (reason !== undefined) result.reason = reason;
  return result;
}

/** Wraps an error the read path may retry. */
class RetryableError extends Error {
  constructor(readonly mapped: MobileMoneyError) {
    super(mapped.message);
  }
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/** The socket-level code behind a fetch failure (ECONNRESET, ENOTFOUND, …), for messages. */
function networkErrorCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown; name?: unknown } } | undefined)?.cause;
  if (typeof cause?.code === 'string') return cause.code;
  if (typeof cause?.name === 'string') return cause.name;
  return error instanceof Error ? error.name : 'unknown';
}

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

export interface AzamPayDisbursementSource {
  /** The merchant's disbursement float account, as AzamPay registered it. */
  accountNumber: string;
  fullName: string;
  /** Spec enum: tigo | airtel | azampesa. */
  bankName: string;
}

/** One HTTP attempt to AzamPay, for logs: never headers, bodies, tokens or query strings. */
export interface AzamPayRequestEvent {
  method: 'GET' | 'POST';
  host: string;
  path: string;
  /** HTTP status, or null when no response arrived. */
  status: number | null;
  /** 'ok' | 'http-error' | 'timeout' | 'network:<code>' | 'unreachable:<code>' */
  outcome: string;
  durationMs: number;
}

export interface AzamPayOptions {
  appName: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  environment?: 'sandbox' | 'production';
  /** Overrides for tests / future URL changes. */
  authBaseUrl?: string;
  checkoutBaseUrl?: string;
  disbursementBaseUrl?: string;
  /**
   * The portal "Token" / API key issued at onboarding, sent as `X-API-Key`.
   * The spec defines the scheme but marks no operation as requiring it; only
   * the MNO checkout samples send it, so it goes on MNO checkout only. Unset
   * ⇒ no header (the sandbox checkout succeeds without it).
   */
  apiKey?: string;
  /** Authenticator for disbursement-host calls; unset ⇒ authBaseUrl (one token for both). */
  disbursementAuthBaseUrl?: string;
  /** PEM issued by AzamPay for the disbursement / name-lookup checksum. Unset ⇒ no checksum sent. */
  checksumPublicKeyPem?: string;
  /** PEM that verifies checkout callback signatures. Unset ⇒ every callback counts as unsigned. */
  callbackPublicKeyPem?: string;
  /**
   * Ask the (disbursement-documented) status API about CHECKOUT payments.
   * false ⇒ queryStatus throws NOT_SUPPORTED at once: callbacks then settle on
   * a valid signature alone, everything else on statement reconciliation.
   * Default true — harmless when the API does not know the transaction
   * ("not found" ⇒ PENDING).
   */
  checkoutStatusQuery?: boolean;
  /** Called after every HTTP attempt — how the exact host gets logged. */
  onRequest?: (event: AzamPayRequestEvent) => void;
  /** Unset ⇒ disbursements (payouts, refunds) answer NOT_CONFIGURED. */
  disbursementSource?: AzamPayDisbursementSource;
  /**
   * Strings the checksum is computed over. AzamPay does not publish the field
   * list — these defaults are PLACEHOLDERS to confirm with AzamPay during
   * sandbox onboarding.
   */
  checksumInput?: {
    disburse: (body: { destinationAccount: string; amount: number; externalReferenceId: string }) => string;
    nameLookup: (body: { bankName: string; accountNumber: string }) => string;
  };
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeouts?: AzamPayTimeouts;
  /** Backoff between read retries; its length is the retry count (tests pass [0, 0]). */
  retryDelaysMs?: readonly number[];
}

const DEFAULT_CHECKSUM_INPUT: NonNullable<AzamPayOptions['checksumInput']> = {
  disburse: (body) => `${body.destinationAccount}${body.amount}${body.externalReferenceId}`,
  nameLookup: (body) => `${body.bankName}${body.accountNumber}`,
};

/**
 * AzamPay implementation: token auth with expiry-aware caching, MNO checkout
 * (network derived from the MSISDN prefix), status query, callback signature
 * verification, disbursement (payouts + refunds) and name lookup.
 */
export class AzamPayProvider implements MobileMoneyPort {
  private readonly authBaseUrl: string;
  private readonly checkoutBaseUrl: string;
  private readonly disbursementBaseUrl: string;
  private readonly disbursementAuthBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly timeouts: AzamPayTimeouts;
  private readonly retryDelaysMs: readonly number[];
  private readonly checksumInput: NonNullable<AzamPayOptions['checksumInput']>;
  /** Token cache per authenticator (checkout and disbursement may use different ones). */
  private readonly cachedTokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly options: AzamPayOptions) {
    const hosts = options.environment === 'production' ? PRODUCTION : SANDBOX;
    this.authBaseUrl = options.authBaseUrl ?? hosts.auth;
    this.checkoutBaseUrl = options.checkoutBaseUrl ?? hosts.checkout;
    this.disbursementBaseUrl = options.disbursementBaseUrl ?? hosts.disbursement;
    this.disbursementAuthBaseUrl = options.disbursementAuthBaseUrl ?? this.authBaseUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? ((): Date => new Date());
    this.timeouts = options.timeouts ?? DEFAULT_AZAMPAY_TIMEOUTS;
    this.retryDelaysMs = options.retryDelaysMs ?? [500, 2_000];
    this.checksumInput = options.checksumInput ?? DEFAULT_CHECKSUM_INPUT;
  }

  private assertConfigured(): { appName: string; clientId: string; clientSecret: string } {
    const { appName, clientId, clientSecret } = this.options;
    if (!appName || !clientId || !clientSecret) {
      throw new MobileMoneyError('NOT_CONFIGURED', 'AZAMPAY_* credentials are not set');
    }
    return { appName, clientId, clientSecret };
  }

  /** Base URLs in use (startup log, sandbox test). Contains no secrets. */
  get hosts(): { auth: string; checkout: string; disbursement: string; disbursementAuth: string } {
    return {
      auth: this.authBaseUrl,
      checkout: this.checkoutBaseUrl,
      disbursement: this.disbursementBaseUrl,
      disbursementAuth: this.disbursementAuthBaseUrl,
    };
  }

  /** Whether an X-API-Key is configured (never the value). */
  get apiKeyConfigured(): boolean {
    return this.options.apiKey !== undefined;
  }

  /** Whether callback signatures can be checked at all. */
  get callbackKeyConfigured(): boolean {
    return this.options.callbackPublicKeyPem !== undefined;
  }

  /** Token auth, cached per authenticator with expiry-aware refresh (refreshes 60s early). */
  async accessToken(authBaseUrl: string = this.authBaseUrl): Promise<string> {
    const config = this.assertConfigured();
    const cached = this.cachedTokens.get(authBaseUrl);
    if (cached && cached.expiresAt > this.now().getTime()) {
      return cached.token;
    }
    const response = await this.request(
      'POST',
      `${authBaseUrl}/AppRegistration/GenerateToken`,
      { appName: config.appName, clientId: config.clientId, clientSecret: config.clientSecret },
      undefined,
      'read',
    );
    const parsed = this.parse(tokenResponseSchema, response, 'token');
    const expiresAt = Date.parse(parsed.data.expire);
    this.cachedTokens.set(authBaseUrl, {
      token: parsed.data.accessToken,
      expiresAt:
        (Number.isNaN(expiresAt) ? this.now().getTime() + 10 * 60_000 : expiresAt) - TOKEN_REFRESH_MARGIN_MS,
    });
    return parsed.data.accessToken;
  }

  /** Token for the disbursement host (status, disburse, name lookup). */
  disbursementToken(): Promise<string> {
    return this.accessToken(this.disbursementAuthBaseUrl);
  }

  // ── Collections ────────────────────────────────────────────────────────────

  async initiateCollection(input: InitiateCollectionInput): Promise<InitiateCollectionResult> {
    const mno = deriveMno(input.phoneE164);
    if (!mno) {
      throw new MobileMoneyError('INVALID_MSISDN', 'cannot derive a Tanzanian MNO from the payer number');
    }
    const token = await this.accessToken();
    const response = await this.request(
      'POST',
      `${this.checkoutBaseUrl}/azampay/mno/checkout`,
      {
        accountNumber: input.phoneE164.replace('+', ''),
        amount: input.amountTzs, // spec: number, whole TZS
        currency: input.currency,
        externalId: input.externalReference, // ≤ 128 chars; echoed as the callback's utilityref
        provider: mno.azamProvider,
        additionalProperties: { description: input.description },
      },
      token,
      'write',
      { apiKey: true },
    );
    const parsed = this.parse(checkoutResponseSchema, response, 'checkout');
    const providerReference = parsed.transactionId ?? null;
    if (!parsed.success) {
      if (/insufficient/i.test(parsed.message ?? '')) {
        throw new MobileMoneyError('INSUFFICIENT_FUNDS_HINT', 'insufficient funds');
      }
      return {
        providerReference,
        status: 'FAILED',
        ...(parsed.message ? { message: parsed.message } : {}),
      };
    }
    return { providerReference, status: 'PENDING' };
  }

  /**
   * CHECKOUT payment status. AzamPay documents no checkout status endpoint;
   * this asks the disbursement status API (best-effort — see
   * checkoutStatusQuery) and throws NOT_SUPPORTED when that is switched off.
   * `hint.fast` (webhook path): one attempt, short deadline.
   */
  async queryStatus(providerReference: string, hint?: StatusHint): Promise<QueryStatusResult> {
    if (this.options.checkoutStatusQuery === false) {
      throw new MobileMoneyError(
        'NOT_SUPPORTED',
        'checkout status query is off (AZAMPAY_CHECKOUT_STATUS_QUERY=off): AzamPay documents none',
      );
    }
    return this.transactionStatus(providerReference, hint, hint?.fast === true ? 'fast-read' : 'read');
  }

  /**
   * Transaction status (GET {disbursement}/api/v1/azampay/transactionstatus
   * ?pgReferenceId&bankName). "Not found" is reported PENDING — a status
   * check must never fail a payment the provider simply has not indexed yet.
   */
  private async transactionStatus(
    providerReference: string,
    hint: StatusHint | undefined,
    kind: 'read' | 'fast-read',
  ): Promise<QueryStatusResult> {
    const bankName =
      hint?.bankName ?? (hint?.phoneE164 ? (deriveMno(hint.phoneE164)?.azamProvider ?? '') : '');
    const token = await this.disbursementToken();
    const query = new URLSearchParams({ pgReferenceId: providerReference, bankName });
    const response = await this.request(
      'GET',
      `${this.disbursementBaseUrl}/api/v1/azampay/transactionstatus?${query.toString()}`,
      undefined,
      token,
      kind,
    );
    const envelope = this.parse(statusEnvelopeSchema, response, 'status');
    if (envelope.success === false) {
      return {
        providerReference,
        status: 'PENDING',
        ...(envelope.message ? { providerMessage: envelope.message } : {}),
      };
    }
    const data = readStatusData(envelope.data);
    const status = mapAzamPayStatus(data.status);
    const amount = parseAzamPayAmount(data.amount);
    const fee = parseAzamPayAmount(data.fee);
    return {
      providerReference,
      status,
      ...(status === 'FAILED' && data.reason !== undefined ? { failureReason: data.reason } : {}),
      ...(amount.amountTzs !== undefined ? { amountTzs: amount.amountTzs } : {}),
      ...(fee.amountTzs !== undefined ? { providerFeeTzs: fee.amountTzs } : {}),
    };
  }

  // ── Callback signature ─────────────────────────────────────────────────────

  /**
   * RSA-SHA256 (PKCS#1 v1.5) over {utilityref}{externalreference}
   * {transactionstatus}{operator}, base64, with the CONFIGURED key
   * (callbackPublicKeyPem — never fetched). The docs ALSO describe the
   * signature as covering only {utilityref}{externalreference}; that form is
   * reported 'refs-only' — it proves the references came from AzamPay but not
   * the status, so the caller must not act on it alone. No key configured ⇒
   * 'unverifiable', which every caller treats exactly like an unsigned
   * callback.
   */
  verifyCallbackSignature(fields: CheckoutCallbackSignedFields): Promise<CallbackSignatureCheck> {
    const signature = fields.signature;
    if (signature === undefined || signature === null || signature === '') return Promise.resolve('absent');
    const pem = this.options.callbackPublicKeyPem;
    if (pem === undefined) return Promise.resolve('unverifiable');
    if (verifyAzamPayRsaSignature(azamPayCallbackSignedData(fields), signature, pem)) {
      return Promise.resolve('valid');
    }
    if (verifyAzamPayRsaSignature(`${fields.utilityref}${fields.externalreference}`, signature, pem)) {
      return Promise.resolve('refs-only');
    }
    return Promise.resolve('invalid');
  }

  // ── Disbursement (payouts + refunds) ───────────────────────────────────────

  async disburse(input: DisburseInput): Promise<DisburseResult> {
    const source = this.options.disbursementSource;
    if (source === undefined) {
      throw new MobileMoneyError('NOT_CONFIGURED', 'AZAMPAY_DISBURSE_SOURCE_* is not set');
    }
    const bankName = azamPayDisburseBankName(input.operator);
    if (bankName === null) {
      throw new MobileMoneyError(
        'UNSUPPORTED_DESTINATION',
        `AzamPay disbursement does not support ${input.operator}; pay manually`,
      );
    }
    if (input.reference.length > MAX_DISBURSE_REFERENCE) {
      throw new RangeError(`disbursement reference exceeds ${MAX_DISBURSE_REFERENCE} chars`);
    }
    if (!Number.isSafeInteger(input.amountTzs) || input.amountTzs <= 0) {
      throw new RangeError('disbursement amount must be a positive whole TZS');
    }
    const destinationAccount = input.accountNumber.replace('+', '');
    const pem = this.options.checksumPublicKeyPem;
    const token = await this.disbursementToken();
    const response = await this.request(
      'POST',
      `${this.disbursementBaseUrl}/api/v1/azampay/disburse`,
      {
        source: {
          countryCode: 'TZ',
          fullName: source.fullName,
          bankName: source.bankName,
          accountNumber: source.accountNumber,
          currency: 'TZS',
        },
        destination: {
          countryCode: 'TZ',
          fullName: input.accountName,
          bankName,
          accountNumber: destinationAccount,
          currency: 'TZS',
        },
        transferDetails: {
          type: 'MNO', // spec example says "SWIFT, SEPA, etc." — confirm the MNO value with AzamPay
          amount: input.amountTzs,
          dateInEpoch: Math.floor(this.now().getTime() / 1000),
        },
        externalReferenceId: input.reference,
        remarks: input.remarks,
        ...(pem !== undefined
          ? {
              checksum: azamPayChecksum(
                this.checksumInput.disburse({
                  destinationAccount,
                  amount: input.amountTzs,
                  externalReferenceId: input.reference,
                }),
                pem,
              ),
            }
          : {}),
      },
      token,
      'write',
    );
    const parsed = this.parse(disburseResponseSchema, response, 'disburse');
    return {
      providerReference: parsed.pgReferenceId ?? null,
      status: parsed.success ? 'PENDING' : 'FAILED',
      ...(parsed.message ? { message: parsed.message } : {}),
    };
  }

  queryDisbursementStatus(providerReference: string, hint?: StatusHint): Promise<QueryStatusResult> {
    return this.transactionStatus(providerReference, hint, 'read');
  }

  /**
   * Refund = a disbursement of the full amount back to the payer's wallet
   * (AzamPay publishes no refund/reversal API). Only operators the
   * disbursement API supports can be refunded automatically; for M-Pesa and
   * Halopesa payers this throws UNSUPPORTED_DESTINATION and the refund goes
   * to the admin's manual list.
   */
  async refund(input: RefundInput): Promise<RefundResult> {
    const mno = input.payerPhone ? deriveMno(input.payerPhone) : null;
    if (!mno || input.payerPhone === null) {
      throw new MobileMoneyError('UNSUPPORTED_DESTINATION', 'payer wallet unknown; refund manually');
    }
    const result = await this.disburse({
      operator: OPERATOR_BY_NETWORK[mno.network] ?? 'MPESA',
      accountNumber: input.payerPhone,
      accountName: input.payerName ?? 'Daktari Mkononi patient',
      amountTzs: input.amountTzs,
      reference: input.reference,
      remarks: `Refund: ${input.reason}`.slice(0, 100),
    });
    if (result.status === 'FAILED' || result.providerReference === null) {
      return { refundReference: result.providerReference ?? '', status: 'FAILED' };
    }
    return { refundReference: result.providerReference, status: 'PENDING' };
  }

  queryRefundStatus(refundReference: string, hint?: StatusHint): Promise<QueryStatusResult> {
    const mno = hint?.phoneE164 ? deriveMno(hint.phoneE164) : null;
    const operator = mno ? OPERATOR_BY_NETWORK[mno.network] : undefined;
    const bankName = operator ? azamPayDisburseBankName(operator) : null;
    return this.transactionStatus(refundReference, bankName !== null ? { bankName } : {}, 'read');
  }

  // ── Name lookup ────────────────────────────────────────────────────────────

  async nameLookup(input: NameLookupInput): Promise<NameLookupResult> {
    const bankName =
      input.operator !== null
        ? (azamPayDisburseBankName(input.operator) ?? input.operator.toLowerCase())
        : (input.bankName ?? '');
    const accountNumber = input.accountNumber.replace('+', '');
    const pem = this.options.checksumPublicKeyPem;
    const token = await this.disbursementToken();
    const response = await this.request(
      'POST',
      `${this.disbursementBaseUrl}/api/v1/azampay/namelookup`,
      {
        bankName,
        accountNumber,
        ...(pem !== undefined
          ? { checksum: azamPayChecksum(this.checksumInput.nameLookup({ bankName, accountNumber }), pem) }
          : {}),
      },
      token,
      'read',
    );
    const parsed = this.parse(nameLookupResponseSchema, response, 'namelookup');
    const name =
      parsed.name?.trim() || [parsed.fname, parsed.lname].filter((part) => part?.trim()).join(' ').trim() || null;
    return {
      found: parsed.status !== false && name !== null,
      name,
      ...(parsed.message ? { message: parsed.message } : {}),
    };
  }

  // ── HTTP plumbing ──────────────────────────────────────────────────────────

  /**
   * Every AzamPay call has a deadline. Retry rules:
   *  - 'read' calls (token, status, name lookup) are idempotent: retried on
   *    network errors, timeouts, 429 and 5xx with backoff. 'fast-read' is a
   *    read made inside a webhook: one attempt, short deadline — a slow
   *    status host must not hold AzamPay's callback open.
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
    kind: 'read' | 'fast-read' | 'write',
    extra: { apiKey?: boolean } = {},
  ): Promise<unknown> {
    const attempts = kind === 'read' ? this.retryDelaysMs.length + 1 : 1;
    let lastError: MobileMoneyError | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(this.retryDelaysMs[attempt - 1] ?? 0);
      try {
        return await this.requestOnce(method, url, body, bearer, kind, extra);
      } catch (error) {
        if (!(error instanceof RetryableError)) throw error;
        lastError = error.mapped;
      }
    }
    throw lastError ?? new MobileMoneyError('PROVIDER_UNAVAILABLE', `provider call failed: ${new URL(url).host}`);
  }

  private async requestOnce(
    method: 'GET' | 'POST',
    url: string,
    body: Record<string, unknown> | undefined,
    bearer: string | undefined,
    kind: 'read' | 'fast-read' | 'write',
    extra: { apiKey?: boolean } = {},
  ): Promise<unknown> {
    const parsedUrl = new URL(url);
    // Host + path, never the query string: the exact host is what diagnoses a
    // wrong-environment call, and neither carries a secret.
    const label = `${method} ${parsedUrl.host}${parsedUrl.pathname}`;
    const afterSend = (detail: string, cause?: unknown): MobileMoneyError =>
      new MobileMoneyError(kind === 'write' ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', detail, cause);
    const started = this.now().getTime();
    const report = (status: number | null, outcome: string): void => {
      this.options.onRequest?.({
        method,
        host: parsedUrl.host,
        path: parsedUrl.pathname,
        status,
        outcome,
        durationMs: Math.max(0, this.now().getTime() - started),
      });
    };
    const deadlineMs =
      kind === 'write'
        ? this.timeouts.writeMs
        : kind === 'fast-read'
          ? Math.min(this.timeouts.readMs, FAST_READ_TIMEOUT_MS)
          : this.timeouts.readMs;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(bearer !== undefined ? { authorization: `Bearer ${bearer}` } : {}),
          ...(extra.apiKey === true && this.options.apiKey !== undefined ? { 'x-api-key': this.options.apiKey } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(deadlineMs),
      });
    } catch (error) {
      const code = networkErrorCode(error);
      if (neverReachedProvider(error)) {
        report(null, `unreachable:${code}`);
        throw new RetryableError(
          new MobileMoneyError('PROVIDER_UNAVAILABLE', `could not reach provider (${code}): ${label}`, error),
        );
      }
      const timedOut =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      report(null, timedOut ? 'timeout' : `network:${code}`);
      const mapped = afterSend(`${timedOut ? 'timeout' : `network failure (${code})`} on ${label}`, error);
      if (kind === 'write') throw mapped;
      throw new RetryableError(mapped);
    }
    report(response.status, response.ok ? 'ok' : 'http-error');

    if (response.status === 401 || response.status === 403) {
      this.cachedTokens.clear(); // force re-auth on the next call (we cannot tell which authenticator issued it)
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
