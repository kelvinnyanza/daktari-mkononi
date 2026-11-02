import { constants, generateKeyPairSync, randomUUID, sign as signData } from 'node:crypto';
import { azamPayCallbackSignedData, verifyAzamPayRsaSignature } from './azampay.js';
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
  type ProviderPaymentStatus,
  type QueryStatusResult,
  type RefundInput,
  type RefundResult,
} from './port.js';

type CollectionScript =
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'error'; error: MobileMoneyError };

type DisburseScript = 'pending' | 'failed' | MobileMoneyError;

interface ScriptedStatus {
  status: ProviderPaymentStatus;
  failureReason?: string;
  amountTzs?: number;
  providerFeeTzs?: number;
}

/**
 * Scripted MobileMoneyPort for tests and keyless dev: records every call,
 * lets tests choose initiation outcomes and later provider-side statuses (for
 * reconciliation), and builds AzamPay-shaped callback bodies SIGNED with its
 * own RSA key exactly as AzamPay documents (so the webhook route's signature
 * path is exercised for real, and replays are simulated by POSTing twice).
 */
export class FakePayments implements MobileMoneyPort {
  readonly collections: Array<InitiateCollectionInput & { providerReference: string }> = [];
  readonly refunds: RefundInput[] = [];
  readonly disbursements: Array<DisburseInput & { providerReference: string }> = [];
  readonly nameLookups: NameLookupInput[] = [];
  readonly statusQueries: string[] = [];
  private readonly collectionScript: CollectionScript[] = [];
  private refundScript: Array<'completed' | 'pending' | 'failed' | MobileMoneyError> = [];
  private readonly disburseScript: DisburseScript[] = [];
  /** providerReference → status returned by queryStatus / queryRefundStatus / queryDisbursementStatus. */
  readonly providerStatuses = new Map<string, ScriptedStatus>();
  /** MSISDN / account → holder name returned by nameLookup (missing ⇒ not found). */
  readonly accountNames = new Map<string, string>();
  private readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  /** The PEM a test would "fetch" from /azampay/v1/public-key. */
  readonly publicKeyPem = this.keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  /** Set to simulate the public-key fetch failing. */
  publicKeyUnavailable = false;

  nextCollectionFails(): this {
    this.collectionScript.push({ kind: 'failed' });
    return this;
  }

  nextCollectionThrows(code: MobileMoneyError['code']): this {
    this.collectionScript.push({ kind: 'error', error: new MobileMoneyError(code, `scripted ${code}`) });
    return this;
  }

  nextRefund(outcome: 'completed' | 'pending' | 'failed'): this {
    this.refundScript.push(outcome);
    return this;
  }

  nextRefundThrows(code: MobileMoneyError['code']): this {
    this.refundScript.push(new MobileMoneyError(code, `scripted ${code}`));
    return this;
  }

  nextDisbursement(outcome: 'pending' | 'failed'): this {
    this.disburseScript.push(outcome);
    return this;
  }

  nextDisbursementThrows(code: MobileMoneyError['code']): this {
    this.disburseScript.push(new MobileMoneyError(code, `scripted ${code}`));
    return this;
  }

  /** Mark what the provider will answer for a status query on `providerReference`. */
  setProviderStatus(
    providerReference: string,
    status: ProviderPaymentStatus,
    failureReason?: string,
    extra: { amountTzs?: number; providerFeeTzs?: number } = {},
  ): void {
    this.providerStatuses.set(providerReference, {
      status,
      ...(failureReason !== undefined ? { failureReason } : {}),
      ...extra,
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
    const refundReference = `fake-refund-${randomUUID()}`;
    if (script === 'pending') this.providerStatuses.set(refundReference, { status: 'PENDING' });
    return Promise.resolve({
      refundReference,
      status: script === 'completed' ? 'COMPLETED' : script === 'pending' ? 'PENDING' : 'FAILED',
    });
  }

  queryRefundStatus(refundReference: string): Promise<QueryStatusResult> {
    return this.queryStatus(refundReference);
  }

  disburse(input: DisburseInput): Promise<DisburseResult> {
    const script = this.disburseScript.shift() ?? 'pending';
    if (script instanceof MobileMoneyError) return Promise.reject(script);
    const providerReference = `fake-disb-${randomUUID()}`;
    this.disbursements.push({ ...input, providerReference });
    if (script === 'failed') return Promise.resolve({ providerReference, status: 'FAILED', message: 'scripted failure' });
    this.providerStatuses.set(providerReference, { status: 'PENDING' });
    return Promise.resolve({ providerReference, status: 'PENDING' });
  }

  queryDisbursementStatus(providerReference: string): Promise<QueryStatusResult> {
    return this.queryStatus(providerReference);
  }

  nameLookup(input: NameLookupInput): Promise<NameLookupResult> {
    this.nameLookups.push(input);
    const name = this.accountNames.get(input.accountNumber) ?? null;
    return Promise.resolve({ found: name !== null, name });
  }

  verifyCallbackSignature(fields: CheckoutCallbackSignedFields): Promise<CallbackSignatureCheck> {
    const signature = fields.signature;
    if (signature === undefined || signature === null || signature === '') return Promise.resolve('absent');
    if (this.publicKeyUnavailable) return Promise.resolve('unverifiable');
    if (verifyAzamPayRsaSignature(azamPayCallbackSignedData(fields), signature, this.publicKeyPem)) {
      return Promise.resolve('valid');
    }
    if (verifyAzamPayRsaSignature(`${fields.utilityref}${fields.externalreference}`, signature, this.publicKeyPem)) {
      return Promise.resolve('refs-only');
    }
    return Promise.resolve('invalid');
  }

  /** Sign `data` the way AzamPay does (RSA-SHA256, PKCS#1 v1.5, base64). */
  sign(data: string): string {
    return signData('sha256', Buffer.from(data, 'utf8'), {
      key: this.keys.privateKey,
      padding: constants.RSA_PKCS1_PADDING,
    }).toString('base64');
  }

  /**
   * Build an AzamPay-shaped checkout callback for a recorded collection,
   * signed over the documented 4-field string unless `signature` overrides.
   */
  webhookBodyFor(
    providerReference: string,
    status: 'success' | 'failure',
    options: { message?: string; amount?: string; signature?: string | null; operator?: string } = {},
  ): Record<string, unknown> {
    const collection = this.collections.find((entry) => entry.providerReference === providerReference);
    if (!collection) throw new Error(`FakePayments: no collection ${providerReference}`);
    const fields = {
      utilityref: collection.externalReference,
      externalreference: providerReference,
      transactionstatus: status,
      operator: options.operator ?? 'Tigo',
    };
    return {
      ...fields,
      message: options.message ?? (status === 'success' ? 'Transaction completed successfully' : 'failed'),
      user: 'merchant_user',
      password: 'merchant_password',
      clientId: 'client_123',
      reference: `ref-${providerReference}`,
      amount: options.amount ?? String(collection.amountTzs),
      transid: `tx-${providerReference}`,
      msisdn: collection.phoneE164.replace('+', ''),
      mnoreference: `mno-${providerReference}`,
      signature:
        options.signature === undefined ? this.sign(azamPayCallbackSignedData(fields)) : options.signature,
    };
  }
}
