import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Next only auto-loads .env files from THIS directory, but the workspace keeps
// a single .env at the repo root. Load it here so `NEXT_PUBLIC_API_URL` (and
// anything else the portal needs) resolves without a second copy drifting out
// of sync. Values already in the environment win.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources consumed directly.
  transpilePackages: ['@daktari/schemas'],
  eslint: { ignoreDuringBuilds: true }, // linted by the repo-root eslint config
};

export default nextConfig;
