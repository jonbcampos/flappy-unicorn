/**
 * Does the generated art match the grid the slicer is going to cut it into?
 *
 * This exists because three sprite sheets shipped wrong and nothing noticed.
 * The manifest asked the model for a 4x2 grid; it drew the crawler as 4x4 and
 * the sock slider as 4x3, and it drew the balloon as 4x2 when the manifest had
 * asked for 4x1. In every case `sliceSheet` dutifully cut the grid it was TOLD
 * about, so each frame contained two children stacked on top of each other,
 * squeezed into a box sized for one. Reported from play as "the balloon girl is
 * small (and doubled)", weeks after it went out.
 *
 * Nothing in either checking tier could have caught it. The design contracts are
 * arithmetic over config and the trials drive the simulation — neither has any
 * idea what a picture looks like, and that is correct: the game is playable with
 * no generated art at all. So this is a third, separate check, run by hand
 * after an art run rather than on every page load:
 *
 *     __game.checkArt()
 *
 * ## How it decides
 *
 * It counts BANDS of content down the image: rows of pixels that are not
 * chroma-key green, separated by rows that are. On a correct sheet that count
 * equals the number of rows in the grid, because the prompt demands a clear
 * band of background around every figure.
 *
 * Columns are deliberately not checked. Figures reach sideways — an arm, a
 * pulled toy — and neighbouring cells overlap far too often for a band count
 * across to mean anything. Rows are reliable precisely because feet and heads
 * do not.
 *
 * A character whose art has a genuine horizontal gap inside it reads high: the
 * Balloon Kid scans as four or five bands on a two-row sheet, because the
 * balloon, the string and the child are separated by background. Those sheets
 * are named in `DETACHED` and only have to clear a floor.
 *
 * Everything else must match EXACTLY. The first version of this allowed
 * anything under twice the row count, on the theory that a stray band was
 * probably a gap — and it let the sock slider straight through at three bands
 * on a two-row grid, which is precisely the fault being looked for. A checker
 * with a tolerance wide enough to cover the bug it was written for is worse
 * than none, because it certifies the thing it missed.
 */

/**
 * Sheets whose character is drawn in pieces separated by background, so one row
 * legitimately scans as more than one band. Add to this only after LOOKING at
 * the image and confirming the grid is right.
 */
const DETACHED = new Map<string, string>([
  // The fizzle row is a puff breaking up into confetti: pieces on purpose.
  ['bomb.motion', 'the fizzle frames are scattered confetti and stars'],
]);

import { spriteBaseUrl } from '../render/sprites';

export interface ArtCheck {
  sheet: string;
  /** Grid the slicer will cut, from index.json. */
  expected: string;
  /** Bands of content counted down the image. */
  bands: number;
  size: string;
  verdict: 'ok' | 'SUSPECT' | 'unreadable';
  note: string;
}

/** A pixel is background if it is the flat green the prompts demand. */
function isKey(r: number, g: number, b: number): boolean {
  return g > 110 && g > r + 50 && g > b + 50;
}

/** For additive art: background is near-black. */
function isBlack(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) < 28;
}

/**
 * Count bands, ignoring a thin strip at every column boundary.
 *
 * The explosion sheet came back with grey grid lines despite the prompt. A
 * vertical line touches every row, so the whole image counted as one band and a
 * correct sheet read as SUSPECT. The slicer already trims cell edges
 * (CELL_INSET in sprites.ts), so the checker ignores the same strips.
 */
