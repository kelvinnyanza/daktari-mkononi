#!/usr/bin/env node
/**
 * Preflight before a device smoke test:  pnpm smoke:check
 *   (AI_PROVIDER / AI_MODEL may be overridden from the shell)
 *
 *   1. which provider keys are set / blank in the root .env (never the values)
 *   2. the API answers GET /health (and what /health/ready reports)
 *   3. One tiny request through the real @daktari/ai adapter for the selected
 *      AI_PROVIDER (a failure FAILs) AND the standby provider (a failure WARNs),
 *      so it sends exactly what the server sends (OpenAI: store:false + the
 *      model's parameter profile; Anthropic: the model profile — Sonnet 5.5
 *      gets thinking between_tools and no sampling parameters)
 *   4. DAILY_CO_API_KEY set  → create a throwaway private room + meeting
 *      token, JOIN it from a headless Edge/Chrome (camera and mic off, real
 *      daily-js), leave, delete the room. A join is what surfaces account /
 *      billing problems (e.g. no payment method) that room creation does not.
 *
 * It never rebuilds any package dist folder: the AI adapter is compiled into
 * packages/ai/.smoke-dist, which the dev API does not import, so a running
 * `tsx watch` API is not restarted by this check.
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
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
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
  'AZAMPAY_CHECKSUM_PUBLIC_KEY',
  'AZAMPAY_DISBURSE_SOURCE_ACCOUNT',
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

const fetchLive = (url) => fetch(url, { signal: AbortSignal.timeout(5_000) });

/**
 * Compile @daktari/ai into packages/ai/.smoke-dist (gitignored). Inside the
 * package so its own dependencies still resolve; NOT dist/, which the dev API
 * imports — rewriting dist/ is what used to restart `tsx watch`.
 */
function buildSmokeAi() {
  const outDir = path.join(REPO_ROOT, 'packages', 'ai', '.smoke-dist');
  const tsc = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(
    process.execPath,
    [tsc, '-p', path.join(REPO_ROOT, 'packages', 'ai', 'tsconfig.build.json'), '--outDir', outDir, '--declaration', 'false', '--declarationMap', 'false', '--sourceMap', 'false'],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`could not compile @daktari/ai: ${(result.stdout || result.stderr).slice(0, 500)}`);
  return path.join(outDir, 'index.js');
}

