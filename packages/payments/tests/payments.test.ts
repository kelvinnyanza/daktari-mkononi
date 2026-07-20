import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLATFORM_FEE_PERCENT, splitFee } from '../src/money.js';
import { MNO_PREFIXES, deriveMno } from '../src/mno-prefixes.js';
import { AzamPayProvider, verifyAzamPayWebhookSignature } from '../src/azampay.js';
import { FakePayments } from '../src/fake.js';

describe('splitFee (money invariants)', () => {
  it('holds the invariant platformFee + doctorAmount === amount across many random amounts', () => {
    // Property-style: 10,000 random integer amounts × several fee levels.
    for (let i = 0; i < 10_000; i += 1) {
      const amount = Math.floor(Math.random() * 1_000_000);
      const feePercent = [0, 5, 10, 15, 33, 50, 100][i % 7]!;
      const { platformFeeTzs, doctorAmountTzs } = splitFee(amount, feePercent);

      expect(platformFeeTzs + doctorAmountTzs).toBe(amount); // never a shilling lost
      expect(Number.isSafeInteger(platformFeeTzs)).toBe(true);
      expect(Number.isSafeInteger(doctorAmountTzs)).toBe(true);
      expect(platformFeeTzs).toBeGreaterThanOrEqual(0);
      expect(doctorAmountTzs).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives the rounding remainder to the platform', () => {
    // 10% of 25,001: doctor floor(25001*90/100)=22500 (remainder 1 → platform)
    expect(splitFee(25_001, 10)).toEqual({ platformFeeTzs: 2_501, doctorAmountTzs: 22_500 });
    // Exact division: no remainder anywhere.
    expect(splitFee(25_000, 10)).toEqual({ platformFeeTzs: 2_500, doctorAmountTzs: 22_500 });
    // Tiny amounts: platform absorbs everything the floor drops.
    expect(splitFee(1, 10)).toEqual({ platformFeeTzs: 1, doctorAmountTzs: 0 });
    expect(splitFee(0, 10)).toEqual({ platformFeeTzs: 0, doctorAmountTzs: 0 });
  });

  it('rejects floats and out-of-range percents', () => {
    expect(() => splitFee(100.5, 10)).toThrow(RangeError);
    expect(() => splitFee(-1, 10)).toThrow(RangeError);
    expect(() => splitFee(100, 12.5)).toThrow(RangeError);
    expect(() => splitFee(100, 101)).toThrow(RangeError);
    expect(DEFAULT_PLATFORM_FEE_PERCENT).toBe(10);
  });
});

describe('MNO prefix derivation', () => {
  it.each([
    ['+255742345678', 'VODACOM', 'Mpesa'],
    ['+255752345678', 'VODACOM', 'Mpesa'],
    ['+255762345678', 'VODACOM', 'Mpesa'],
    ['+255712345678', 'TIGO', 'Tigo'],
    ['+255652345678', 'TIGO', 'Tigo'],
    ['+255672345678', 'TIGO', 'Tigo'],
    ['+255682345678', 'AIRTEL', 'Airtel'],
    ['+255692345678', 'AIRTEL', 'Airtel'],
    ['+255782345678', 'AIRTEL', 'Airtel'],
    ['+255622345678', 'HALOTEL', 'Halopesa'],
  ])('%s → %s (%s)', (phone, network, azamProvider) => {
    const entry = deriveMno(phone)!;
    expect(entry.network).toBe(network);
    expect(entry.azamProvider).toBe(azamProvider);
  });

  it('returns null for unknown prefixes and malformed numbers', () => {
    expect(deriveMno('+255992345678')).toBeNull(); // unassigned prefix
    expect(deriveMno('0742345678')).toBeNull(); // not E.164
    expect(deriveMno('+254712345678')).toBeNull(); // Kenya — never Daraja
    expect(MNO_PREFIXES).toHaveLength(10);
  });
});

describe('AzamPayProvider', () => {
  it('reports NOT_CONFIGURED without credentials', async () => {
    const provider = new AzamPayProvider({
      appName: undefined,
      clientId: undefined,
      clientSecret: undefined,
    });
    await expect(
      provider.initiateCollection({
        phoneE164: '+255742345678',
        amountTzs: 10_000,
        currency: 'TZS',
        externalReference: 'x:1',
        description: 'test',
      }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('rejects non-Tanzanian MSISDNs before any network call', async () => {
    const provider = new AzamPayProvider({
      appName: 'app',
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl: (() => {
        throw new Error('must not be called');
      }) as unknown as typeof fetch,
    });
    await expect(
      provider.initiateCollection({
        phoneE164: '+254712345678',
        amountTzs: 10_000,
        currency: 'TZS',
        externalReference: 'x:1',
        description: 'test',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MSISDN' });
  });

  it('authenticates once (cached token), initiates checkout with the derived MNO', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const target = String(url);
      calls.push({ url: target, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (target.includes('GenerateToken')) {
        return new Response(
          JSON.stringify({
            data: { accessToken: 'tok-1', expire: new Date(Date.now() + 3600_000).toISOString() },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ transactionId: 'azam-123', success: true }), {
        status: 200,
      });
    }) as typeof fetch;

    const provider = new AzamPayProvider({
      appName: 'daktari',
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl,
    });
    const first = await provider.initiateCollection({
      phoneE164: '+255652345678',
      amountTzs: 20_000,
      currency: 'TZS',
      externalReference: 'appt-1:1',
      description: 'Consultation',
    });
    expect(first).toEqual({ providerReference: 'azam-123', status: 'PENDING' });

    await provider.initiateCollection({
      phoneE164: '+255652345678',
      amountTzs: 20_000,
      currency: 'TZS',
      externalReference: 'appt-2:1',
      description: 'Consultation',
    });

    const tokenCalls = calls.filter((call) => call.url.includes('GenerateToken'));
    expect(tokenCalls).toHaveLength(1); // expiry-aware cache: one auth for two checkouts

    const checkout = calls.find((call) => call.url.includes('mno/checkout'))!;
    expect((checkout.body as { provider: string }).provider).toBe('Tigo');
    expect((checkout.body as { amount: string }).amount).toBe('20000'); // whole TZS, stringified
  });

  it('maps an insufficient-funds hint to the typed error', async () => {
    const fetchImpl = (async (url: Parameters<typeof fetch>[0]) => {
      if (String(url).includes('GenerateToken')) {
        return new Response(
          JSON.stringify({ data: { accessToken: 't', expire: new Date(Date.now() + 3600_000).toISOString() } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ transactionId: 'azam-1', success: false, message: 'Insufficient funds on wallet' }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = new AzamPayProvider({ appName: 'a', clientId: 'b', clientSecret: 'c', fetchImpl });
    await expect(
      provider.initiateCollection({
        phoneE164: '+255742345678',
        amountTzs: 999_999,
        currency: 'TZS',
        externalReference: 'x:1',
        description: 'test',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS_HINT' });
  });
});

describe('webhook signature helper', () => {
  const secret = 'whsec-super-secret-value';
  const body = JSON.stringify({ transactionId: 't1', status: 'success' });
  const sign = (payload: string, key: string): string =>
    createHmac('sha256', key).update(payload, 'utf8').digest('hex');

  it('accepts a valid signature and rejects everything else', () => {
    expect(verifyAzamPayWebhookSignature(body, sign(body, secret), secret)).toBe(true);
    expect(verifyAzamPayWebhookSignature(body, sign(body, 'wrong-secret'), secret)).toBe(false);
    expect(verifyAzamPayWebhookSignature(`${body} `, sign(body, secret), secret)).toBe(false); // body tampered
    expect(verifyAzamPayWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyAzamPayWebhookSignature(body, 'zz-not-hex', secret)).toBe(false);
    expect(verifyAzamPayWebhookSignature(body, sign(body, secret), undefined)).toBe(false);
  });
});

describe('FakePayments', () => {
  it('records collections, serves scripted statuses, and builds webhook bodies', async () => {
    const fake = new FakePayments();
    const result = await fake.initiateCollection({
      phoneE164: '+255742345678',
      amountTzs: 15_000,
      currency: 'TZS',
      externalReference: 'appt-9:1',
      description: 'Consultation',
    });
    expect(result.status).toBe('PENDING');

    fake.setProviderStatus(result.providerReference, 'COMPLETED');
    const status = await fake.queryStatus(result.providerReference);
    expect(status.status).toBe('COMPLETED');

    const webhook = fake.webhookBodyFor(result.providerReference, 'success');
    expect(webhook).toMatchObject({
      transactionId: result.providerReference,
      externalReference: 'appt-9:1',
      amount: 15_000,
      currency: 'TZS',
    });
  });
});
