import { constants, createHash, generateKeyPairSync, privateDecrypt, sign as rsaSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FEE_RATES,
  MAX_COMMISSION_BPS,
  MAX_VAT_BPS,
  calculateFees,
  percentToBps,
} from '../src/money.js';
import { MNO_PREFIXES, deriveMno } from '../src/mno-prefixes.js';
import { AzamPayProvider, isRsaPublicKeyPem, parseAzamPayAmount, type AzamPayRequestEvent } from '../src/azampay.js';
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
    const violations: unknown[] = [];
    for (let i = 0; i < 20_000; i += 1) {
      const fee = i % 10 === 0 ? rand(20) : rand(5_000_000); // tiny fees hit rounding edges
      const rates = {
        commissionBps: rand(MAX_COMMISSION_BPS),
        vatEnabled: rand(1) === 1,
        vatBps: rand(MAX_VAT_BPS),
        vatMode: MODES[rand(1)]!,
      };
      const parts = calculateFees(fee, rates);
      // Plain checks per case (expect() ×20,000 is slow under parallel CI load);
      // the first violation is reported with its inputs.
      const values = [parts.platformCommissionTzs, parts.vatTzs, parts.doctorAmountTzs];
      const ok =
        values[0]! + values[1]! + values[2]! === fee &&
        values.every((value) => Number.isSafeInteger(value) && value >= 0) &&
        parts.deductedFromDoctorTzs === fee - parts.doctorAmountTzs &&
        (rates.vatEnabled || parts.vatTzs === 0);
      if (!ok) violations.push({ fee, rates, parts });
    }
    expect(violations.slice(0, 3)).toEqual([]);
  }, 30_000);

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
    expect(checkout.url).toBe('https://sandbox.azampay.co.tz/azampay/mno/checkout');
    // Spec CheckoutRequest: amount is a number (whole TZS), externalId is our reference.
    expect(checkout.body).toMatchObject({
      accountNumber: '255652345678',
      amount: 20_000,
      currency: 'TZS',
      externalId: 'appt-1:1',
      provider: 'Tigo',
    });
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

    const reference = result.providerReference!;
    fake.setProviderStatus(reference, 'COMPLETED');
    const status = await fake.queryStatus(reference);
    expect(status.status).toBe('COMPLETED');

    // AzamPay CallbackRequest shape, signed like AzamPay signs it.
    const webhook = fake.webhookBodyFor(reference, 'success');
    expect(webhook).toMatchObject({
      utilityref: 'appt-9:1',
      externalreference: reference,
      transactionstatus: 'success',
      amount: '15000',
    });
    await expect(
      fake.verifyCallbackSignature({
        utilityref: 'appt-9:1',
        externalreference: reference,
        transactionstatus: 'success',
        operator: 'Tigo',
        signature: webhook.signature as string,
      }),
    ).resolves.toBe('valid');
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

