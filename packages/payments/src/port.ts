/**
 * Mobile-money aggregator port — implemented by AzamPayProvider and FakePayments.
 *
 * Covers the four AzamPay surfaces we use (developerdocs.azampay.co.tz,
 * Tanzania API v1): MNO checkout (collections), transaction status,
 * disbursement (doctor payouts AND refunds — AzamPay publishes no refund
 * API), and account name lookup. Plus verification of the checkout callback's
 * RSA signature.
 */

export type CollectionStatus = 'PENDING' | 'FAILED';
export type ProviderPaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED';
export type RefundStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface InitiateCollectionInput {
  /** Payer MSISDN, +255XXXXXXXXX. */
  phoneE164: string;
  /** Whole TZS — integers only (see money.ts). */
  amountTzs: number;
  currency: 'TZS';
  /** Our reference (Payment idempotencyKey) — echoed back as the callback's `utilityref`. */
  externalReference: string;
  description: string;
}

export interface InitiateCollectionResult {
  /** AzamPay's transactionId; null when the provider returned none. */
  providerReference: string | null;
  status: CollectionStatus;
  /** Provider message on a rejected initiation (never contains secrets). */
  message?: string;
}

export interface StatusHint {
  /** Payer / destination MSISDN — selects the operator the status API asks for. */
  phoneE164?: string | null;
  /** Explicit AzamPay bankName, when known (payouts). */
  bankName?: string;
  /** Webhook path: one attempt, short deadline (never hold the provider's callback open). */
  fast?: boolean;
}

export interface QueryStatusResult {
  providerReference: string;
  status: ProviderPaymentStatus;
  failureReason?: string;
  /** Whole TZS the provider says moved, when its answer carries an amount. */
  amountTzs?: number;
  /** AzamPay's own charge, when its answer carries one. */
  providerFeeTzs?: number;
  /** Provider's message on a non-final answer ("not found", …) — diagnostics only. */
  providerMessage?: string;
}

export interface RefundInput {
  /** The original collection's AzamPay reference (for the audit trail). */
  providerReference: string;
  amountTzs: number;
  reason: string;
  /** Refunds are paid back to this wallet. */
  payerPhone: string | null;
  payerName: string | null;
  /** Our unique reference for this refund attempt (≤ 30 chars, AzamPay limit). */
  reference: string;
}

export interface RefundResult {
  /** AzamPay pgReferenceId of the refund disbursement, when one was created. */
  refundReference: string;
  status: RefundStatus;
}

export type PayoutDestinationOperator =
  | 'MPESA'
  | 'TIGO_PESA'
  | 'AIRTEL_MONEY'
  | 'HALOPESA'
  | 'AZAMPESA';

export interface NameLookupInput {
  /** Mobile-money operator, or null for a bank account. */
  operator: PayoutDestinationOperator | null;
  /** Bank name for bank accounts. */
  bankName: string | null;
  /** MSISDN (+255…) or bank account number. */
  accountNumber: string;
}

export interface NameLookupResult {
  found: boolean;
  /** Account holder name as the provider has it. */
  name: string | null;
  message?: string;
}

export interface DisburseInput {
  operator: PayoutDestinationOperator;
  /** Destination MSISDN, +255XXXXXXXXX. */
  accountNumber: string;
  /** Verified account-holder name. */
  accountName: string;
  amountTzs: number;
  /** Our idempotency reference for this attempt (≤ 30 chars). */
  reference: string;
  remarks: string;
}

export interface DisburseResult {
  /** AzamPay pgReferenceId; null when none was returned. */
  providerReference: string | null;
  status: 'PENDING' | 'FAILED';
  message?: string;
}

/** Fields of a checkout callback that its signature covers (see azampay.ts). */
export interface CheckoutCallbackSignedFields {
  utilityref: string;
  externalreference: string;
  transactionstatus: string;
  operator: string;
  signature: string | null | undefined;
}

/**
 * valid       — RSA signature over the documented 4-field string verifies
 * refs-only   — verifies only over {utilityref}{externalreference} (the docs'
 *               other wording): binds the references, NOT the status
 * absent      — no signature field
 * invalid     — present, verifies over neither form
 * unverifiable— no callback public key is configured (treated as unsigned)
 */
export type CallbackSignatureCheck = 'valid' | 'refs-only' | 'absent' | 'invalid' | 'unverifiable';

/**
 * PROVIDER_UNAVAILABLE — the request certainly did not take effect (never
 * sent, or refused before processing): safe to fail and retry.
 * OUTCOME_UNKNOWN — a money-moving request (checkout, disbursement) was sent
 * but no reliable answer came back (timeout, connection reset, 5xx). The
 * money MAY have moved: never mark it failed; leave it for the status check,
 * callback or statement.
 * UNSUPPORTED_DESTINATION — AzamPay's disbursement API cannot pay this
 * operator / bank (it lists tigo, airtel, azampesa only): pay manually.
 * NOT_SUPPORTED — the provider has no way to answer this (e.g. checkout
 * status with AZAMPAY_CHECKOUT_STATUS_QUERY=off): settle by callback or statement.
 */
export type MobileMoneyErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'OUTCOME_UNKNOWN'
  | 'INVALID_MSISDN'
  | 'INSUFFICIENT_FUNDS_HINT'
  | 'UNSUPPORTED_DESTINATION'
  | 'NOT_CONFIGURED'
  | 'NOT_SUPPORTED';

export class MobileMoneyError extends Error {
  constructor(
    readonly code: MobileMoneyErrorCode,
    detail: string,
    cause?: unknown,
  ) {
    super(detail, cause === undefined ? undefined : { cause });
    this.name = 'MobileMoneyError';
  }
}

export interface MobileMoneyPort {
  initiateCollection(input: InitiateCollectionInput): Promise<InitiateCollectionResult>;
  queryStatus(providerReference: string, hint?: StatusHint): Promise<QueryStatusResult>;
  /** Full refund to the payer's wallet (a disbursement — AzamPay has no refund API). */
  refund(input: RefundInput): Promise<RefundResult>;
  queryRefundStatus(refundReference: string, hint?: StatusHint): Promise<QueryStatusResult>;
  verifyCallbackSignature(fields: CheckoutCallbackSignedFields): Promise<CallbackSignatureCheck>;
  nameLookup(input: NameLookupInput): Promise<NameLookupResult>;
  disburse(input: DisburseInput): Promise<DisburseResult>;
  queryDisbursementStatus(providerReference: string, hint?: StatusHint): Promise<QueryStatusResult>;
}
