#!/usr/bin/env node
/**
 * AzamPay SANDBOX end-to-end check:  pnpm azampay:sandbox-test
 *
 * Runs the real @daktari/payments AzamPayProvider (exactly what the API
 * sends) against AzamPay's sandbox. Six steps, each reported on its own line
 * as PASS / FAIL (with the reason) / SKIP (with what is missing). A failure
 * never stops the later steps — every step that can run, runs:
 *
 *   1. token          — GenerateToken (checkout authenticator)
 *   2. public key     — AZAMPAY_CALLBACK_PUBLIC_KEY / AZAMPAY_CHECKSUM_PUBLIC_KEY
 *                       configured and parses as RSA (never fetched)
 *   3. checkout       — TZS 1,000 MNO checkout to AZAMPAY_SANDBOX_TEST_MSISDN
 *   4. status         — transaction status for that checkout (≤ 2 min). AzamPay
 *                       documents no CHECKOUT status endpoint; this asks the
 *                       disbursement one and reports what it says.
 *   5. name lookup    — AZAMPAY_SANDBOX_TEST_DISBURSE_MSISDN
 *   6. disbursement   — TZS 1,000 to that number, then its status
 *
 * Every HTTP attempt is printed as  → METHOD host/path  status/outcome — the
 * exact host is what diagnoses a wrong-environment call.
 *
 * SKIPs cleanly (exit 0) when the credentials are not set. REFUSES to run
 * with AZAMPAY_ENV=production — this must never move real money.
 *
 * Secrets: values are only ever passed to AzamPay. Output shows hosts, paths,
 * HTTP statuses, typed error codes and our own messages — never tokens, keys,
 * credentials or response bodies.
 */
import { createPublicKey } from 'node:crypto';
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

/** PEM from env ("\n" accepted) → { pem } | { error } | null when unset. */
function readKey(name) {
  if (blank(env[name])) return null;
  const pem = env[name].replace(/\\n/g, '\n');
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'rsa') return { name, error: `${key.asymmetricKeyType} key, not RSA` };
    return { name, pem, bits: key.asymmetricKeyDetails?.modulusLength };
  } catch {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env[name].trim());
    return {
      name,
      error: uuid
        ? 'value is a UUID (looks like the portal API key), not an RSA public key in PEM'
        : 'value does not parse as a PEM public key',
    };
  }
}
const checksumKey = readKey('AZAMPAY_CHECKSUM_PUBLIC_KEY');
const callbackKey = readKey('AZAMPAY_CALLBACK_PUBLIC_KEY') ?? checksumKey;

const source =
  blank(env.AZAMPAY_DISBURSE_SOURCE_ACCOUNT) || blank(env.AZAMPAY_DISBURSE_SOURCE_NAME) || blank(env.AZAMPAY_DISBURSE_SOURCE_BANK)
    ? undefined
    : {
        accountNumber: env.AZAMPAY_DISBURSE_SOURCE_ACCOUNT,
        fullName: env.AZAMPAY_DISBURSE_SOURCE_NAME,
        bankName: env.AZAMPAY_DISBURSE_SOURCE_BANK,
      };

const onRequest = (event) =>
  console.log(
    `         → ${event.method} ${event.host}${event.path}  ${event.status ?? '---'} ${event.outcome} (${event.durationMs} ms)`,
  );
const makeProvider = (overrides = {}) =>
  new AzamPayProvider({
    appName: env.AZAMPAY_APP_NAME,
    clientId: env.AZAMPAY_CLIENT_ID,
    clientSecret: env.AZAMPAY_CLIENT_SECRET,
    environment: 'sandbox',
    ...(blank(env.AZAMPAY_AUTH_BASE_URL) ? {} : { authBaseUrl: env.AZAMPAY_AUTH_BASE_URL }),
    ...(blank(env.AZAMPAY_CHECKOUT_BASE_URL) ? {} : { checkoutBaseUrl: env.AZAMPAY_CHECKOUT_BASE_URL }),
    ...(blank(env.AZAMPAY_DISBURSEMENT_BASE_URL) ? {} : { disbursementBaseUrl: env.AZAMPAY_DISBURSEMENT_BASE_URL }),
    ...(blank(env.AZAMPAY_DISBURSEMENT_AUTH_BASE_URL)
      ? {}
      : { disbursementAuthBaseUrl: env.AZAMPAY_DISBURSEMENT_AUTH_BASE_URL }),
    ...(checksumKey?.pem === undefined ? {} : { checksumPublicKeyPem: checksumKey.pem }),
    ...(callbackKey?.pem === undefined ? {} : { callbackPublicKeyPem: callbackKey.pem }),
    ...(source === undefined ? {} : { disbursementSource: source }),
    onRequest,
    ...overrides,
  });
