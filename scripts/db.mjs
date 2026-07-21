#!/usr/bin/env node
/**
 * Local PostgreSQL 16 lifecycle: install / start / stop / status.
 *
 * Why a repo-local server rather than Docker or a system service: the target
 * dev machines are Windows without Docker, WSL, or admin rights, so there is
 * no daemon to install and no port to negotiate with anything else. Portable
 * binaries under `.local/pg16` (gitignored) belong to this checkout, start on
 * demand, and can be deleted by removing one directory.
 *
 * Usage: node scripts/db.mjs <install|start|stop|status|reset>
 */
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PG_HOME = path.join(REPO_ROOT, '.local', 'pg16');
const PG_BIN = path.join(PG_HOME, 'bin');
const PG_DATA = path.join(REPO_ROOT, '.local', 'pgdata');
const PG_LOG = path.join(REPO_ROOT, '.local', 'pg.log');

export const PG_PORT = 5432;
export const PG_USER = 'daktari';
export const PG_PASSWORD = 'daktari';
export const DEV_DB = 'daktari_dev';
export const TEST_DB = 'daktari_test';

// EnterpriseDB publishes the same portable zips the installers unpack.
const DOWNLOAD_URL =
  'https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip';

const isWindows = process.platform === 'win32';
const exe = (name) => path.join(PG_BIN, isWindows ? `${name}.exe` : name);

const exists = async (target) => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

const sleep = (ms) => {
  // Synchronous sleep: this script is a linear sequence of blocking child
  // processes, and going async here would buy nothing.
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // Atomics.wait on a shared buffer blocks without spinning the CPU.
    const shared = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(shared, 0, 0, Math.max(0, until - Date.now()));
  }
};

/** Poll until the server answers, or give up. */
function waitUntilReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isRunning()) return true;
    sleep(250);
  }
  return false;
}

/** pg_isready is the cheapest truthful "is it up" signal. */
export function isRunning() {
  const result = run(exe('pg_isready'), ['-p', String(PG_PORT), '-q']);
  return result.status === 0;
}

async function download() {
  const zipPath = path.join(tmpdir(), 'daktari-pg16.zip');
  process.stdout.write(`Downloading PostgreSQL 16 (~300 MB)…\n  ${DOWNLOAD_URL}\n`);
  const response = await fetch(DOWNLOAD_URL);
  if (!response.ok) {
    throw new Error(`download failed: HTTP ${response.status}. Fetch it manually and unzip so that ${PG_BIN} exists.`);
  }
  await pipeline(response.body, createWriteStream(zipPath));
  return zipPath;
}

