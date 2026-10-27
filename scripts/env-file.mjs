/**
 * Minimal KEY=VALUE .env reader for the root scripts (the repo root has no
 * dotenv dependency). Handles comments, blank lines, CRLF and surrounding
 * quotes. A blank value (`SMS_API_KEY=`) comes back as undefined — the same
 * "not configured" meaning loadEnv gives it.
 */
import { existsSync, readFileSync } from 'node:fs';

export function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    out[key] = value === '' ? undefined : value;
  }
  return out;
}
