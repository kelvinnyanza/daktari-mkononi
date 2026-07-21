/**
 * Populate `process.env` from the repo-root `.env`, as an import side effect.
 *
 * Imported first thing in server.ts so the values exist before
 * `@daktari/config` validates them. The path is resolved from this file rather
 * than the CWD because the server is started from several directories (repo
 * root via turbo, services/api-server via pnpm --filter, dist/ in production),
 * and only one of those would find a relative `.env`.
 *
 * Real environments (containers, CI) inject variables directly; a missing
 * .env is therefore not an error, and existing values always win — dotenv does
 * not overwrite what is already set.
 *
 * This is the one sanctioned `process.env` writer outside @daktari/config
 * (CLAUDE.md forbids *reading* config from process.env elsewhere; loading the
 * file that populates it is the bootstrap step that rule depends on).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// src/lib (tsx) and dist/lib (built) are both two levels below the package.
const PACKAGE_ROOT = path.resolve(HERE, '..', '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');

dotenv.config({ path: path.join(REPO_ROOT, '.env') });
