// Prisma config (replaces the deprecated package.json#prisma block).
// Unlike the legacy setup, prisma.config.ts does not auto-load .env.
//
// The path must be EXPLICIT: these commands run with CWD = packages/db (pnpm
// --filter), so a bare `dotenv/config` looks for packages/db/.env, silently
// finds nothing, and leaves DATABASE_URL unset. The single source of truth is
// the one .env at the repo root.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