const azam = makeProvider();

const hosts = azam.hosts;
console.log(`  hosts: auth ${hosts.auth}`);
console.log(`         checkout ${hosts.checkout}`);
console.log(`         disbursement ${hosts.disbursement} (token from ${hosts.disbursementAuth})`);

// 1. Token.
let tokenOk = false;
try {
  await azam.accessToken();
  tokenOk = true;
  record('PASS', '1 token', `issued by ${hosts.auth}`);
} catch (error) {
  record('FAIL', '1 token', describeError(error));
}

// 2. Callback public key (configuration only).
if (callbackKey === null) {
  record('SKIP', '2 public key', 'not configured (AZAMPAY_CHECKSUM_PUBLIC_KEY / AZAMPAY_CALLBACK_PUBLIC_KEY unset) — callbacks will be treated as unsigned');
} else if (callbackKey.error !== undefined) {
  record('FAIL', '2 public key', `${callbackKey.name}: ${callbackKey.error}`);
} else {
  const check = await azam.verifyCallbackSignature({
    utilityref: 'sandbox-test',
    externalreference: 'x',
    transactionstatus: 'success',
    operator: 'Tigo',
    signature: 'AAAA',
  });
  if (check === 'invalid') record('PASS', '2 public key', `${callbackKey.name}: RSA-${callbackKey.bits}; a dummy signature is correctly rejected`);
  else record('FAIL', '2 public key', `a dummy signature came back "${check}", expected "invalid"`);
}

// 3. Checkout.
let checkout = null;
if (blank(env.AZAMPAY_SANDBOX_TEST_MSISDN)) {
  record('SKIP', '3 checkout TZS 1,000', 'AZAMPAY_SANDBOX_TEST_MSISDN not set');
} else if (!tokenOk) {
  record('SKIP', '3 checkout TZS 1,000', 'no token (step 1 failed)');
} else {
  const reference = `sbx-${Date.now()}:1`;
  try {
    const result = await azam.initiateCollection({
      phoneE164: env.AZAMPAY_SANDBOX_TEST_MSISDN,
      amountTzs: 1_000,
      currency: 'TZS',
      externalReference: reference,
      description: 'Daktari Mkononi sandbox test',
    });
    if (result.status === 'FAILED' || result.providerReference === null) {
      record('FAIL', '3 checkout TZS 1,000', `status ${result.status}${result.message ? `: ${result.message}` : ''}`);
    } else {
      checkout = result;
      record('PASS', '3 checkout TZS 1,000', `externalId ${reference} → transactionId ${result.providerReference}`);
    }
  } catch (error) {
    record('FAIL', '3 checkout TZS 1,000', describeError(error));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Poll until final or 2 min; an auth rejection stops at once (it will not heal). */
async function pollStatus(query) {
  const deadline = Date.now() + 120_000;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await query();
      if (last.status !== 'PENDING') return { result: last };
    } catch (error) {
      last = { error: describeError(error) };
      if (/auth rejected|NOT_SUPPORTED/.test(last.error)) return last;
    }
    await sleep(5_000);
  }
  return last?.error !== undefined ? last : { result: last, timedOut: true };
}
function reportStatus(label, outcome) {
  if (outcome.error !== undefined) record('FAIL', label, outcome.error);
  else if (outcome.timedOut) {
    record(
      'FAIL',
      label,
      `still PENDING after 2 min${outcome.result?.providerMessage ? ` (AzamPay: "${outcome.result.providerMessage}")` : ''}`,
    );
  } else record('PASS', label, JSON.stringify(outcome.result));
}