describe('AzamPay adapter vs the official spec (Phase 13a)', () => {
  const token = (): Response =>
    new Response(
      JSON.stringify({ data: { accessToken: 'tok', expire: new Date(Date.now() + 3600_000).toISOString() } }),
      { status: 200 },
    );
  type Call = { method: string; url: string; body: Record<string, unknown> | undefined; auth: string | undefined };
  function provider(
    respond: (call: Call) => Response | Promise<Response>,
    extra: Partial<ConstructorParameters<typeof AzamPayProvider>[0]> = {},
  ) {
    const calls: Call[] = [];
    const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? 'GET',
        url: String(url),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
        auth: (init?.headers as Record<string, string> | undefined)?.authorization,
      };
      calls.push(call);
      if (call.url.includes('GenerateToken')) return token();
      return respond(call);
    }) as typeof fetch;
    return {
      calls,
      azam: new AzamPayProvider({
        appName: 'daktari',
        clientId: 'id',
        clientSecret: 'secret',
        fetchImpl,
        retryDelaysMs: [0, 0],
        ...extra,
      }),
    };
  }
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

  it('status: GET {disbursement host}/api/v1/azampay/transactionstatus with pgReferenceId + bankName; parses data leniently', async () => {
    const { azam, calls } = provider(() =>
      json({ success: true, data: { transactionStatus: 'success', amount: '15000', fee: '300' } }),
    );
    const result = await azam.queryStatus('pg-123', { phoneE164: '+255712345678' });
    expect(result).toEqual({ providerReference: 'pg-123', status: 'COMPLETED', amountTzs: 15_000, providerFeeTzs: 300 });
    const statusCall = calls.find((call) => call.url.includes('transactionstatus'))!;
    expect(statusCall.url).toBe(
      'https://api-disbursement-test.azampay.co.tz/api/v1/azampay/transactionstatus?pgReferenceId=pg-123&bankName=Tigo',
    );
    expect(statusCall.auth).toBe('Bearer tok');
  });

  it('status: "Transaction not found" (success:false) stays PENDING — a status check never fails a payment', async () => {
    const { azam } = provider(() => json({ success: false, message: 'Transaction not found', statusCode: 404 }));
    await expect(azam.queryStatus('pg-x')).resolves.toMatchObject({
      status: 'PENDING',
      providerMessage: 'Transaction not found',
    });
  });

  it('checkout status query switched off → NOT_SUPPORTED without any HTTP call; disbursement status still works', async () => {
    const { azam, calls } = provider(() => json({ success: true, data: { status: 'success' } }), {
      checkoutStatusQuery: false,
    });
    await expect(azam.queryStatus('pg-x')).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    expect(calls).toHaveLength(0);
    await expect(azam.queryDisbursementStatus('pg-d', { bankName: 'tigo' })).resolves.toMatchObject({
      status: 'COMPLETED',
    });
  });

  it('disbursement-host calls use the disbursement authenticator when one is configured', async () => {
    const { azam, calls } = provider(() => json({ success: true, data: { status: 'success' } }), {
      disbursementAuthBaseUrl: 'https://authenticator-test.azampay.co.tz',
    });
    await azam.queryDisbursementStatus('pg-d', { bankName: 'tigo' });
    expect(calls.map((call) => call.url)).toEqual([
      'https://authenticator-test.azampay.co.tz/AppRegistration/GenerateToken',
      'https://api-disbursement-test.azampay.co.tz/api/v1/azampay/transactionstatus?pgReferenceId=pg-d&bankName=tigo',
    ]);
    await azam.initiateCollection({
      phoneE164: '+255742345678',
      amountTzs: 1_000,
      currency: 'TZS',
      externalReference: 'a:1',
      description: 'x',
    });
    expect(calls[2]!.url).toBe('https://authenticator-sandbox.azampay.co.tz/AppRegistration/GenerateToken');
  });

  it('a webhook-time (fast) status query makes ONE attempt; the error names the exact host and socket code', async () => {
    const events: AzamPayRequestEvent[] = [];
    let statusCalls = 0;
    const { azam } = provider(
      () => {
        statusCalls += 1;
        throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      },
      { onRequest: (event) => events.push(event) },
    );
    await expect(azam.queryStatus('pg-1', { fast: true })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'network failure (ECONNRESET) on GET api-disbursement-test.azampay.co.tz/api/v1/azampay/transactionstatus',
    });
    expect(statusCalls).toBe(1);
    // Logged per attempt: host + path + outcome, never the query string or a token.
    expect(events.map((event) => [event.host, event.path, event.status, event.outcome])).toEqual([
      ['authenticator-sandbox.azampay.co.tz', '/AppRegistration/GenerateToken', 200, 'ok'],
      ['api-disbursement-test.azampay.co.tz', '/api/v1/azampay/transactionstatus', null, 'network:ECONNRESET'],
    ]);
    expect(JSON.stringify(events)).not.toContain('pg-1');
    expect(JSON.stringify(events)).not.toContain('tok');
  });

  it('production environment uses the production hosts', async () => {
    const { azam, calls } = provider(() => json({ transactionId: 't', success: true }), { environment: 'production' });
    await azam.initiateCollection({
      phoneE164: '+255742345678',
      amountTzs: 1_000,
      currency: 'TZS',
      externalReference: 'a:1',
      description: 'x',
    });
    expect(calls[0]!.url).toBe('https://authenticator.azampay.co.tz/AppRegistration/GenerateToken');
    expect(calls[1]!.url).toBe('https://checkout.azampay.co.tz/azampay/mno/checkout');
  });

  describe('callback RSA signature (key from configuration — never fetched)', () => {
    const keyPair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pemOf = (pair: ReturnType<typeof keyPair>) =>
      pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const signWith = (pair: ReturnType<typeof keyPair>, data: string) =>
      rsaSign('sha256', Buffer.from(data), { key: pair.privateKey, padding: constants.RSA_PKCS1_PADDING }).toString('base64');
    const fields = { utilityref: 'vendor-ref-001', externalreference: 'pg-ref-001', transactionstatus: 'success', operator: 'Airtel' };

    it('verifies the documented string {utilityref}{externalreference}{transactionstatus}{operator}', async () => {
      const pair = keyPair();
      const { azam, calls } = provider(() => json({}), { callbackPublicKeyPem: pemOf(pair) });
      expect(azam.callbackKeyConfigured).toBe(true);
      const signature = signWith(pair, 'vendor-ref-001pg-ref-001successAirtel'); // the docs' example
      await expect(azam.verifyCallbackSignature({ ...fields, signature })).resolves.toBe('valid');
      // Tampered status (signed "failure", body says "success") → invalid.
      const forged = signWith(pair, 'vendor-ref-001pg-ref-001failureAirtel');
      await expect(azam.verifyCallbackSignature({ ...fields, signature: forged })).resolves.toBe('invalid');
      // Refs-only form (the field description's wording) is reported separately.
      const refsOnly = signWith(pair, 'vendor-ref-001pg-ref-001');
      await expect(azam.verifyCallbackSignature({ ...fields, signature: refsOnly })).resolves.toBe('refs-only');
      await expect(azam.verifyCallbackSignature({ ...fields, signature: null })).resolves.toBe('absent');
      // Another key's signature is invalid.
      const stranger = signWith(keyPair(), 'vendor-ref-001pg-ref-001successAirtel');
      await expect(azam.verifyCallbackSignature({ ...fields, signature: stranger })).resolves.toBe('invalid');
      expect(calls).toHaveLength(0); // no token, no key fetch — verification is offline
    });

    it('no key configured → unverifiable (handled as unsigned), never "valid", and no HTTP call', async () => {
      const pair = keyPair();
      const { azam, calls } = provider(() => json({}));
      expect(azam.callbackKeyConfigured).toBe(false);
      const signature = signWith(pair, 'vendor-ref-001pg-ref-001successAirtel');
      await expect(azam.verifyCallbackSignature({ ...fields, signature })).resolves.toBe('unverifiable');
      expect(calls).toHaveLength(0);
    });

    it('isRsaPublicKeyPem accepts a PEM and rejects a UUID / garbage', () => {
      expect(isRsaPublicKeyPem(pemOf(keyPair()))).toBe(true);
      expect(isRsaPublicKeyPem('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(false);
      expect(isRsaPublicKeyPem('')).toBe(false);
    });
  });

  describe('disbursement + name lookup', () => {
    const checksumPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const source = { accountNumber: '255650000000', fullName: 'QGT Ltd', bankName: 'tigo' };

    it('POSTs the spec MnoDisbursementRequest with a Base64(RSA(SHA512)) checksum', async () => {
      const { azam, calls } = provider(() => json({ pgReferenceId: 'pg-d1', success: true, message: 'in process' }), {
        disbursementSource: source,
        checksumPublicKeyPem: checksumPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      });
      const result = await azam.disburse({
        operator: 'AIRTEL_MONEY',
        accountNumber: '+255682345678',
        accountName: 'Dr Amina Juma',
        amountTzs: 11_460,
        reference: 'po-ckabc123-1',
        remarks: 'Daktari payout',
      });
      expect(result).toEqual({ providerReference: 'pg-d1', status: 'PENDING', message: 'in process' });
      const call = calls.find((entry) => entry.url.endsWith('/api/v1/azampay/disburse'))!;
      expect(call.url.startsWith('https://api-disbursement-test.azampay.co.tz')).toBe(true);
      expect(call.body).toMatchObject({
        source: { countryCode: 'TZ', bankName: 'tigo', accountNumber: '255650000000', currency: 'TZS' },
        destination: { countryCode: 'TZ', fullName: 'Dr Amina Juma', bankName: 'airtel', accountNumber: '255682345678', currency: 'TZS' },
        transferDetails: { amount: 11_460 },
        externalReferenceId: 'po-ckabc123-1',
      });
      // The checksum decrypts (with the private half) to SHA-512 of the input string.
      // Decrypt raw and strip PKCS#1 v1.5 type-2 padding by hand (00 02 <nonzero…> 00 <msg>):
      // Node refuses PKCS1 padding for private decryption (CVE-2023-46809).
      const raw = privateDecrypt(
        { key: checksumPair.privateKey, padding: constants.RSA_NO_PADDING },
        Buffer.from(call.body!.checksum as string, 'base64'),
      );
      expect(raw[0]).toBe(0x00);
      expect(raw[1]).toBe(0x02);
      const decrypted = raw.subarray(raw.indexOf(0x00, 2) + 1);
      expect(decrypted.equals(createHash('sha512').update('25568234567811460po-ckabc123-1').digest())).toBe(true);
    });

    it('refuses operators the API cannot pay (M-Pesa, Halopesa), unset source, and over-long references', async () => {
      const { azam } = provider(() => json({ success: true, pgReferenceId: 'x' }), { disbursementSource: source });
      const base = { accountNumber: '+255742345678', accountName: 'X', amountTzs: 1_000, reference: 'r1', remarks: '' };
      await expect(azam.disburse({ ...base, operator: 'MPESA' })).rejects.toMatchObject({ code: 'UNSUPPORTED_DESTINATION' });
      await expect(azam.disburse({ ...base, operator: 'HALOPESA' })).rejects.toMatchObject({ code: 'UNSUPPORTED_DESTINATION' });
      await expect(azam.disburse({ ...base, operator: 'TIGO_PESA', reference: 'x'.repeat(31) })).rejects.toThrow(RangeError);
      const unconfigured = provider(() => json({})).azam;
      await expect(unconfigured.disburse({ ...base, operator: 'TIGO_PESA' })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    });

    it('refund = disbursement back to the payer (Tigo/Airtel); M-Pesa payer → UNSUPPORTED_DESTINATION (manual)', async () => {
      const { azam, calls } = provider(() => json({ success: true, pgReferenceId: 'pg-rf' }), { disbursementSource: source });
      const refund = { providerReference: 'pg-col', amountTzs: 15_000, reason: 'late-success', payerName: 'Asha', reference: 'r1-abc' };
      await expect(azam.refund({ ...refund, payerPhone: '+255712345678' })).resolves.toEqual({ refundReference: 'pg-rf', status: 'PENDING' });
      expect(calls.at(-1)!.body).toMatchObject({ destination: { bankName: 'tigo', accountNumber: '255712345678' } });
      await expect(azam.refund({ ...refund, payerPhone: '+255742345678' })).rejects.toMatchObject({ code: 'UNSUPPORTED_DESTINATION' });
    });

    it('name lookup reads name, or fname + lname', async () => {
      const first = provider(() => json({ name: 'AMINA JUMA', status: true, statusCode: 200 })).azam;
      await expect(first.nameLookup({ operator: 'AIRTEL_MONEY', bankName: null, accountNumber: '+255682345678' })).resolves.toEqual({ found: true, name: 'AMINA JUMA' });
      const split = provider(() => json({ fname: 'Amina', lname: 'Juma', status: true })).azam;
      await expect(split.nameLookup({ operator: 'TIGO_PESA', bankName: null, accountNumber: '+255712345678' })).resolves.toMatchObject({ name: 'Amina Juma' });
      const none = provider(() => json({ status: false, message: 'not found' })).azam;
      await expect(none.nameLookup({ operator: 'TIGO_PESA', bankName: null, accountNumber: '+255712345678' })).resolves.toMatchObject({ found: false });
    });
  });

  it('parseAzamPayAmount: whole TZS strings parse; fractional values are unreadable', () => {
    expect(parseAzamPayAmount('15000')).toEqual({ amountTzs: 15_000, unreadable: false });
    expect(parseAzamPayAmount('15000.00')).toEqual({ amountTzs: 15_000, unreadable: false });
    expect(parseAzamPayAmount(15_000)).toEqual({ amountTzs: 15_000, unreadable: false });
    expect(parseAzamPayAmount('15000.50')).toEqual({ unreadable: true });
    expect(parseAzamPayAmount('abc')).toEqual({ unreadable: true });
    expect(parseAzamPayAmount(undefined)).toEqual({ unreadable: false });
  });
});