async function health() {
  console.log(`\nAPI (${API_URL})`);
  try {
    const live = await fetchLive(new URL('/health', API_URL));
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

const warn = (label, detail) => line('WARN', label, detail);

/**
 * One tiny request through the real adapter for BOTH real providers: the
 * selected one (a failure fails the check) and the standby one (a failure is
 * a WARN — switching back must be just AI_PROVIDER=<other>, so it is checked
 * too, without blocking a device test on the provider in use).
 */
async function ai() {
  console.log(`\nAI screening (AI_PROVIDER=${AI_PROVIDER})`);
  if (!['anthropic', 'openai', 'fake'].includes(AI_PROVIDER)) {
    return fail('provider', `unknown AI_PROVIDER "${AI_PROVIDER}" (anthropic | openai | fake)`);
  }
  // Mirrors the cross-provider AI_MODEL check in packages/config/src/env.ts.
  const model = env.AI_MODEL;
  if (model !== undefined && AI_PROVIDER !== 'fake' && model.startsWith('claude-') !== (AI_PROVIDER === 'anthropic')) {
    return fail('provider', `AI_MODEL "${model}" does not belong to AI_PROVIDER=${AI_PROVIDER} — blank it to use the provider default`);
  }

  let distEntry;
  try {
    distEntry = buildSmokeAi();
  } catch (error) {
    return fail('build', error.message);
  }
  const { createAiProvider } = await import(pathToFileURL(distEntry).href);

  const order = [AI_PROVIDER, ...['openai', 'anthropic'].filter((name) => name !== AI_PROVIDER)];
  for (const name of order) {
    const selected = name === AI_PROVIDER;
    const role = selected ? 'selected' : 'standby';
    const keyVar = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' }[name];
    const bad = selected ? fail : warn;

    let provider;
    try {
      provider = createAiProvider({
        provider: name,
        // AI_MODEL applies to the selected provider only; the standby runs its default.
        model: selected ? model : undefined,
        anthropicApiKey: env.ANTHROPIC_API_KEY,
        openaiApiKey: env.OPENAI_API_KEY,
        production: env.NODE_ENV === 'production',
      });
    } catch (error) {
      bad(`${role} provider=${name}`, describeAiError(error));
      continue;
    }
    if (provider === null) {
      line(selected ? 'SKIP' : 'WARN', `${role} provider=${name}`, `${keyVar} blank${selected ? ' — screening answers 503 AI_NOT_CONFIGURED' : ' — switching to it would answer 503'}`);
      continue;
    }

    const label = `${role} provider=${provider.name} model=${provider.model}`;
    try {
      const response = await provider.complete({
        system: 'You are a connectivity check.',
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        maxTokens: 16, // only proving the key + model id + parameters are accepted
      });
      if (provider.name === 'fake') {
        pass(label, 'dev fake, no network call');
        console.log('  ! canned [JARIBIO] replies — set AI_PROVIDER=anthropic|openai for the device test');
        continue;
      }
      pass(label, `stop=${response.stopReason}, ${response.usage.inputTokens}+${response.usage.outputTokens} tokens`);
    } catch (error) {
      bad(label, describeAiError(error));
    }
  }
}

/** Edge or Chrome already installed on this machine (nothing is downloaded). */
function findBrowser() {
  const candidates = [
    process.env.SMOKE_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const JOIN_PAGE = `<!doctype html><meta charset="utf-8"><script src="/daily.js"></script>
<script>
window.joinRoom = async (url, token) => {
  const call = window.Daily.createCallObject({ audioSource: false, videoSource: false, subscribeToTracksAutomatically: false });
  let lastError = null;
  call.on('error', (event) => { lastError = event; });
  try {
    await call.join({ url, token });
    const session = call.participants().local?.session_id ?? null;
    await call.leave();
    await call.destroy();
    return { ok: true, session };
  } catch (error) {
    const event = lastError ?? error ?? {};
    await call.destroy().catch(() => undefined);
    return { ok: false, type: event?.error?.type ?? null, message: String(event?.errorMsg ?? event?.message ?? event) };
  }
};
</script>`;

/** Serve the join page + the repo's own daily-js on 127.0.0.1 (a secure context). */
async function serveJoinPage() {
  const dailyJs = readFileSync(path.join(REPO_ROOT, 'apps', 'web', 'node_modules', '@daily-co', 'daily-js', 'dist', 'daily.js'));
  const server = createServer((request, response) => {
    if (request.url === '/daily.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(dailyJs);
    } else {
      response.writeHead(200, { 'content-type': 'text/html' }).end(JOIN_PAGE);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function headlessJoin(roomUrl, token) {
  const executablePath = findBrowser();
  if (executablePath === null) return { skipped: 'no Edge/Chrome found (set SMOKE_BROWSER to a Chromium-based browser)' };
  const { chromium } = await import('playwright-core');
  const { server, origin } = await serveJoinPage();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    // Runs in the page (browser), where JOIN_PAGE defined joinRoom.
    return await page.evaluate(([url, meetingToken]) => globalThis.joinRoom(url, meetingToken), [roomUrl, token]);
  } finally {
    await browser.close().catch(() => undefined);
    server.close();
  }
}

async function daily() {
  console.log('\nDaily.co');
  if (!isSet('DAILY_CO_API_KEY')) return line('SKIP', 'DAILY_CO_API_KEY blank');
  const base = 'https://api.daily.co/v1';
  const headers = { authorization: `Bearer ${env.DAILY_CO_API_KEY}`, 'content-type': 'application/json' };
  const name = `smoke-check-${Date.now()}`;
  const exp = Math.floor(Date.now() / 1000) + 600; // self-destructs in 10 min even if cleanup fails
  let roomUrl;
  try {
    const created = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        name,
        privacy: 'private',
        // Same switches the API sets on consultation rooms.
        properties: { exp, max_participants: 2, eject_at_room_exp: true, enable_prejoin_ui: false },
      }),
    });
    if (!created.ok) {
      return fail('create room', `HTTP ${created.status}${created.status === 401 ? ' — key rejected' : ''}`);
    }
    roomUrl = (await created.json()).url;
    pass('create room', name);
  } catch (error) {
    return fail('create room', describeError(error));
  }

  try {
    let token;
    const minted = await fetch(`${base}/meeting-tokens`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ properties: { room_name: name, user_id: 'smoke-check', exp } }),
    });
    if (!minted.ok) {
      fail('meeting token', `HTTP ${minted.status}`);
    } else {
      token = (await minted.json()).token;
      pass('meeting token');
    }
    if (token !== undefined) {
      try {
        const joined = await headlessJoin(roomUrl, token);
        if (joined.skipped) line('SKIP', 'join (headless)', joined.skipped);
        else if (joined.ok) pass('join + leave (headless browser)', 'camera/mic off; Daily accepted the participant');
        else fail('join (headless browser)', `${joined.type ?? 'error'}: ${redact(joined.message).slice(0, 160)}`);
      } catch (error) {
        fail('join (headless browser)', describeError(error));
      }
    }
  } finally {
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
}

console.log('Daktari Mkononi — smoke-test preflight');
providerKeys();
await health();
await ai();
await daily();
console.log(failed ? '\nResult: FAIL — fix the lines above before the device test.' : '\nResult: PASS');
process.exitCode = failed ? 1 : 0;
