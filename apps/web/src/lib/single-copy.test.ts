/**
 * One React Query, one React for the portal.
 *
 * Two copies = two React contexts: QueryClientProvider in one, useQuery in
 * the other → "No QueryClient set, use QueryClientProvider to set one".
 * That happened after a packageExtensions change moved react-query to a new
 * pnpm store dir: pnpm 9 left the OLD dir behind, and a `next dev` running
 * across the install kept compiling some pages against it.
 *
 * This walks pnpm's symlinks from apps/web and fails if
 *  - more than one copy of a singleton is reachable from the web app, or
 *  - an orphaned (unreachable) store dir of one exists — a stale compile can
 *    still resolve it. Fix: delete it / reinstall, then restart `next dev`.
 * The build-level counterpart is scripts/check-single-copy.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = path.resolve(__dirname, '../..');
const ROOT = path.resolve(WEB, '../..');
const STORE = path.join(ROOT, 'node_modules/.pnpm');
const SINGLETONS: Record<string, RegExp> = {
  '@tanstack/react-query': /^@tanstack\+react-query@/,
  react: /^react@/,
  'react-dom': /^react-dom@/,
};

const entryOf = (real: string): string | null => {
  const rel = path.relative(STORE, real);
  return rel.startsWith('..') ? null : (rel.split(path.sep)[0] ?? null);
};

function linkedEntries(nodeModules: string): string[] {
  if (!fs.existsSync(nodeModules)) return [];
  const out: string[] = [];
  for (const name of fs.readdirSync(nodeModules)) {
    if (name === '.pnpm' || name === '.bin') continue;
    const full = path.join(nodeModules, name);
    const names = name.startsWith('@') ? fs.readdirSync(full).map((n) => path.join(full, n)) : [full];
    for (const n of names) {
      try {
        const entry = entryOf(fs.realpathSync(n));
        if (entry) out.push(entry);
      } catch {
        // dangling link
      }
    }
  }
  return out;
}

/** Store entries reachable from an importer's node_modules. */
function closure(importer: string): Set<string> {
  const seen = new Set<string>();
  const queue = linkedEntries(path.join(importer, 'node_modules'));
  while (queue.length > 0) {
    const entry = queue.pop()!;
    if (seen.has(entry)) continue;
    seen.add(entry);
    queue.push(...linkedEntries(path.join(STORE, entry, 'node_modules')).filter((e) => !seen.has(e)));
  }
  return seen;
}

describe.skipIf(!fs.existsSync(STORE))('portal singleton libraries', () => {
  const webClosure = closure(WEB);
  const workspaceClosure = new Set<string>();
  for (const group of ['apps', 'packages', 'services']) {
    for (const name of fs.readdirSync(path.join(ROOT, group))) {
      for (const entry of closure(path.join(ROOT, group, name))) workspaceClosure.add(entry);
    }
  }
  const allEntries = fs.readdirSync(STORE);

  it.each(Object.entries(SINGLETONS))('exactly one %s is reachable from the web app', (_name, pattern) => {
    expect([...webClosure].filter((entry) => pattern.test(entry))).toHaveLength(1);
  });

  it('no orphaned react-query store dir that a stale `next dev` could still resolve', () => {
    const orphans = allEntries.filter(
      (entry) => SINGLETONS['@tanstack/react-query']!.test(entry) && !workspaceClosure.has(entry),
    );
    expect(orphans).toEqual([]);
  });
});