function countBands(data: Uint8ClampedArray, w: number, h: number, black: boolean, cols: number, rows: number): number {
  // Background is whatever colour the corners are: green, magenta (the toot
  // clouds, which are green themselves) or black (the additive explosion).
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
  const key = [0, 1, 2].map((c) => corners.reduce((sum, i) => sum + data[i + c]!, 0) / 4);
  const background = black
    ? isBlack
    : (r: number, g: number, b: number): boolean =>
        Math.hypot(r - key[0]!, g - key[1]!, b - key[2]!) < 110 || isKey(r, g, b);
  const strip = Math.max(3, Math.round(w * 0.006));
  const nearBoundary = (x: number): boolean => {
    for (let c = 0; c <= cols; c++) if (Math.abs(x - (c * w) / cols) <= strip) return true;
    return false;
  };
  let bands = 0;
  let inBand = false;
  const rowStrip = Math.max(3, Math.round(h * 0.006));
  const onRowLine = (y: number): boolean => {
    for (let r = 1; r < rows; r++) if (Math.abs(y - (r * h) / rows) <= rowStrip) return true;
    return false;
  };
  for (let y = 0; y < h; y++) {
    let any = false;
    if (onRowLine(y)) {
      inBand = false;
      continue;
    }
    // Every second pixel across. A figure is hundreds of pixels wide; missing
    // one column of an antenna is not worth doubling the work.
    for (let x = 0; x < w; x += 2) {
      if (nearBoundary(x)) continue;
      const i = (y * w + x) * 4;
      if (!background(data[i]!, data[i + 1]!, data[i + 2]!)) {
        any = true;
        break;
      }
    }
    if (any && !inBand) bands += 1;
    inBand = any;
  }
  return bands;
}

function measure(url: string, black: boolean, cols: number, rows: number): Promise<{ bands: number; w: number; h: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return resolve(null);
      ctx.drawImage(image, 0, 0);
      try {
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve({ bands: countBands(data, canvas.width, canvas.height, black, cols, rows), w: image.width, h: image.height });
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

interface IndexShape {
  ext?: string;
  additive?: string[];
  sheets?: Record<string, { cols: number; rows: number }>;
}

export async function checkArt(): Promise<ArtCheck[]> {
  const base = spriteBaseUrl();
  let index: IndexShape;
  try {
    const response = await fetch(`${base}sprites/index.json`, { cache: 'no-cache' });
    index = (await response.json()) as IndexShape;
  } catch {
    console.log('%c[art] no generated art to check', 'color:#888');
    return [];
  }

  const ext = index.ext ?? 'jpg';
  const specs = Object.entries(index.sheets ?? {});
  const results: ArtCheck[] = [];

  for (const [id, spec] of specs) {
    const found = await measure(`${base}sprites/${id}.${ext}`, (index.additive ?? []).includes(id), spec.cols, spec.rows);
    if (!found) {
      results.push({
        sheet: id,
        expected: `${spec.cols}x${spec.rows}`,
        bands: 0,
        size: '-',
        verdict: 'unreadable',
        note: 'could not load or read the image',
      });
      continue;
    }
    const detached = DETACHED.get(id);
    const ok = detached ? found.bands >= spec.rows : found.bands === spec.rows;
    results.push({
      sheet: id,
      expected: `${spec.cols}x${spec.rows}`,
      bands: found.bands,
      size: `${found.w}x${found.h}`,
      verdict: ok ? 'ok' : 'SUSPECT',
      note: ok
        ? detached
          ? `${found.bands} bands over ${spec.rows} rows — expected, ${detached}`
          : `${found.bands} band(s) of content for ${spec.rows} row(s)`
        : `${found.bands} bands of content but the slicer will cut ${spec.rows} rows — every frame will hold about ${(
            found.bands / spec.rows
          ).toFixed(1)} figures stacked, drawn at a fraction of the right size`,
    });
  }

  console.table(results);
  const bad = results.filter((r) => r.verdict !== 'ok');
  if (bad.length === 0) {
    console.log(`%c${results.length} sheets, every grid as asked for`, 'color:#2a2');
  } else {
    console.error(`${bad.length} of ${results.length} sheets do not match their grid`);
    for (const r of bad) console.error(`  ${r.sheet}: ${r.note}`);
  }
  return results;
}
