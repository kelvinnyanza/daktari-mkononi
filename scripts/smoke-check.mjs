#!/usr/bin/env node
/**
 * Preflight before a device smoke test:  pnpm smoke:check
 *   (AI_PROVIDER / AI_MODEL may be overridden from the shell)
 *
 *   1. which provider keys are set / blank in the root .env (never the values)
 *   2. the API answers GET /health (and what /health/ready reports)
 *   3. AI_PROVIDER (anthropic | openai | fake) → one tiny request through the
 *      real @daktari/ai adapter, so it sends exactly what the server sends
 *      (OpenAI: store:false + the model's parameter profile)
 *   4. DAILY_CO_API_KEY set  → create + delete one throwaway private room
 *
 * Exits non-zero if the API is down or a configured provider fails. A blank
 * key is not a failure (blank = local fake, except AI which returns 503
 * AI_NOT_CONFIGURED) but is flagged, since the smoke test wants real ones.
 * AI_PROVIDER=fake passes (the request is answered) but is flagged: canned
 * [JARIBIO] replies are not real screening.
 *
 * Secrets: values are only ever passed to the provider. Provider error bodies
 * are not printed — only the typed error code, HTTP status and error type,
 * with anything key-shaped redacted.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readEnvFile } from './env-file.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = readEnvFile(path.join(REPO_ROOT, '.env'));
// Non-secret shell overrides, to try the other provider before editing .env:
//   AI_PROVIDER=openai AI_MODEL= pnpm smoke:check
for (const key of ['AI_PROVIDER', 'AI_MODEL']) {
  if (process.env[key] !== undefined) env[key] = process.env[key] === '' ? undefined : process.env[key];
}

// Mirrors the defaults in packages/config/src/env.ts.
const API_URL = env.API_URL ?? 'http://localhost:4000';
const AI_PROVIDER = env.AI_PROVIDER ?? 'anthropic';
const AI_KEY_VAR = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' }[AI_PROVIDER];
const TIMEOUT_MS = 20_000;

const PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
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
  console.log(`  ${'AI_PROVIDER'.padEnd(26)} ${AI_PROVIDER}`);
  console.log(`  ${'AI_MODEL'.padEnd(26)} ${env.AI_MODEL ?? '(provider default)'}`);
  if (AI_KEY_VAR !== undefined && !isSet(AI_KEY_VAR)) {
    console.log(`  ! AI screening will answer 503 AI_NOT_CONFIGURED (${AI_KEY_VAR} blank)`);
  }
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

// Provider messages can echo a masked key (OpenAI 401: "sk-proj-****abcd").
const redact = (text) => text.replace(/\b(sk|key)-[\w*-]+/gi, '[redacted]');

/** Typed code + HTTP status + provider error type — never bodies or keys. */
function describeAiError(error) {
  if (!(error instanceof Error)) return 'unknown error';
  const cause = error.cause;
  const status = typeof cause?.status === 'number' ? ` HTTP ${cause.status}` : '';
  const type = cause?.type ?? cause?.error?.type ?? cause?.error?.error?.type;
  const anthropicMessage = cause?.error?.error?.message;
  const hint =
    cause?.status === 401 ? ' — key rejected'
    : typeof anthropicMessage === 'string' && /credit balance/i.test(anthropicMessage)
      ? ' — no usable credit on the Anthropic account (billing)'
    : cause?.status === 404 ? ' — model not available to this key (AI_MODEL)'
    : type === 'insufficient_quota' ? ' — no usable credit on the OpenAI project/org of this key (billing)'
    : '';
  const code = typeof error.code === 'string' ? error.code : error.name;
  // An HTTP failure's message can carry the provider's response body (the
  // Anthropic adapter embeds it), so those print code + status + type only.
  const detail = status === '' ? `: ${error.message}` : '';
  return redact(`${code}${detail}${status}${type ? ` ${type}` : ''}${hint}`);
}

async function ai() {
  console.log(`\nAI screening (AI_PROVIDER=${AI_PROVIDER})`);
  // Built by the smoke:check script entry (pnpm --filter @daktari/ai build).
  const distEntry = path.join(REPO_ROOT, 'packages', 'ai', 'dist', 'index.js');
  const { createAiProvider } = await import(pathToFileURL(distEntry).href);

  if (!['anthropic', 'openai', 'fake'].includes(AI_PROVIDER)) {
    return fail('provider', `unknown AI_PROVIDER "${AI_PROVIDER}" (anthropic | openai | fake)`);
  }
  // Mirrors the cross-provider AI_MODEL check in packages/config/src/env.ts.
  const model = env.AI_MODEL;
  if (model !== undefined && AI_PROVIDER !== 'fake' && model.startsWith('claude-') !== (AI_PROVIDER === 'anthropic')) {
    return fail('provider', `AI_MODEL "${model}" does not belong to AI_PROVIDER=${AI_PROVIDER} — blank it to use the provider default`);
  }

  let provider;
  try {
    provider = createAiProvider({
      provider: AI_PROVIDER,
      model,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      openaiApiKey: env.OPENAI_API_KEY,
      production: env.NODE_ENV === 'production',
    });
  } catch (error) {
    return fail('provider', describeAiError(error));
  }
  if (provider === null) {
    return line('SKIP', `provider=${AI_PROVIDER}`, `${AI_KEY_VAR} blank — screening answers 503 AI_NOT_CONFIGURED`);
  }

  const label = `provider=${provider.name} model=${provider.model}`;
  try {
    const response = await provider.complete({
      system: 'You are a connectivity check.',
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      maxTokens: 16, // only proving the key + model id + parameters are accepted
    });
    if (provider.name === 'fake') {
      pass(label, 'dev fake, no network call');
      return console.log('  ! canned [JARIBIO] replies — set AI_PROVIDER=anthropic|openai for the device test');
    }
    pass(label, `stop=${response.stopReason}, ${response.usage.inputTokens}+${response.usage.outputTokens} tokens`);
  } catch (error) {
    fail(label, describeAiError(error));
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
await ai();
await daily();
console.log(failed ? '\nResult: FAIL — fix the lines above before the device test.' : '\nResult: PASS');
process.exitCode = failed ? 1 : 0;
