// Fails if the Android bundle contains more than one copy of a package that
// must be a singleton (two Reacts → "Invalid hook call"; two expo-routers →
// "useLinkPreviewContext must be used within a LinkPreviewContextProvider";
// two @react-navigation/native → lost navigation context).
//
// How: export a real Android bundle with a source map, then group every source
// file by the package directory it came from. pnpm gives each peer-resolution
// variant its own folder (node_modules/.pnpm/<variant>/node_modules/<pkg>), so
// two variants of one package = two copies in the bundle.
//
// Usage: pnpm --filter @daktari/mobile check:bundle-duplicates [--clear]
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SINGLETONS = [
  'react',
  'react-dom',
  'react-native',
  'expo-router',
  '@react-navigation/native',
  '@react-navigation/native-stack',
  '@react-navigation/bottom-tabs',
  '@react-navigation/elements',
  'react-native-screens',
  'react-native-safe-area-context',
  'expo-linking',
  'expo-constants',
];

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daktari-bundle-check-'));
const expoCli = createRequire(path.join(root, 'package.json')).resolve('expo/bin/cli');
const args = [expoCli, 'export', '--platform', 'android', '--dev', '--source-maps', '--output-dir', outDir];
if (process.argv.includes('--clear')) args.push('--clear');
console.log(`Bundling (android, dev) → ${outDir}`);
const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: 'inherit',
  // The bundle only needs a syntactically valid URL; nothing is called.
  env: { ...process.env, EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? 'https://api.example.invalid' },
});
if (result.status !== 0) {
  console.error('expo export failed');
  process.exit(result.status ?? 1);
}

const jsDir = path.join(outDir, '_expo', 'static', 'js', 'android');
const mapFile = fs.readdirSync(jsDir).find((name) => name.endsWith('.map'));
if (mapFile === undefined) {
  console.error('no source map produced');
  process.exit(1);
}
const { sources } = JSON.parse(fs.readFileSync(path.join(jsDir, mapFile), 'utf8'));

/** Package root of a source path: everything up to and including the LAST node_modules/<pkg> segment. */
function packageDir(source) {
  const normalized = source.replace(/\\/g, '/');
  const re = /node_modules\/((?:@[^/]+\/)?[^/]+)/g;
  let match;
  let last = null;
  while ((match = re.exec(normalized)) !== null) last = { name: match[1], end: re.lastIndex };
  if (last === null) return null;
  return { name: last.name, dir: normalized.slice(0, last.end) };
}

const copies = new Map(SINGLETONS.map((name) => [name, new Set()]));
for (const source of sources) {
  const pkg = packageDir(source);
  if (pkg !== null && copies.has(pkg.name)) copies.get(pkg.name).add(pkg.dir);
}

let failed = false;
for (const [name, dirs] of copies) {
  if (dirs.size > 1) {
    failed = true;
    console.error(`✗ ${name}: ${dirs.size} copies in the bundle`);
    for (const dir of dirs) console.error(`    ${dir}`);
  } else {
    console.log(`✓ ${name}: ${dirs.size === 0 ? 'not bundled' : '1 copy'}`);
  }
}
fs.rmSync(outDir, { recursive: true, force: true });
if (failed) {
  console.error('\nDuplicate singleton packages in the mobile bundle — see docs in metro.config.js.');
  process.exit(1);
}
console.log('\nNo duplicate singletons.');
