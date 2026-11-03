#!/usr/bin/env node
/**
 * Fail when packages/db/prisma/schema.prisma has changes that no migration in
 * prisma/migrations contains:   pnpm db:migrations:check
 *
 * Prisma replays the migrations into a SHADOW database and diffs the result
 * against the schema. The shadow is the integration-test database (its name
 * must end in _test; it is wiped by every `pnpm test:integration` anyway), so
 * no extra database is needed locally or in CI.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TEST_DATABASE_URL } from './db.mjs';
import { readEnvFile } from './env-file.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shadow =
  process.env.TEST_DATABASE_URL ||
  readEnvFile(path.join(REPO_ROOT, '.env.test')).TEST_DATABASE_URL ||
  DEFAULT_TEST_DATABASE_URL;

let dbName = '';
try {
  dbName = new URL(shadow).pathname.replace(/^\//, '');
} catch {
  // reported below
}
if (!dbName.endsWith('_test')) {
  console.error('Refusing: the shadow database must be a *_test database (it is wiped).');
  process.exit(1);
}

// Prisma's CLI run directly with node: `pnpm exec` turns the meaningful exit
// code 2 ("difference found") into a misleading "command not found".
const DB_DIR = path.join(REPO_ROOT, 'packages', 'db');
const prismaCli = createRequire(path.join(DB_DIR, 'package.json')).resolve('prisma/build/index.js');
const result = spawnSync(
  process.execPath,
  [
    prismaCli,
    'migrate',
    'diff',
    '--from-migrations',
    'prisma/migrations',
    '--to-schema-datamodel',
    'prisma/schema.prisma',
    '--shadow-database-url',
    shadow,
    '--exit-code',
  ],
  { cwd: DB_DIR, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' },
);

// --exit-code: 0 = no difference, 2 = difference, 1 = error.
if (result.status === 0) {
  console.log('✔ prisma/migrations match schema.prisma');
  process.exit(0);
}
if (result.status === 2) {
  console.error('✖ schema.prisma has changes with no migration. Create one with `pnpm db:migrate --name <change>`:');
  console.error(result.stdout);
  process.exit(1);
}
console.error(result.stdout);
process.exit(result.status ?? 1);
