import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FEE_RATES,
  MAX_COMMISSION_BPS,
  MAX_VAT_BPS,
  calculateFees,
  percentToBps,
} from '../src/money.js';
import { MNO_PREFIXES, deriveMno } from '../src/mno-prefixes.js';
import { AzamPayProvider, verifyAzamPayWebhookSignature } from '../src/azampay.js';
import { FakePayments } from '../src/fake.js';

describe('calculateFees (money invariants, Phase 13a)', () => {
  const MODES = ['ON_TOP_OF_COMMISSION', 'INCLUDED_IN_COMMISSION'] as const;

  it('property: parts always sum exactly to the fee and nothing is negative, across random fees and rates', () => {
    // Deterministic PRNG so a failure is reproducible.
    let seed = 0x13a;
    const rand = (max: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % (max + 1);
    };
    for (let i = 0; i < 20_000; i += 1) {
      const fee = i % 10 === 0 ? rand(20) : rand(5_000_000); // tiny fees hit rounding edges
      const rates = {
        commissionBps: rand(MAX_COMMISSION_BPS),
        vatEnabled: rand(1) === 1,
        vatBps: rand(MAX_VAT_BPS),
        vatMode: MODES[rand(1)]!,
      };
      const parts = calculateFees(fee, rates);
      expect(parts.platformCommissionTzs + parts.vatTzs + parts.doctorAmountTzs).toBe(fee);
      for (const value of [parts.platformCommissionTzs, parts.vatTzs, parts.doctorAmountTzs]) {
        expect(Number.isSafeInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      expect(parts.deductedFromDoctorTzs).toBe(fee - parts.doctorAmountTzs);
      if (!rates.vatEnabled) expect(parts.vatTzs).toBe(0);
    }
  });

  it('worked examples (20% commission, 18% VAT on top — the defaults)', () => {
    expect(DEFAULT_FEE_RATES).toEqual({
      commissionBps: 2_000,
      vatEnabled: true,
      vatBps: 1_800,
      vatMode: 'ON_TOP_OF_COMMISSION',
    });
    const at = (fee: number) => calculateFees(fee, DEFAULT_FEE_RATES);
    expect(at(15_000)).toMatchObject({ platformCommissionTzs: 3_000, vatTzs: 540, doctorAmountTzs: 11_460 });
    expect(at(20_000)).toMatchObject({ platformCommissionTzs: 4_000, vatTzs: 720, doctorAmountTzs: 15_280 });
    expect(at(50_000)).toMatchObject({ platformCommissionTzs: 10_000, vatTzs: 1_800, doctorAmountTzs: 38_200 });
  });

  it('included mode: the commission already contains the VAT', () => {
    const included = { ...DEFAULT_FEE_RATES, vatMode: 'INCLUDED_IN_COMMISSION' as const };
    // 15,000 × 20% = 3,000 gross; VAT = round(3000 × 18/118) = round(457.63) = 458.
    expect(calculateFees(15_000, included)).toMatchObject({
      platformCommissionTzs: 2_542,
      vatTzs: 458,
      doctorAmountTzs: 12_000,
      deductedFromDoctorTzs: 3_000,
    });
  });

  it('rounds commission and VAT half-up; the doctor takes the exact residual', () => {
    // 15,005 × 20% = 3,001; VAT 3,001 × 18% = 540.18 → 540; doctor 11,464.
    expect(calculateFees(15_005, DEFAULT_FEE_RATES)).toMatchObject({
      platformCommissionTzs: 3_001,
      vatTzs: 540,
      doctorAmountTzs: 11_464,
    });
    // 12,503 × 20% = 2,500.6 → 2,501; VAT 450.18 → 450.
    expect(calculateFees(12_503, DEFAULT_FEE_RATES)).toMatchObject({ platformCommissionTzs: 2_501, vatTzs: 450 });
    // Exactly .5 rounds up: 2.5 → 3 (fee 25 at 10%), VAT 18% of 3 = 0.54 → 1.
    expect(calculateFees(25, { ...DEFAULT_FEE_RATES, commissionBps: 1_000 })).toMatchObject({
      platformCommissionTzs: 3,
      vatTzs: 1,
      doctorAmountTzs: 21,
    });
    expect(calculateFees(15_000, { ...DEFAULT_FEE_RATES, vatEnabled: false })).toMatchObject({
      platformCommissionTzs: 3_000,
      vatTzs: 0,
      doctorAmountTzs: 12_000,
    });
  });

  it('rejects floats, negatives and out-of-range rates; percent ↔ bps is exact to 2 decimals', () => {
    expect(() => calculateFees(100.5, DEFAULT_FEE_RATES)).toThrow(RangeError);
    expect(() => calculateFees(-1, DEFAULT_FEE_RATES)).toThrow(RangeError);
    expect(() => calculateFees(100, { ...DEFAULT_FEE_RATES, commissionBps: MAX_COMMISSION_BPS + 1 })).toThrow(RangeError);
    expect(() => calculateFees(100, { ...DEFAULT_FEE_RATES, commissionBps: -1 })).toThrow(RangeError);
    expect(() => calculateFees(100, { ...DEFAULT_FEE_RATES, vatBps: 12.5 })).toThrow(RangeError);
    expect(percentToBps(20)).toBe(2_000);
    expect(percentToBps(12.5)).toBe(1_250);
    expect(percentToBps(12.345)).toBeNull();
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

describe('AzamPay timeouts and retry rules (Phase 13a)', () => {
  const tokenResponse = (): Response =>
    new Response(
      JSON.stringify({ data: { accessToken: 't', expire: new Date(Date.now() + 3600_000).toISOString() } }),
      { status: 200 },
    );
  const collection = {
    phoneE164: '+255712345678',
    amountTzs: 15_000,
    currency: 'TZS' as const,
    externalReference: 'appt-1:1',
    description: 'Consultation',
  };
  /** Never answers; rejects only when the request's deadline aborts it. */
  const hang = (init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason as Error);
      });
    });
  const make = (fetchImpl: typeof fetch): AzamPayProvider =>
    new AzamPayProvider({
      appName: 'a',
      clientId: 'b',
      clientSecret: 'c',
      fetchImpl,
      timeouts: { readMs: 50, writeMs: 50 },
      retryDelaysMs: [0, 0],
    });

  it('a checkout timeout is OUTCOME_UNKNOWN (money may have moved) and is never retried', async () => {
    let checkouts = 0;
    const provider = make((async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(url).includes('GenerateToken')) return tokenResponse();
      checkouts += 1;
      return hang(init);
    }) as typeof fetch);
    await expect(provider.initiateCollection(collection)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(checkouts).toBe(1);
  });

  it('a checkout 5xx is OUTCOME_UNKNOWN, not a failure; connection refused is PROVIDER_UNAVAILABLE', async () => {
    const fivexx = make((async (url: Parameters<typeof fetch>[0]) =>
      String(url).includes('GenerateToken') ? tokenResponse() : new Response('', { status: 502 })) as typeof fetch);
    await expect(fivexx.initiateCollection(collection)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });

    const refused = make((async (url: Parameters<typeof fetch>[0]) => {
      if (String(url).includes('GenerateToken')) return tokenResponse();
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }) as typeof fetch);
    await expect(refused.initiateCollection(collection)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('reads (token, status) are retried on 5xx / timeouts and then succeed', async () => {
    let tokenCalls = 0;
    let statusCalls = 0;
    const provider = make((async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(url).includes('GenerateToken')) {
        tokenCalls += 1;
        return tokenCalls === 1 ? new Response('', { status: 503 }) : tokenResponse();
      }
      statusCalls += 1;
      if (statusCalls === 1) return hang(init);
      return new Response(JSON.stringify({ data: { transactionStatus: 'success' } }), { status: 200 });
    }) as typeof fetch);
    const status = await provider.queryStatus('pg-1');
    expect(status.status).toBe('COMPLETED');
    expect(tokenCalls).toBe(2);
    expect(statusCalls).toBe(2);
  });

  it('a read that keeps failing gives up after the retry budget with PROVIDER_UNAVAILABLE', async () => {
    let calls = 0;
    const provider = make((async () => {
      calls += 1;
      return new Response('', { status: 500 });
    }) as typeof fetch);
    await expect(provider.queryStatus('pg-1')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(calls).toBe(3); // token: 1 try + 2 retries, then give up
  });
});
