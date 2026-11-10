#!/usr/bin/env node
/**
 * Optimise the onboarding photos for low-end phones.
 *
 *   pnpm --filter @daktari/mobile onboarding:images
 *
 * Originals (any size, git-ignored) live in assets/onboarding/source/
 * onboarding-1..4.jpg. Output: assets/onboarding/onboarding-1..4.jpg —
 * 960×1440 (2:3, the frame the onboarding screen draws them in, so there is no
 * layout jump), centre-cropped, EXIF-rotated then stripped, progressive
 * mozjpeg q70. 960px wide is sharp on a 2× phone and acceptable on an 800dp
 * tablet column, at roughly 100–200 KB each instead of several MB.
 *
 * Re-run after replacing an original. A full-size original dropped straight
 * into assets/onboarding/ is moved to source/ first.
 */
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'onboarding');
const sourceDir = path.join(root, 'source');
const WIDTH = 960;
const HEIGHT = 1440;
const ALREADY_OPTIMISED_BYTES = 400 * 1024;

mkdirSync(sourceDir, { recursive: true });

for (const n of [1, 2, 3, 4]) {
  const name = `onboarding-${n}.jpg`;
  const out = path.join(root, name);
  const src = path.join(sourceDir, name);
  if (!existsSync(src) && existsSync(out) && statSync(out).size > ALREADY_OPTIMISED_BYTES) {
    renameSync(out, src); // a fresh full-size original was dropped in place
  }
  if (!existsSync(src)) {
    console.warn(`skip ${name}: no original in assets/onboarding/source/ (the app shows a placeholder)`);
    continue;
  }
  const info = await sharp(src)
    .rotate()
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 70, progressive: true, mozjpeg: true })
    .toFile(out);
  console.log(`${name}: ${(statSync(src).size / 1024).toFixed(0)} KB → ${(info.size / 1024).toFixed(0)} KB (${info.width}×${info.height})`);
}
