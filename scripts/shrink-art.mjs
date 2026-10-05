/**
 * Resample the generated art down to the size the game actually draws it at.
 *
 *   npm run art:shrink            # everything oversized
 *   npm run art:shrink -- --dry-run
 *
 * The image API returns generously large pictures — a 2752x1536 background, a
 * 1024x1024 walk sheet — and the game draws a kid about thirty pixels tall. The
 * excess is pure download: it costs a phone on a slow connection real seconds
 * and buys a detail nobody can see. Before this script the set was about 14 MB.
 *
 * ## Why a separate script rather than generating smaller
 *
 * Downscaling a large picture keeps more detail than asking the model for a
 * small one, because it is a resample of a finished drawing rather than a
 * coarser drawing. It is also free and repeatable, where regenerating is billed
 * and comes back as different art. So: generate big once, shrink to taste, and
 * re-shrink whenever the targets below change.
 *
 * ## Why sips
 *
 * It ships with macOS, so this stays consistent with the project's no-runtime-
 * dependency rule — nothing is added to package.json and nothing is installed.
 * The cost is that this script is macOS-only, which is acceptable for a tool
 * that is run by hand every few weeks and whose output is committed. On another
 * platform, do the same thing with ImageMagick and commit the result.
 *
 * ## This overwrites the originals
 *
 * Deliberately, because the originals are what get committed and served. The
 * full-size versions stay in git history if a target here ever turns out to be
 * too aggressive; recovering one is `git show <rev>:public/sprites/room.jpg`.
 * Running twice is harmless — anything already at or under its target is
 * skipped, so this is idempotent.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIECES } from './art-manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'sprites');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');

/**
 * Target widths, in pixels, and the reasoning for each. These are the numbers
 * to change; everything else in this file is plumbing.
 *
 * The rule throughout is roughly 4x the largest size the game ever draws the
 * thing at. That is generous — 2x would be defensible — but resampling is
 * one-way and the headroom costs little now that the backgrounds are handled.
 */
const TARGETS = {
  /**
   * Full-bleed backgrounds and scenery strips: MAX_VIRTUAL_W (640) at MAX_DPR
   * (2). Strips are tiled, so a copy is never wider than the frame either.
   */
  background: 1280,
  /**
   * Per FRAME of a sheet. The unicorn with Ellie on board is drawn about 38
   * virtual pixels across, so about 76 device pixels; the fairy, kid and bomb
   * 30-50. Roughly 4x the larger.
   */
  unicornFrame: 288,
  sheetFrame: 192,
  /** Gate pillars: a column is 26 virtual px wide, 52 device px. */
  sprite: 256,
};

function targetFor(piece) {
  if (piece.background === 'none' || piece.background === 'magenta') return TARGETS.background;
  if (piece.id === 'unicorn.motion') return TARGETS.unicornFrame * piece.sheet.cols;
  if (piece.sheet) return TARGETS.sheetFrame * Math.max(1, piece.sheet.cols);
  return TARGETS.sprite;
}

function widthOf(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', file], { encoding: 'utf8' });
  return Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1] ?? 0);
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} kB`;
}

try {
  execFileSync('sips', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('\nThis script needs `sips`, which ships with macOS.\n');
  process.exit(1);
}

if (!existsSync(OUT_DIR) || readdirSync(OUT_DIR).length === 0) {
  console.error('\nNothing in public/sprites yet. Run `npm run art` first.\n');
  process.exit(1);
}

let before = 0;
let after = 0;
let shrunk = 0;

for (const piece of PIECES) {
  const file = join(OUT_DIR, `${piece.id}.jpg`);
  if (!existsSync(file)) continue;

  const size = statSync(file).size;
  before += size;

  const target = targetFor(piece);
  const width = widthOf(file);
  if (width <= target) {
    after += size;
    console.log(`  keep    ${piece.id.padEnd(16)} ${width}px, ${kb(size)}`);
    continue;
  }

  if (DRY) {
    after += size;
    console.log(`  would   ${piece.id.padEnd(16)} ${width}px -> ${target}px`);
    continue;
  }

  // Quality 80 rather than the default. The cut-out in src/render/sprites.ts
  // floods inward from the edges with a generous tolerance, so it copes with
  // JPEG noise along the chroma-key boundary — but there is no reason to hand
  // it more than necessary, and at these sizes 80 is visually lossless.
  execFileSync('sips', ['--resampleWidth', String(target), '-s', 'formatOptions', '80', file], {
    stdio: 'ignore',
  });

  const now = statSync(file).size;
  after += now;
  shrunk++;
  console.log(`  ok      ${piece.id.padEnd(16)} ${width}px -> ${target}px, ${kb(size)} -> ${kb(now)}`);
}

const saved = before - after;
console.log(
  `\n${shrunk} resampled. ${kb(before)} -> ${kb(after)}` +
    (saved > 0 ? ` (${((saved / before) * 100).toFixed(0)}% smaller)` : '') +
    (DRY ? '\nDry run: nothing was written.' : ''),
);
