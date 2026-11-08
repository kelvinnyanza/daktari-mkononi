// Rasterizes assets/brand/*.svg into the PNGs the app ships (React Native has
// no built-in SVG renderer, and react-native-svg would be a new native module).
// Dev-only: @resvg/resvg-js is a devDependency and never reaches the bundle.
// Usage: pnpm --filter @daktari/mobile brand:assets
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brand = path.join(root, 'assets', 'brand');

/** [svg source, output png, width px] — @1x/@2x/@3x for a 96dp in-app mark. */
const outputs = [
  ['logo-mark.svg', 'logo-mark.png', 96],
  ['logo-mark.svg', 'logo-mark@2x.png', 192],
  ['logo-mark.svg', 'logo-mark@3x.png', 288],
];

for (const [source, out, width] of outputs) {
  const svg = fs.readFileSync(path.join(brand, source), 'utf8');
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  fs.writeFileSync(path.join(brand, out), png);
  console.log(`${out} (${width}px, ${png.length} bytes)`);
}
