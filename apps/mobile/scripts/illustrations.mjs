#!/usr/bin/env node
/**
 * Health-tip illustrations (UI Phase 3).
 *
 *   pnpm --filter @daktari/mobile illustrations          # rasterise from src/
 *   pnpm --filter @daktari/mobile illustrations --fetch  # re-download from unDraw first
 *
 * Source: unDraw (https://undraw.co — free for commercial use, no attribution
 * required). Recoloured here: the unDraw accent → brand teal #0F7366, the
 * secondary accent → mint #8FD9C6, light skin tones → brown tones.
 *
 * Output:
 *  - assets/illustrations/src/<key>.svg      recoloured SVG (committed, source of truth)
 *  - assets/illustrations/<key>.png @2x @3x  palette PNGs for the app (300/600/900 px wide)
 *  - ../web/public/illustrations/<key>.svg   for the portal editor preview
 *
 * Keys must match HEALTH_TIP_ILLUSTRATIONS in @daktari/schemas.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'assets', 'illustrations');
const srcDir = path.join(outDir, 'src');
const webDir = path.resolve(here, '..', '..', 'web', 'public', 'illustrations');

/** key → unDraw illustration id (https://cdn.undraw.co/illustration/<id>.svg). */
export const ILLUSTRATIONS = {
  'eating-together': 'breakfast-together_vev0',
  'garden-harvest': 'garden-harvest_r6yu',
  'sunny-walk': 'sunny-walk_iadv',
  'bike-ride': 'bike-ride_ba0o',
  'drinking-water': 'cool-break_cipj',
  meditation: 'meditation_k4oa',
  'relaxing-outdoors': 'relaxing-outdoors_s653',
  'doctor-notes': 'doctors-orders_a8sv',
  'heart-check': 'medical-representative_k331',
  'parent-and-baby': 'quality-time_h2b9',
  'safe-home': 'sweet-home_b054',
  protection: 'protection-enabled_pve7',
};

function recolour(svg) {
  return svg
    .replace(/#6c63ff/gi, '#0F7366')
    .replace(/#ff6584/gi, '#8FD9C6')
    .replace(/#(ffb8b8|ffb9b9|ffb6b6|ed9da0|ffb7b7|fbbebe|f9b499)/gi, '#A0673D')
    .replace(/#(a0616a|9e616a|a0616b|cb8b8f)/gi, '#6E4325')
    .replace(/\s+/g, ' ')
    .trim();
}

const fetchFirst = process.argv.includes('--fetch');
for (const dir of [outDir, srcDir, webDir]) mkdirSync(dir, { recursive: true });

for (const [key, id] of Object.entries(ILLUSTRATIONS)) {
  const srcFile = path.join(srcDir, `${key}.svg`);
  if (fetchFirst || !existsSync(srcFile)) {
    const response = await fetch(`https://cdn.undraw.co/illustration/${id}.svg`, {
      headers: { 'user-agent': 'daktari-mkononi-asset-script' },
    });
    if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
    writeFileSync(srcFile, recolour(await response.text()));
  }
  const svg = readFileSync(srcFile, 'utf8');
  writeFileSync(path.join(webDir, `${key}.svg`), svg);
  let total = 0;
  for (const [suffix, width] of [['', 300], ['@2x', 600], ['@3x', 900]]) {
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
    const out = path.join(outDir, `${key}${suffix}.png`);
    const info = await sharp(png).png({ palette: true, quality: 90, compressionLevel: 9 }).toFile(out);
    total += info.size;
  }
  console.log(`${key.padEnd(18)} ← ${id.padEnd(28)} ${(total / 1024).toFixed(0)} KB (3 densities)`);
}
