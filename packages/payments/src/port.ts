/** Mobile-money aggregator port — implemented by AzamPayProvider and FakePayments. */

export type CollectionStatus = 'PENDING' | 'FAILED';
export type ProviderPaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED';
export type RefundStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface InitiateCollectionInput {
  /** Payer MSISDN, +255XXXXXXXXX. */
  phoneE164: string;
  /** Whole TZS — integers only (see money.ts). */
  amountTzs: number;
  currency: 'TZS';
  /** Our reference (Payment idempotencyKey) — echoed back by the provider. */
  externalReference: string;
  description: string;
}

export interface InitiateCollectionResult {
  providerReference: string;
  status: CollectionStatus;
}

export interface QueryStatusResult {
  providerReference: string;
  status: ProviderPaymentStatus;
  failureReason?: string;
}

export interface RefundInput {
  providerReference: string;
  amountTzs: number;
  reason: string;
}

export interface RefundResult {
  refundReference: string;
  status: RefundStatus;
}

export type MobileMoneyErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_MSISDN'
  | 'INSUFFICIENT_FUNDS_HINT'
  | 'NOT_CONFIGURED';

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
  queryStatus(providerReference: string): Promise<QueryStatusResult>;
  refund(input: RefundInput): Promise<RefundResult>;
}
