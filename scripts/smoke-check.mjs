#!/usr/bin/env node
/**
 * Preflight before a device smoke test:  pnpm smoke:check
 *
 *   1. which provider keys are set / blank in the root .env (never the values)
 *   2. the API answers GET /health (and what /health/ready reports)
 *   3. ANTHROPIC_API_KEY set → one tiny request with the configured AI_MODEL
 *   4. DAILY_CO_API_KEY set  → create + delete one throwaway private room
 *
 * Exits non-zero if the API is down or a configured provider fails. A blank
 * key is not a failure (blank = local fake, except AI which returns 503
 * AI_NOT_CONFIGURED) but is flagged, since the smoke test wants real ones.
 *
 * Secrets: values are only ever passed to the provider. Provider error bodies
 * are not printed — only the HTTP status and the error type.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readEnvFile } from './env-file.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = readEnvFile(path.join(REPO_ROOT, '.env'));

// Mirrors the defaults in packages/config/src/env.ts.
const API_URL = env.API_URL ?? 'http://localhost:4000';
const AI_MODEL = env.AI_MODEL ?? 'claude-sonnet-4-6';
const TIMEOUT_MS = 20_000;

const PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY',
  'DAILY_CO_API_KEY',
  'AZAMPAY_APP_NAME',
  'AZAMPAY_CLIENT_ID',
  'AZAMPAY_CLIENT_SECRET',
  'AZAMPAY_WEBHOOK_SECRET',
  'AZAMPAY_AUTH_BASE_URL',
  'AZAMPAY_CHECKOUT_BASE_URL',
  'SMS_API_KEY',
];

let failed = false;
const line = (mark, label, detail) =>
  console.log(`  [${mark}] ${label}${detail === undefined ? '' : ` — ${detail}`}`);
const pass = (label, detail) => line('PASS', label, detail);
const fail = (label, detail) => {
  failed = true;
  line('FAIL', label, detail);
};

const isSet = (key) => env[key] !== undefined;
// fetch() wraps network failures as TypeError('fetch failed') with the real
// reason (ECONNREFUSED, ENOTFOUND…) on `cause`.
const describeError = (error) => {
  if (!(error instanceof Error)) return 'unknown error';
  if (error.name === 'TimeoutError') return 'timed out';
  const code = error.cause?.code;
  return typeof code === 'string' ? code : error.name;
};

function providerKeys() {
  console.log('\nProvider keys (.env)');
  const azamExtra = Object.keys(env).filter((k) => k.startsWith('AZAMPAY_') && !PROVIDER_KEYS.includes(k));
  for (const key of [...PROVIDER_KEYS, ...azamExtra]) {
    console.log(`  ${key.padEnd(26)} ${isSet(key) ? 'set' : 'blank'}`);
  }
  if (!isSet('ANTHROPIC_API_KEY')) console.log('  ! AI screening will answer 503 AI_NOT_CONFIGURED');
  if (!isSet('DAILY_CO_API_KEY')) console.log('  ! video uses FakeVideo — no real call can connect');
}

async function health() {
  console.log(`\nAPI (${API_URL})`);
  try {
    const live = await fetch(new URL('/health', API_URL), { signal: AbortSignal.timeout(5_000) });
    if (live.ok) pass('GET /health', String(live.status));
    else return fail('GET /health', `HTTP ${live.status}`);
  } catch (error) {
    return fail('GET /health', `${describeError(error)} — is the API running? (pnpm --filter @daktari/api-server dev)`);
  }
  try {
    const ready = await fetch(new URL('/health/ready', API_URL), { signal: AbortSignal.timeout(5_000) });
    const body = await ready.json();
    const checks = Object.entries(body.checks ?? {}).map(([k, v]) => `${k}=${v}`).join(', ');
    (ready.ok ? pass : fail)('GET /health/ready', `${body.status} (${checks})`);
  } catch (error) {
    fail('GET /health/ready', describeError(error));
  }
}

async function anthropic() {
  console.log('\nAnthropic');
  if (!isSet('ANTHROPIC_API_KEY')) return line('SKIP', 'ANTHROPIC_API_KEY blank');
  // The SDK copy @daktari/ai uses — the root has no dependency of its own.
  const requireFromAi = createRequire(path.join(REPO_ROOT, 'packages', 'ai', 'package.json'));
  const { default: Anthropic } = await import(pathToFileURL(requireFromAi.resolve('@anthropic-ai/sdk')).href);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 0 });
  try {
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 16, // only proving the key + model id are accepted
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    });
    pass(`messages.create (${AI_MODEL})`, `stop_reason=${response.stop_reason}, ${response.usage.input_tokens}+${response.usage.output_tokens} tokens`);
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      const type = error.error?.error?.type ?? 'api_error';
      const hint =
        error.status === 401 ? ' — key rejected'
        : error.status === 404 ? ` — model "${AI_MODEL}" not available to this key (AI_MODEL)`
        : '';
      fail(`messages.create (${AI_MODEL})`, `HTTP ${error.status ?? '?'} ${type}${hint}`);
    } else {
      fail(`messages.create (${AI_MODEL})`, describeError(error));
    }
  }
}

async function daily() {
  console.log('\nDaily.co');
  if (!isSet('DAILY_CO_API_KEY')) return line('SKIP', 'DAILY_CO_API_KEY blank');
  const base = 'https://api.daily.co/v1';
  const headers = { authorization: `Bearer ${env.DAILY_CO_API_KEY}`, 'content-type': 'application/json' };
  const name = `smoke-check-${Date.now()}`;
  try {
    const created = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        name,
        privacy: 'private',
        // Self-destructs in 10 min even if the delete below never runs.
        properties: { exp: Math.floor(Date.now() / 1000) + 600, max_participants: 2 },
      }),
    });
    if (!created.ok) {
      return fail('create room', `HTTP ${created.status}${created.status === 401 ? ' — key rejected' : ''}`);
    }
    pass('create room', name);
  } catch (error) {
    return fail('create room', describeError(error));
  }
  try {
    const deleted = await fetch(`${base}/rooms/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    (deleted.ok ? pass : fail)('delete room', deleted.ok ? undefined : `HTTP ${deleted.status} (room expires in 10 min anyway)`);
  } catch (error) {
    fail('delete room', `${describeError(error)} (room expires in 10 min anyway)`);
  }
}

console.log('Daktari Mkononi — smoke-test preflight');
providerKeys();
await health();
await anthropic();
await daily();
console.log(failed ? '\nResult: FAIL — fix the lines above before the device test.' : '\nResult: PASS');
process.exitCode = failed ? 1 : 0;
