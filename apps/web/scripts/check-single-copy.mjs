#!/usr/bin/env node
/**
 * Fails if a Next build of the portal pulls in more than one copy of a
 * singleton library (React, React DOM, React Query). Two copies mean two
 * React contexts: "No QueryClient set, use QueryClientProvider" (the
 * provider lives in one copy, useQuery reads the other) or "Invalid hook call".
 *
 * Reads Next's own build traces (*.nft.json — the files each route needs),
 * so it checks what actually ships, not what package.json claims.
 *
 *   pnpm --filter @daktari/web build && pnpm --filter @daktari/web check:single-copy
 *   (needs a production build in .next — not while `next dev` owns that dir)
 */
import fs from 'node:fs';
import path from 'node:path';

const SINGLETONS = ['react', 'react-dom', '@tanstack/react-query', '@tanstack/query-core'];
const distDir = path.resolve(process.argv[2] ?? '.next');

function traces(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return traces(full);
    return entry.name.endsWith('.nft.json') ? [full] : [];
  });
}

const files = traces(distDir);
if (files.length === 0) {
  console.error(`check-single-copy: no *.nft.json under ${distDir} — run a production build first`);
  process.exit(2);
}

// ".pnpm/<store-dir>/node_modules/<pkg>/..." → store-dir per singleton package.
const copies = new Map(SINGLETONS.map((name) => [name, new Set()]));
for (const file of files) {
  const { files: deps = [] } = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const dep of deps) {
    const normalized = dep.replace(/\\/g, '/');
    for (const name of SINGLETONS) {
      const match = normalized.match(new RegExp(`\\.pnpm/([^/]+)/node_modules/${name.replace('/', '\\/')}/`));
      if (match) copies.get(name).add(match[1]);
    }
  }
}

let failed = false;
for (const [name, dirs] of copies) {
  const list = [...dirs];
  console.log(`${name.padEnd(24)} ${list.length} cop${list.length === 1 ? 'y' : 'ies'}${list.length ? `: ${list.join(', ')}` : ''}`);
  if (list.length > 1) failed = true;
}

// Libraries webpack BUNDLES (not traced as files) — count a string that
// exists exactly once per bundled copy of the library.
const FINGERPRINTS = { '@tanstack/react-query (bundled)': 'No QueryClient set, use QueryClientProvider to set one' };
function jsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}
const clientChunks = jsFiles(path.join(distDir, 'static', 'chunks'));
for (const [label, needle] of Object.entries(FINGERPRINTS)) {
  const count = clientChunks.reduce((sum, file) => sum + fs.readFileSync(file, 'utf8').split(needle).length - 1, 0);
  console.log(`${label.padEnd(24)} ${count} cop${count === 1 ? 'y' : 'ies'} in client chunks`);
  if (count !== 1) failed = true;
}
if (failed) {
  console.error('\ncheck-single-copy: FAIL — more than one copy of a singleton library in the portal build');
  process.exit(1);
}
console.log(`\ncheck-single-copy: OK (${files.length} route traces)`);