async function unzip(zipPath) {
  const staging = path.join(REPO_ROOT, '.local', '_unzip');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  // Expand-Archive ships with Windows PowerShell; no extra tooling to install.
  const result = isWindows
    ? run('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${staging}' -Force`,
      ])
    : run('unzip', ['-q', zipPath, '-d', staging]);
  if (result.status !== 0) throw new Error(`unzip failed: ${result.stderr ?? ''}`);

  // The archive contains a single top-level `pgsql/` directory.
  const entries = await readdir(staging);
  const inner = entries.includes('pgsql') ? path.join(staging, 'pgsql') : path.join(staging, entries[0]);
  await cp(inner, PG_HOME, { recursive: true });
  await rm(staging, { recursive: true, force: true });
}

async function install() {
  if (await exists(exe('postgres'))) {
    console.log(`PostgreSQL binaries already present at ${PG_HOME}`);
  } else {
    await mkdir(path.join(REPO_ROOT, '.local'), { recursive: true });
    const zipPath = await download();
    await unzip(zipPath);
    console.log(`Installed PostgreSQL binaries to ${PG_HOME}`);
  }

  if (await exists(path.join(PG_DATA, 'PG_VERSION'))) {
    console.log(`Data directory already initialised at ${PG_DATA}`);
    return;
  }

  // `trust` auth: this cluster listens on localhost only and holds nothing but
  // seeded fake patients. A password here would be theatre — it would live in
  // the same .env the connection string does.
  const pwFile = path.join(REPO_ROOT, '.local', 'initpw.txt');
  await writeFile(pwFile, PG_PASSWORD, 'utf8');
  const init = run(exe('initdb'), [
    '-D', PG_DATA,
    '-U', PG_USER,
    '--pwfile', pwFile,
    '--auth-local=trust',
    '--auth-host=trust',
    '--encoding=UTF8',
  ]);
  await rm(pwFile, { force: true });
  if (init.status !== 0) {
    throw new Error(`initdb failed:\n${init.stdout ?? ''}${init.stderr ?? ''}`);
  }
  console.log(`Initialised data directory at ${PG_DATA}`);
}

function start() {
  if (isRunning()) {
    console.log(`PostgreSQL already running on port ${PG_PORT}`);
    return;
  }
  // stdio MUST be 'ignore', not inherited: the postgres server pg_ctl spawns
  // inherits our stdout pipe and holds it open for its whole lifetime, so a
  // piped spawnSync never returns even though the server started fine. With
  // no pipes to inherit, pg_ctl forks and exits immediately.
  const result = run(exe('pg_ctl'), [
    '-D', PG_DATA,
    '-l', PG_LOG,
    '-o', `-p ${PG_PORT}`,
    'start',
  ], { stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error(`pg_ctl start failed (see ${PG_LOG})`);
  }
  // pg_ctl returned before the server finished starting; poll for readiness so
  // the very next command in `pnpm db:start && pnpm db:push` can connect.
  if (!waitUntilReady()) {
    throw new Error(`PostgreSQL did not become ready within 30s. See ${PG_LOG}`);
  }
  console.log(`PostgreSQL started on port ${PG_PORT} (log: ${path.relative(REPO_ROOT, PG_LOG)})`);
}

function stop() {
  if (!isRunning()) {
    console.log('PostgreSQL is not running');
    return;
  }
  const result = run(exe('pg_ctl'), ['-D', PG_DATA, '-m', 'fast', '-w', 'stop'], {
    stdio: 'ignore', // same inherited-pipe trap as start
  });
  if (result.status !== 0) {
    throw new Error(`pg_ctl stop failed (see ${PG_LOG})`);
  }
  console.log('PostgreSQL stopped');
}

/** Create the dev and test databases if they are absent (idempotent). */
function ensureDatabases() {
  const psql = exe('psql');
  const listed = run(psql, ['-U', PG_USER, '-p', String(PG_PORT), '-d', 'postgres', '-tAc',
    'SELECT datname FROM pg_database']);
  if (listed.status !== 0) {
    throw new Error(`could not list databases:\n${listed.stderr ?? ''}`);
  }
  const present = new Set(listed.stdout.split('\n').map((line) => line.trim()));
  for (const name of [DEV_DB, TEST_DB]) {
    if (present.has(name)) {
      console.log(`Database ${name} already exists`);
      continue;
    }
    const created = run(exe('createdb'), ['-U', PG_USER, '-p', String(PG_PORT), name]);
    if (created.status !== 0) {
      throw new Error(`createdb ${name} failed:\n${created.stderr ?? ''}`);
    }
    console.log(`Created database ${name}`);
  }
}

function status() {
  const running = isRunning();
  console.log(`binaries : ${PG_HOME}`);
  console.log(`data     : ${PG_DATA}`);
  console.log(`port     : ${PG_PORT}`);
  console.log(`status   : ${running ? 'running' : 'stopped'}`);
  if (running) {
    const dbs = run(exe('psql'), ['-U', PG_USER, '-p', String(PG_PORT), '-d', 'postgres', '-tAc',
      `SELECT datname FROM pg_database WHERE datname IN ('${DEV_DB}','${TEST_DB}')`]);
    console.log(`databases: ${(dbs.stdout ?? '').split('\n').filter(Boolean).join(', ') || '(none)'}`);
  }
  return running ? 0 : 1;
}

async function main() {
  const command = process.argv[2] ?? 'status';
  switch (command) {
    case 'install':
      await install();
      break;
    case 'start':
      await install(); // no-op once present; makes first-run a single command
      start();
      ensureDatabases();
      break;
    case 'stop':
      stop();
      break;
    case 'status':
      process.exitCode = status();
      break;
    case 'reset':
      // Drop and recreate both databases — schema push and seed follow.
      if (!isRunning()) start();
      for (const name of [DEV_DB, TEST_DB]) {
        run(exe('dropdb'), ['-U', PG_USER, '-p', String(PG_PORT), '--if-exists', name]);
      }
      ensureDatabases();
      break;
    default:
      console.error(`Unknown command: ${command}\nUsage: node scripts/db.mjs <install|start|stop|status|reset>`);
      process.exitCode = 2;
  }
}

// Only run when invoked directly; dev-doctor imports the helpers above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