// 4. Status of that checkout.
if (checkout === null) {
  record('SKIP', '4 checkout status', 'no checkout transaction (step 3 did not pass)');
} else {
  const outcome = await pollStatus(() =>
    azam.queryStatus(checkout.providerReference, { phoneE164: env.AZAMPAY_SANDBOX_TEST_MSISDN }),
  );
  reportStatus('4 checkout status', outcome);
  if (outcome.error !== undefined && /auth rejected/.test(outcome.error)) {
    console.log(
      `         note: ${hosts.disbursement} does not accept tokens from ${hosts.disbursementAuth}. ` +
        'Ask AzamPay which authenticator issues disbursement-sandbox tokens for this app ' +
        '(then set AZAMPAY_DISBURSEMENT_AUTH_BASE_URL), or whether the app needs disbursement enabled.',
    );
  }
}

// 5 + 6. Name lookup and disbursement.
const disburseMsisdn = env.AZAMPAY_SANDBOX_TEST_DISBURSE_MSISDN;
const operator = blank(disburseMsisdn)
  ? null
  : /^\+255(71|65|67)/.test(disburseMsisdn)
    ? 'TIGO_PESA'
    : /^\+255(68|69|78)/.test(disburseMsisdn)
      ? 'AIRTEL_MONEY'
      : 'OTHER';
let accountName = 'Sandbox Test';
if (blank(disburseMsisdn)) {
  record('SKIP', '5 name lookup', 'AZAMPAY_SANDBOX_TEST_DISBURSE_MSISDN not set');
} else if (operator === 'OTHER') {
  record('SKIP', '5 name lookup', 'number is not Tigo/Airtel — the disbursement API only pays tigo, airtel, azampesa');
} else {
  try {
    const lookup = await azam.nameLookup({ operator, bankName: null, accountNumber: disburseMsisdn });
    if (lookup.found) {
      accountName = lookup.name;
      record('PASS', '5 name lookup', `name returned (${lookup.name.length} chars)`);
    } else {
      record('FAIL', '5 name lookup', lookup.message ?? 'not found');
    }
  } catch (error) {
    record('FAIL', '5 name lookup', describeError(error));
  }
}

if (blank(disburseMsisdn)) {
  record('SKIP', '6 disbursement TZS 1,000', 'AZAMPAY_SANDBOX_TEST_DISBURSE_MSISDN not set');
} else if (operator === 'OTHER') {
  record('SKIP', '6 disbursement TZS 1,000', 'number is not Tigo/Airtel');
} else if (source === undefined) {
  record('SKIP', '6 disbursement TZS 1,000', 'AZAMPAY_DISBURSE_SOURCE_ACCOUNT / _NAME / _BANK not set');
} else {
  try {
    const reference = `sbx${Date.now()}`.slice(0, 30);
    const result = await azam.disburse({
      operator,
      accountNumber: disburseMsisdn,
      accountName,
      amountTzs: 1_000,
      reference,
      remarks: 'Daktari Mkononi sandbox test',
    });
    if (result.status === 'FAILED' || result.providerReference === null) {
      record('FAIL', '6 disbursement TZS 1,000', result.message ?? 'rejected');
    } else {
      record('PASS', '6 disbursement TZS 1,000', `reference ${reference} → pgReferenceId ${result.providerReference}`);
      reportStatus(
        '6b disbursement status',
        await pollStatus(() =>
          azam.queryDisbursementStatus(result.providerReference, {
            bankName: operator === 'TIGO_PESA' ? 'tigo' : 'airtel',
          }),
        ),
      );
    }
  } catch (error) {
    record('FAIL', '6 disbursement TZS 1,000', describeError(error));
  }
}

if (checksumKey === null || checksumKey.error !== undefined) {
  console.log('  note: no valid AZAMPAY_CHECKSUM_PUBLIC_KEY — disbursement / name lookup are sent without a checksum.');
}
const failed = results.includes('FAIL');
console.log(failed ? '\nAzamPay sandbox test: FAILED' : '\nAzamPay sandbox test: done');
process.exit(failed ? 1 : 0);
