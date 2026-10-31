/**
 * Every <Tabs.Screen name> / <Stack.Screen name> in an expo-router layout must
 * name a route that exists in that layout's directory: a `<name>.tsx` file, or
 * a `<name>/` folder WITH its own `_layout.tsx`. A folder without a layout is
 * flattened into the parent as `<name>/index`, `<name>/[id]`, … and the
 * screen config silently matches nothing — on device:
 * '[Layout children]: No route named "appointments" exists in nested children'.
 */
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(__dirname, '../../app');
const SCREEN = /<(?:Tabs|Stack|Drawer)\.Screen\s+name=["']([^"']+)["']/g;

function layouts(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return layouts(full);
    return entry.name === '_layout.tsx' ? [full] : [];
  });
}

function routeExists(dir: string, name: string): boolean {
  if (fs.existsSync(path.join(dir, `${name}.tsx`))) return true; // file route (also "x/index", "x/[id]")
  return fs.existsSync(path.join(dir, name, '_layout.tsx')); // nested navigator
}

describe('expo-router layout screen names', () => {
  const all = layouts(APP);

  it('finds the layouts', () => {
    expect(all.length).toBeGreaterThan(3);
  });

  it.each(all.map((file) => [path.relative(APP, file), file]))('%s names only existing routes', (_label, file) => {
    const source = fs.readFileSync(file, 'utf8');
    const dir = path.dirname(file);
    const missing = [...source.matchAll(SCREEN)].map((m) => m[1]!).filter((name) => !routeExists(dir, name));
    expect(missing).toEqual([]);
  });
});
