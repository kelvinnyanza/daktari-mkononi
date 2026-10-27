#!/usr/bin/env node
/**
 * Run the API integration tests against a real Postgres.
 *
 *   pnpm test:integration
 *
 * Locally: starts the repo-local portable Postgres (scripts/db.mjs start, which
 * also creates daktari_test if missing), reads TEST_DATABASE_URL from
 * `.env.test` at the repo root (defaulting to the portable cluster's
 * daktari_test), pushes the Prisma schema into it, then runs the suite.
 *
 * In CI (`CI` set): the database is a service container, so the local server
 * is not started and TEST_DATABASE_URL must already be in the environment.
 *
 * Safety: the suite deletes every row it touches, so this refuses any URL
 * whose database name does not end in `_test`.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TEST_DATABASE_URL } from './db.mjs';
import { readEnvFile } from './env-file.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_TEST = path.join(REPO_ROOT, '.env.test');
const isCi = Boolean(process.env.CI);

function step(label, command, args, env = {}) {
  console.log(`\n▶ ${label}`);
  // pnpm is a .cmd shim on Windows; spawnSync cannot run it without a shell.
  // Only pnpm goes through the shell (process.execPath has spaces), as one
  // pre-joined string — the args here are fixed literals, never user input.
  const viaShell = process.platform === 'win32' && command === 'pnpm';
  const options = { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, ...env }, shell: viaShell };
  const result = viaShell
    ? spawnSync([command, ...args].join(' '), options)
    : spawnSync(command, args, options);
  if (result.status !== 0) {
    console.error(`\n✖ ${label} failed (exit ${result.status ?? result.signal})`);
    process.exit(result.status ?? 1);
  }
}

const testUrl =
  process.env.TEST_DATABASE_URL ||
  readEnvFile(ENV_TEST).TEST_DATABASE_URL ||
  (isCi ? undefined : DEFAULT_TEST_DATABASE_URL);

if (!testUrl) {
  console.error('TEST_DATABASE_URL is not set (CI must provide it in the environment).');
  process.exit(1);
}

let dbName;
try {
  dbName = new URL(testUrl).pathname.replace(/^\//, '');
} catch {
  console.error('TEST_DATABASE_URL is not a valid URL.');
  process.exit(1);
}
if (!dbName.endsWith('_test')) {
  console.error(`Refusing to run: database "${dbName}" does not end in _test — the suite wipes its tables.`);
  process.exit(1);
}

if (!isCi) {
  step('Start portable Postgres (+ create daktari_test if missing)', process.execPath, [
    path.join(REPO_ROOT, 'scripts', 'db.mjs'),
    'start',
  ]);
}

// DATABASE_URL in the child env wins: prisma.config.ts loads the root .env
// with dotenv, which never overrides variables that are already set.
step(
  `Push Prisma schema into ${dbName}`,
  'pnpm',
  ['--filter', '@daktari/db', 'exec', 'prisma', 'db', 'push', '--skip-generate'],
  { DATABASE_URL: testUrl },
);

step(
  'Run API integration tests',
  'pnpm',
  ['--filter', '@daktari/api-server', 'exec', 'vitest', 'run', 'tests/integration.test.ts'],
  { TEST_DATABASE_URL: testUrl },
);

console.log('\n✔ Integration tests passed');
