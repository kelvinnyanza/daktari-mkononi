import { randomUUID } from 'node:crypto';
import {
  MobileMoneyError,
  type InitiateCollectionInput,
  type InitiateCollectionResult,
  type MobileMoneyPort,
  type ProviderPaymentStatus,
  type QueryStatusResult,
  type RefundInput,
  type RefundResult,
} from './port.js';

type CollectionScript =
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'error'; error: MobileMoneyError };

/**
 * Scripted MobileMoneyPort for tests: records every call, lets tests choose
 * initiation outcomes and later provider-side statuses (for reconciliation),
 * and builds webhook payloads so duplicate/delayed delivery is simulated by
 * simply POSTing them (twice) to the webhook route.
 */
export class FakePayments implements MobileMoneyPort {
  readonly collections: Array<InitiateCollectionInput & { providerReference: string }> = [];
  readonly refunds: RefundInput[] = [];
  readonly statusQueries: string[] = [];
  private readonly collectionScript: CollectionScript[] = [];
  private refundScript: Array<'completed' | 'failed' | MobileMoneyError> = [];
  /** providerReference → status returned by queryStatus. */
  readonly providerStatuses = new Map<string, { status: ProviderPaymentStatus; failureReason?: string }>();

  nextCollectionFails(): this {
    this.collectionScript.push({ kind: 'failed' });
    return this;
  }

  nextCollectionThrows(code: MobileMoneyError['code']): this {
    this.collectionScript.push({ kind: 'error', error: new MobileMoneyError(code, `scripted ${code}`) });
    return this;
  }

  nextRefund(outcome: 'completed' | 'failed'): this {
    this.refundScript.push(outcome);
    return this;
  }

  nextRefundThrows(code: MobileMoneyError['code']): this {
    this.refundScript.push(new MobileMoneyError(code, `scripted ${code}`));
    return this;
  }

  /** Mark what the provider will answer for queryStatus(reference). */
  setProviderStatus(providerReference: string, status: ProviderPaymentStatus, failureReason?: string): void {
    this.providerStatuses.set(providerReference, {
      status,
      ...(failureReason !== undefined ? { failureReason } : {}),
    });
  }

  initiateCollection(input: InitiateCollectionInput): Promise<InitiateCollectionResult> {
    const script = this.collectionScript.shift() ?? { kind: 'pending' };
    if (script.kind === 'error') return Promise.reject(script.error);
    const providerReference = `fake-mm-${randomUUID()}`;
    this.collections.push({ ...input, providerReference });
    if (script.kind === 'failed') {
      return Promise.resolve({ providerReference, status: 'FAILED' });
    }
    this.providerStatuses.set(providerReference, { status: 'PENDING' });
    return Promise.resolve({ providerReference, status: 'PENDING' });
  }

  queryStatus(providerReference: string): Promise<QueryStatusResult> {
    this.statusQueries.push(providerReference);
    const entry = this.providerStatuses.get(providerReference);
    if (!entry) {
      return Promise.reject(
        new MobileMoneyError('PROVIDER_UNAVAILABLE', `unknown reference ${providerReference}`),
      );
    }
    return Promise.resolve({ providerReference, ...entry });
  }

  refund(input: RefundInput): Promise<RefundResult> {
    const script = this.refundScript.shift() ?? 'completed';
    if (script instanceof MobileMoneyError) return Promise.reject(script);
    this.refunds.push(input);
    return Promise.resolve({
      refundReference: `fake-refund-${randomUUID()}`,
      status: script === 'completed' ? 'COMPLETED' : 'FAILED',
    });
  }

  /** Build a provider-shaped webhook body for a recorded collection. */
  webhookBodyFor(
    providerReference: string,
    status: 'success' | 'failure',
    message?: string,
  ): Record<string, unknown> {
    const collection = this.collections.find((entry) => entry.providerReference === providerReference);
    if (!collection) throw new Error(`FakePayments: no collection ${providerReference}`);
    return {
      transactionId: providerReference,
      externalReference: collection.externalReference,
      status,
      amount: collection.amountTzs,
      currency: 'TZS',
      ...(message !== undefined ? { message } : {}),
    };
  }
}
