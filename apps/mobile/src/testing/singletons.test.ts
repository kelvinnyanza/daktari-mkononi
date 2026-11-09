/**
 * Fast guard (no bundling) for packages that hold React context and must exist
 * ONCE. pnpm gives each peer-resolution variant of a package its own folder in
 * node_modules/.pnpm; a second folder for any of these is how the app got two
 * expo-routers ("useLinkPreviewContext must be used within a
 * LinkPreviewContextProvider" on every render). These packages are used only
 * by apps/mobile, so the whole store must hold exactly one variant each.
 *
 * The authoritative check is the real bundle:
 *   pnpm --filter @daktari/mobile check:bundle-duplicates   (also in CI)
 */
import fs from 'node:fs';
import path from 'node:path';

const MOBILE = path.resolve(__dirname, '../..');
const STORE = path.resolve(MOBILE, '../../node_modules/.pnpm');
const METRO_CONFIG = fs.readFileSync(path.join(MOBILE, 'metro.config.js'), 'utf8');

/** pnpm folder prefix for a package name: "@scope/pkg" → "@scope+pkg@". */
const storePrefix = (name: string): string => `${name.replace('/', '+')}@`;

const MOBILE_ONLY_SINGLETONS = [
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

describe('singleton packages (mobile)', () => {
  const storeDirs = fs.existsSync(STORE) ? fs.readdirSync(STORE) : [];

  it('finds the pnpm store (guards against a vacuous pass)', () => {
    expect(storeDirs.length).toBeGreaterThan(100);
  });

  it.each(MOBILE_ONLY_SINGLETONS)('%s has exactly one copy in the store', (name) => {
    const variants = storeDirs.filter((dir) => dir.startsWith(storePrefix(name)));
    // More than one: a stale or second peer-variant folder — delete orphans or
    // align peers (see metro.config.js). Zero: the package moved; update this list.
    expect(variants).toHaveLength(1);
  });

  it('the app resolves react 19.1 (not the web portal’s 19.2)', () => {
    const pkg = JSON.parse(
      fs.readFileSync(require.resolve('react/package.json', { paths: [MOBILE] }), 'utf8'),
    ) as { version: string };
    expect(pkg.version).toMatch(/^19\.1\./);
  });

  it.each(['react', 'react-dom', 'expo-router', 'react-native-screens', 'react-native-safe-area-context'])(
    'metro.config.js pins %s to the app’s copy',
    (name) => {
      const pinned = /const PINNED = \/\^\(([^)]*)\)/.exec(METRO_CONFIG)?.[1]?.split('|') ?? [];
      expect(pinned).toContain(name);
    },
  );

  it('metro.config.js resolves @react-navigation/* from the app’s expo-router', () => {
    expect(METRO_CONFIG).toMatch(/const NAVIGATION = \/\^@react-navigation\\\//);
    expect(METRO_CONFIG).toContain("require.resolve('expo-router/package.json'");
  });
});
