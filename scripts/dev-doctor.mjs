#!/usr/bin/env node
/**
 * Pre-flight check for a local development environment.
 *
 * Prints one PASS/FAIL line per check and exits non-zero if any failed, so it
 * works both as a human checklist and as a CI/pre-task gate. Every FAIL says
 * what to run next — a diagnostic that only reports "broken" makes the
 * developer go read source.
 */
import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_DB, PG_PASSWORD, PG_PORT, PG_USER, isRunning } from './db.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');

const results = [];
const record = (ok, label, detail) => {
  results.push({ ok, label, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}${detail === undefined ? '' : ` — ${detail}`}`);
};

const exists = async (target) => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

/** Minimal .env parser — enough for KEY=value without exporting or quoting. */
function parseEnvFile(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function checkVersions() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  record(nodeMajor >= 20, `node >= 20 (found ${process.version})`,
    nodeMajor >= 20 ? undefined : 'upgrade Node; the workspace requires >= 20');

  // When invoked as `pnpm dev:doctor`, pnpm advertises itself here. Preferred
  // over spawning: pnpm is a .cmd shim on Windows, which spawnSync can only
  // exec via `shell: true` — and that carries an argument-escaping warning.
  const agent = process.env['npm_config_user_agent'] ?? '';
  const fromAgent = /pnpm\/(\d+\.\d+\.\d+)/.exec(agent)?.[1];
  const pnpmVersion = fromAgent ?? (() => {
    // Standalone `node scripts/dev-doctor.mjs`: fall back to asking pnpm.
    const probe = spawnSync(
      process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      ['--version'],
      { encoding: 'utf8', shell: process.platform === 'win32' },
    );
    return probe.status === 0 ? (probe.stdout ?? '').trim() : '';
  })();

  const pnpmMajor = Number(pnpmVersion.split('.')[0]);
  record(pnpmMajor >= 9, `pnpm >= 9 (found ${pnpmVersion || 'none'})`,
    pnpmMajor >= 9 ? undefined : 'npm install -g pnpm@9');
}

async function checkEnv() {
  if (!(await exists(ENV_PATH))) {
    record(false, '.env present', 'run `pnpm dev:setup`');
    return null;
  }
  record(true, '.env present', path.relative(REPO_ROOT, ENV_PATH));

  const values = parseEnvFile(await readFile(ENV_PATH, 'utf8'));

  // Validate against the real schema rather than re-implementing the rules —
  // this is the same check the server does at boot.
  let loadEnv;
  try {
    ({ loadEnv } = await import('@daktari/config'));
  } catch {
    record(false, 'required env vars valid', 'run `pnpm install` first');
    return values;
  }

  try {
    loadEnv({ ...values, NODE_ENV: values.NODE_ENV ?? 'development' });
    record(true, 'required env vars valid', 'validated against @daktari/config schema');
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error))
      .split('\n')
      .filter((line) => line.trim().startsWith('-'))
      .map((line) => line.trim().slice(2))
      .join('; ');
    record(false, 'required env vars valid', detail || 'see `pnpm dev:setup`');
  }
  return values;
}

function psql(databaseUrl, sql) {
  const binary = path.join(
    REPO_ROOT, '.local', 'pg16', 'bin',
    process.platform === 'win32' ? 'psql.exe' : 'psql',
  );
  // `-d` is required: with the URL as a bare positional, psql treats it as the
  // dbname and then IGNORES the -c query, exiting 0 — which made this check
  // pass without ever running the SQL.
  return spawnSync(binary, ['-d', databaseUrl, '-tAc', sql], { encoding: 'utf8' });
}

function checkDatabase(values) {
  const databaseUrl = values?.DATABASE_URL
    ?? `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${DEV_DB}`;

  if (!isRunning()) {
    record(false, 'PostgreSQL reachable', 'run `pnpm db:start`');
    record(false, 'schema pushed', 'blocked: database is not running');
    record(false, 'seed data present', 'blocked: database is not running');
    return;
  }
  record(true, 'PostgreSQL reachable', `localhost:${PG_PORT}`);

  // A trivial query against a table Prisma owns proves the schema is applied.
  const schema = psql(databaseUrl, 'SELECT count(*) FROM "User"');
  if (schema.status !== 0) {
    record(false, 'schema pushed', 'run `pnpm db:push`');
    record(false, 'seed data present', 'blocked: schema is not pushed');
    return;
  }
  record(true, 'schema pushed', '"User" table queryable');

  const count = Number((schema.stdout ?? '0').trim());
  record(count > 0, 'seed data present',
    count > 0 ? `${count} users` : 'run `pnpm db:seed`');
}

async function main() {
  console.log('\nDaktari Mkononi — dev environment check\n');
  checkVersions();
  const values = await checkEnv();
  checkDatabase(values);

  const failed = results.filter((result) => !result.ok);
  console.log('');
  if (failed.length === 0) {
    console.log(`All ${results.length} checks passed. Start the API with:`);
    console.log('  pnpm --filter @daktari/api-server dev\n');
    return;
  }
  console.log(`${failed.length} of ${results.length} checks failed:`);
  for (const result of failed) {
    console.log(`  - ${result.label}${result.detail === undefined ? '' : `: ${result.detail}`}`);
  }
  console.log('');
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
