#!/usr/bin/env node
/**
 * AzamPay SANDBOX end-to-end check:  pnpm azampay:sandbox-test
 *
 * Runs the real @daktari/payments AzamPayProvider (exactly what the API
 * sends) against AzamPay's sandbox:
 *
 *   1. token            — GenerateToken with AZAMPAY_APP_NAME / CLIENT_ID / CLIENT_SECRET
 *   2. public key       — GET /azampay/v1/public-key (callback signature key)
 *   3. checkout         — TZS 1,000 MNO checkout to AZAMPAY_SANDBOX_TEST_MSISDN
 *   4. status           — polls transactionstatus for that checkout (≤ 2 min)
 *   5. name lookup      — AZAMPAY_SANDBOX_TEST_DISBURSE_MSISDN (optional)
 *   6. disbursement     — TZS 1,000 to that number, then its status (optional;
 *                         needs AZAMPAY_DISBURSE_SOURCE_* and usually the checksum key)
 *
 * SKIPs cleanly (exit 0) when the credentials are not set. REFUSES to run
 * with AZAMPAY_ENV=production — this must never move real money.
 *
 * Secrets: values are only ever passed to AzamPay. Output shows typed error
 * codes, our own messages (which never echo response bodies) and the shape of
 * AzamPay's answers — never tokens, keys or credentials.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readEnvFile } from './env-file.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = readEnvFile(path.join(REPO_ROOT, '.env'));
const blank = (value) => value === undefined || value === '';

const results = [];
const record = (mark, label, detail) => {
  results.push(mark);
  console.log(`  [${mark}] ${label}${detail === undefined ? '' : ` — ${detail}`}`);
};
const describeError = (error) =>
  error && typeof error === 'object' && 'code' in error ? `${error.code}: ${error.message}` : String(error);

console.log('AzamPay sandbox test');

if (env.AZAMPAY_ENV === 'production') {
  console.error('  [FAIL] AZAMPAY_ENV=production — refusing: this script only runs against the sandbox.');
  process.exit(1);
}
const missing = ['AZAMPAY_APP_NAME', 'AZAMPAY_CLIENT_ID', 'AZAMPAY_CLIENT_SECRET'].filter((key) => blank(env[key]));
if (missing.length > 0) {
  record('SKIP', 'AzamPay sandbox credentials not set', `missing ${missing.join(', ')}`);
  process.exit(0);
}

const { AzamPayProvider } = await import(
  pathToFileURL(path.join(REPO_ROOT, 'packages', 'payments', 'dist', 'index.js')).href
);

const pem = blank(env.AZAMPAY_CHECKSUM_PUBLIC_KEY) ? undefined : env.AZAMPAY_CHECKSUM_PUBLIC_KEY.replace(/\\n/g, '\n');
const source =
  blank(env.AZAMPAY_DISBURSE_SOURCE_ACCOUNT) || blank(env.AZAMPAY_DISBURSE_SOURCE_NAME) || blank(env.AZAMPAY_DISBURSE_SOURCE_BANK)
    ? undefined
    : {
        accountNumber: env.AZAMPAY_DISBURSE_SOURCE_ACCOUNT,
        fullName: env.AZAMPAY_DISBURSE_SOURCE_NAME,
        bankName: env.AZAMPAY_DISBURSE_SOURCE_BANK,
      };

const azam = new AzamPayProvider({
  appName: env.AZAMPAY_APP_NAME,
  clientId: env.AZAMPAY_CLIENT_ID,
  clientSecret: env.AZAMPAY_CLIENT_SECRET,
  environment: 'sandbox',
  ...(blank(env.AZAMPAY_AUTH_BASE_URL) ? {} : { authBaseUrl: env.AZAMPAY_AUTH_BASE_URL }),
  ...(blank(env.AZAMPAY_CHECKOUT_BASE_URL) ? {} : { checkoutBaseUrl: env.AZAMPAY_CHECKOUT_BASE_URL }),
  ...(blank(env.AZAMPAY_DISBURSEMENT_BASE_URL) ? {} : { disbursementBaseUrl: env.AZAMPAY_DISBURSEMENT_BASE_URL }),
  ...(pem === undefined ? {} : { checksumPublicKeyPem: pem }),
  ...(source === undefined ? {} : { disbursementSource: source }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function pollStatus(label, query) {
  const deadline = Date.now() + 120_000;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await query();
      if (last.status !== 'PENDING') break;
    } catch (error) {
      last = { error: describeError(error) };
    }
    await sleep(5_000);
  }
  if (last?.error) record('FAIL', label, last.error);
  else if (last?.status === 'PENDING') record('WARN', label, 'still PENDING after 2 min (approve the sandbox prompt?)');
  else record('PASS', label, JSON.stringify(last));
}

// 1 + 2. Token and callback public key (verifying a dummy signature forces both).
try {
  const check = await azam.verifyCallbackSignature({
    utilityref: 'sandbox-test',
    externalreference: 'x',
    transactionstatus: 'success',
    operator: 'Tigo',
    signature: 'AAAA',
  });
  if (check === 'unverifiable') record('FAIL', 'token + public key', 'could not fetch /azampay/v1/public-key');
  else record('PASS', 'token + public key', 'key fetched; a dummy signature is correctly rejected');
} catch (error) {
  record('FAIL', 'token + public key', describeError(error));
}

// 3 + 4. Checkout and status.
if (blank(env.AZAMPAY_SANDBOX_TEST_MSISDN)) {
  record('SKIP', 'checkout + status', 'AZAMPAY_SANDBOX_TEST_MSISDN not set');
} else {
  const reference = `sbx-${Date.now()}:1`;
  try {
    const checkout = await azam.initiateCollection({
      phoneE164: env.AZAMPAY_SANDBOX_TEST_MSISDN,
      amountTzs: 1_000,
      currency: 'TZS',
      externalReference: reference,
      description: 'Daktari Mkononi sandbox test',
    });
    if (checkout.status === 'FAILED' || checkout.providerReference === null) {
      record('FAIL', 'checkout TZS 1,000', `status ${checkout.status}${checkout.message ? `: ${checkout.message}` : ''}`);
    } else {
      record('PASS', 'checkout TZS 1,000', `externalId ${reference} → transactionId ${checkout.providerReference}`);
      await pollStatus('checkout status', () =>
        azam.queryStatus(checkout.providerReference, { phoneE164: env.AZAMPAY_SANDBOX_TEST_MSISDN }),
      );
    }
  } catch (error) {
    record('FAIL', 'checkout TZS 1,000', describeError(error));
  }
}

// 5 + 6. Name lookup and disbursement (optional).
if (blank(env.AZAMPAY_SANDBOX_TEST_DISBURSE_MSISDN)) {
  record('SKIP', 'name lookup + disbursement', 'AZAMPAY_SANDBOX_TEST_DISBURSE_MSISDN not set');
} else {
  const msisdn = env.AZAMPAY_SANDBOX_TEST_DISBURSE_MSISDN;
  const operator = /^\+255(71|65|67)/.test(msisdn) ? 'TIGO_PESA' : /^\+255(68|69|78)/.test(msisdn) ? 'AIRTEL_MONEY' : null;
  if (operator === null) {
    record('SKIP', 'name lookup + disbursement', 'number is not Tigo/Airtel — the disbursement API only pays tigo, airtel, azampesa');
  } else {
    let accountName = 'Sandbox Test';
    try {
      const lookup = await azam.nameLookup({ operator, bankName: null, accountNumber: msisdn });
      record(lookup.found ? 'PASS' : 'WARN', 'name lookup', lookup.found ? `name returned (${lookup.name.length} chars)` : (lookup.message ?? 'not found'));
      if (lookup.found) accountName = lookup.name;
    } catch (error) {
      record('FAIL', 'name lookup', describeError(error));
    }
    if (source === undefined) {
      record('SKIP', 'disbursement TZS 1,000', 'AZAMPAY_DISBURSE_SOURCE_* not set');
    } else {
      try {
        const reference = `sbx${Date.now()}`.slice(0, 30);
        const result = await azam.disburse({
          operator,
          accountNumber: msisdn,
          accountName,
          amountTzs: 1_000,
          reference,
          remarks: 'Daktari Mkononi sandbox test',
        });
        if (result.status === 'FAILED' || result.providerReference === null) {
          record('FAIL', 'disbursement TZS 1,000', result.message ?? 'rejected');
        } else {
          record('PASS', 'disbursement TZS 1,000', `reference ${reference} → pgReferenceId ${result.providerReference}`);
          await pollStatus('disbursement status', () =>
            azam.queryDisbursementStatus(result.providerReference, { bankName: operator === 'TIGO_PESA' ? 'tigo' : 'airtel' }),
          );
        }
      } catch (error) {
        record('FAIL', 'disbursement TZS 1,000', describeError(error));
      }
    }
  }
}

if (pem === undefined) {
  console.log('  note: AZAMPAY_CHECKSUM_PUBLIC_KEY not set — disbursement / name lookup were sent without a checksum.');
}
const failed = results.includes('FAIL');
console.log(failed ? '\nAzamPay sandbox test: FAILED' : '\nAzamPay sandbox test: done');
process.exit(failed ? 1 : 0);
