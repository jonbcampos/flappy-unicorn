/**
 * Generated art, layered over the hand-drawn painters.
 *
 * The whole module is optional. If `public/sprites/index.json` is missing —
 * because nobody has run `scripts/generate-art.mjs`, or the run failed, or half
 * of it failed — `sprite()` returns null for everything and every painter falls
 * back to the shapes it always drew. That is not a graceful-degradation nicety,
 * it is the design: the game shipped playable without any of this, the fairness
 * trials know nothing about it, and a bad art run must never be able to break a
 * working game.
 *
 * Loading is fire-and-forget at startup. Nothing waits for it; sprites simply
 * start appearing as they arrive, which on a warm cache is within a frame or
 * two and on a cold one is a second of hand-drawn art nobody will notice.
 *
 * ## Backgrounds
 *
 * The prompts ask for a flat green background rather than transparency,
 * because image models are far more reliable at "paint the background one flat
 * colour" than at producing an alpha channel. Removing it happens here, on a
 * canvas, once per image.
 *
 * The removal is a FLOOD FILL from the edges, not "delete every green pixel".
 * The difference matters: a flood fill only removes background that is actually
 * connected to the border, so a green highlight inside the slime survives while
 * the green around it goes. It also keys on the colour it finds in the corners
 * rather than on a hard-coded green, so a model that ignores the instruction
 * and gives you a flat white background still works.
 *
 * A second flood then handles background the first one cannot reach — the holes
 * in the Wagon Kid's wagon — seeded only from pixels that are unmistakably the
 * key, and only when the key is a vivid colour. See `cutOutBackground`.
 */

/** A piece that is a grid of animation frames rather than one subject. */
interface SheetSpec {
  cols: number;
  rows: number;
  /**
   * What to line the frames up on.
   *
   * `floor` puts every frame's lowest pixel at the same height, which is what
   * makes a walk cycle read as walking: the feet stay on the ground and the
   * body's rise and fall survives as a difference in height. `center` is for
   * anything that never touches the floor, where the lowest pixel is a dangling
   * foot that is *supposed* to move and aligning on it would cancel the float.
   */
  align?: 'floor' | 'center';
  /**
   * Flip every frame horizontally.
   *
   * The frame sheets are generated facing right and used facing left. That is
   * not a mistake in the prompt — see the note by `FACING_RIGHT` in
   * `scripts/art-manifest.mjs` — it is the model refusing to draw a pose cycle
   * in a stated direction, and a mirror being a free and total fix.
   */
  mirrored?: boolean;
  /**
   * Register each ROW of the grid as its own animation, by id suffix.
   *
   * `['walk', 'grab']` on a 4x2 sheet called `toddler.motion` publishes
   * `toddler.walk` from the top row and `toddler.grab` from the bottom, and
   * nothing under `toddler.motion` at all.
   *
   * This exists because two cycles drawn in two separate calls are two
   * different children. The outfits drifted, then the hair, then the leg
   * length — and pinning each of those in the prompt fixed that detail and
   * moved the drift somewhere else, because the model holds a character
   * together WITHIN an image and simply does not across two. One image with a
   * row per animation is the only version of this that cannot drift.
   */
  rowIds?: readonly string[];
  /**
   * Mirror only these rows (0-based). The raccoon sheet needs it: its sitting
   * rows must face Ellie (left) while its running row faces away (right), and
   * the model draws everything facing right.
   */
  mirrorRows?: readonly number[];
}

interface SpriteIndex {
  generated: string[];
  /** File extension the generator wrote. JPEG today; see generate-art.mjs. */
  ext?: string;
  /** Pieces whose background must NOT be removed — full-bleed images. */
  opaque: string[];
  /** Painted on black for additive blending: never keyed, black-clamped. */
  additive?: string[];
  /** Pieces that are frame grids, by id. */
  sheets?: Record<string, SheetSpec>;
  /**
   * Scenery strips whose key colour is read from the TOP corners only. The
   * hills and roofs run off the bottom of the picture, so the bottom corners
   * are scenery, not background, and averaging them in would key on mud.
   */
  keyTop?: string[];
}

const sprites = new Map<string, HTMLCanvasElement>();
const sheets = new Map<string, HTMLCanvasElement[]>();
let loaded = false;

/**
 * How close a pixel must be to the corner colour to count as background.
 *
 * Generous, because the source is JPEG. Lossy compression puts ringing and
 * colour noise along every edge that meets the flat background, so a tolerance
 * tuned for a clean PNG leaves a speckled green halo around every character.
 */
const KEY_TOLERANCE = 96;
/** Pixels within this of the edge of the key get a soft alpha, to avoid fringing. */
const KEY_FEATHER = 56;
/**
 * How close a pixel must be to the key to START a cut-out of its own.
 *
 * Deliberately far stricter than `KEY_TOLERANCE`. A seed is not protected by
 * being connected to the border, so it has to be background beyond argument;
 * everything softer around it is then swept by the ordinary flood. See the
 * second pass in `cutOutBackground`.
 */
const KEY_SEED = 40;

export function spritesReady(): boolean {
  return loaded;
}

export function spriteCount(): number {
  return sprites.size;
}

/** The generated image for an id, or null if there isn't one. */
export function sprite(id: string): HTMLCanvasElement | null {
  return sprites.get(id) ?? null;
}

/**
 * The animation frames for an id, in cycle order, or null if there aren't any.
 *
 * Every caller must handle null and keep working, exactly as with `sprite()`.
 * A cycle is the third fallback layer down: no art at all gives you the
 * procedural painters, a still gives you the still, and only a sheet that both
 * generated and sliced cleanly gives you frames.
 */
export function spriteFrames(id: string): HTMLCanvasElement[] | null {
  return sheets.get(id) ?? null;
}

/**
 * Draw a sprite centred on (x, y), scaled to fit a box, preserving its aspect.
 *
 * Smoothing is forced on and then restored. The viewport turns smoothing OFF
 * globally, which is right for the hand-drawn art — crisp rectangles — and
 * wrong for a downscaled painting, which without it turns into aliased mush.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
): void {
  const scale = Math.min(boxW / image.width, boxH / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, x - w / 2, y - h / 2, w, h);
  ctx.imageSmoothingEnabled = smoothing;
}

/**
 * The box a frame's actual content occupies, in its own pixels. Cached.
 *
 * Frames come back cell-sized with padding around the subject, and a physics
 * body has to be fitted to the SUBJECT, not to the padding: a raccoon drawn to
 * fill his collision circle must be scaled by his own outline, or he renders
 * smaller than the circle he collides with and seems to float off his plank.
 */
const bounds = new WeakMap<HTMLCanvasElement, ContentBox>();
export function frameBounds(frame: HTMLCanvasElement): ContentBox {
  const cached = bounds.get(frame);
  if (cached) return cached;
  const ctx = frame.getContext('2d', { willReadFrequently: true });
  let box: ContentBox = { x: 0, y: 0, w: frame.width, h: frame.height };
  if (ctx) {
    try {
      box = contentBox(ctx.getImageData(0, 0, frame.width, frame.height)) ?? box;
    } catch {
      // Tainted or unreadable: fall back to the whole frame.
    }
  }
  bounds.set(frame, box);
  return box;
}

/**
 * Draw a frame so that its CONTENT box lands on a world-space box, in the
 * current transform's units. The workhorse for fitting art to physics shapes.
 */
export function drawFitted(
  ctx: CanvasRenderingContext2D,
  frame: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const b = frameBounds(frame);
  const sx = w / b.w;
  const sy = h / b.h;
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(frame, x - b.x * sx, y - b.y * sy, frame.width * sx, frame.height * sy);
  ctx.imageSmoothingEnabled = smoothing;
}

/**
 * Where the art was loaded from, remembered so the dev art check can re-fetch
 * the same sheets without `main.ts` having to hand it the base URL twice.
 */
let spriteBase = '';
export function spriteBaseUrl(): string {
  return spriteBase;
}

/** Kick off loading. Safe to call once at startup; never throws, never blocks. */
export function loadSprites(baseUrl: string): void {
  spriteBase = baseUrl;
  void (async () => {
    let index: SpriteIndex;
    try {
      const response = await fetch(`${baseUrl}sprites/index.json`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(String(response.status));
      index = (await response.json()) as SpriteIndex;
      if (!Array.isArray(index.generated)) throw new Error('malformed index');
    } catch {
      // No generated art. Entirely normal — this is how the game shipped.
      loaded = true;
      return;
    }

    const opaque = new Set(index.opaque ?? []);
    const additive = new Set(index.additive ?? []);
    const keyTop = new Set(index.keyTop ?? []);
    const grids = index.sheets ?? {};
    const ext = index.ext ?? 'jpg';

    // Downloads run in parallel; the CUT-OUTS run one at a time with a yield
    // between them.
    //
    // Each cut-out is a flood fill over a 512x512 image on the main thread, and
    // doing all twenty-six back to back froze the game for long enough that
    // taps queued during startup were still being processed a second later.
    // Yielding turns one long stall into twenty-six short ones the loop can
    // interleave with, and the art simply appears piece by piece — which is
    // exactly the behaviour this module already promises.
    const downloads = index.generated.map(async (id) => ({
      id,
      image: await loadImage(`${baseUrl}sprites/${id}.${ext}`).catch(() => null),
    }));

    for (const pending of downloads) {
      const { id, image } = await pending;
      if (!image) continue; // One bad file loses one sprite, not the set.
      try {
        const grid = grids[id];
        if (grid) {
          // A sheet that won't slice is simply not registered, and the caller
          // falls back to the still. Never register a partial cycle: three good
          // frames and one hole flickers, which is worse than not animating.
          const source = additive.has(id) ? clampBlack(toCanvas(image)) : cutOutBackground(image);
          const cut = sliceSheet(source, grid);
          if (cut) registerSheet(id, cut, grid);
        } else {
          sprites.set(id, opaque.has(id) ? toCanvas(image) : cutOutBackground(image, keyTop.has(id)));
        }
      } catch {
        // A cut-out that throws leaves the hand-drawn version in place.
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    loaded = true;
  })();
}

/**
 * How hard to pull an off-size frame back towards its siblings. 0 is no
 * correction, 1 makes every frame exactly the median height.
 *
 * Not 1, because some of the height difference between frames is real — a
 * running child genuinely is taller stretched out than compressed on the
 * landing — and flattening it would delete the animation along with the error.
 */
const FRAME_SCALE_PULL = 0.75;
/** Never rescale a frame by more than this. A frame that far out is a bad draw. */
const FRAME_SCALE_LIMIT = 0.2;
/**
 * Pixels trimmed from every edge of a cell before it is measured or drawn.
 *
 * A defence against grid lines the model drew despite being told not to. See
 * the note in `sliceSheet`.
 */
const CELL_INSET = 6;

/** Alpha above which a pixel counts as the subject rather than a keyed fringe. */
const FRAME_ALPHA_FLOOR = 24;

/**
 * Cut a frame grid into separate frames, and fix their registration.
 *
 * The registration is the entire point. Asked for four poses of one character
 * in a 2x2 grid, the model draws four poses of one character — and puts them at
 * four slightly different sizes, at four slightly different heights, at four
 * slightly different places in their cells. Played back naively that is a
 * character who grows, shrinks and hops between every frame, which reads worse
 * than the single still it replaced. No amount of prompting fixes it, because
 * it is not a drawing mistake; it is the model having no reason to care about
 * sub-percent alignment.
 *
 * So each frame is measured and moved:
 *
 *  - **Trimmed** to the box that actually contains pixels, so cell padding
 *    stops mattering.
 *  - **Scaled** most of the way towards the median frame height, so one frame
 *    drawn larger stops popping — but only most of the way, see the constant.
 *  - **Planted** on a shared floor line, so the feet stay put and the body's
 *    rise and fall is the only vertical movement left.
 *
 * Frames come back the size of one source cell, with the subject placed inside
 * exactly as a still sprite is placed inside its own square. That is deliberate:
 * it means `drawSprite` treats a frame and a still identically, and swapping
 * between them changes the pose and nothing else.
 */
function sliceSheet(sheet: HTMLCanvasElement, spec: SheetSpec): HTMLCanvasElement[] | null {
  const cols = Math.max(1, Math.floor(spec.cols));
  const rows = Math.max(1, Math.floor(spec.rows));
  const cellW = Math.floor(sheet.width / cols);
  const cellH = Math.floor(sheet.height / rows);
  if (cellW < CELL_INSET * 4 || cellH < CELL_INSET * 4) return null;

  const source = sheet.getContext('2d');
  if (!source) return null;

  const cells: ImageData[] = [];
  const boxes: ContentBox[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Sampled a few pixels INSIDE the cell, on every edge.
      //
      // The prompt forbids grid lines and one sheet drew them anyway — in a
      // green just different enough from the key to survive the cut-out. Every
      // frame then had a hairline at its border, the content box grew to the
      // full cell, and the kid ended up shrunk inside a faint square. Reported
      // as "a very light square around the kid in the big coat".
      //
      // Trimming the edge costs nothing real: the figures are centred with
      // margins, so CELL_INSET pixels of border is margin in every sheet that
      // does NOT have lines, and salvation in one that does.
      const data = source.getImageData(
        col * cellW + CELL_INSET,
        row * cellH + CELL_INSET,
        cellW - CELL_INSET * 2,
        cellH - CELL_INSET * 2,
      );
      const box = contentBox(data);
      // A near-empty quadrant means the model ignored the grid — it drew three
      // frames, or one big figure straddling the middle. Either way there is no
      // cycle here, and the still sprite is a better answer than a hole.
      if (!box || box.w < cellW * 0.15 || box.h < cellH * 0.15) return null;
      cells.push(data);
      boxes.push(box);
    }
  }

  const onFloor = spec.align !== 'center';
  const targetH = median(boxes.map((b) => b.h));
  const targetX = median(boxes.map((b) => b.x + b.w / 2));
  const targetY = median(boxes.map((b) => (onFloor ? b.y + b.h : b.y + b.h / 2)));
  if (targetH <= 0) return null;

  const scaleOf = (box: ContentBox): number =>
    clamp((targetH / box.h) ** FRAME_SCALE_PULL, 1 - FRAME_SCALE_LIMIT, 1 + FRAME_SCALE_LIMIT);
  const anchorXOf = (box: ContentBox): number => box.x + box.w / 2;
  const anchorYOf = (box: ContentBox): number => (onFloor ? box.y + box.h : box.y + box.h / 2);

  // How far the moved frames reach from the shared target point, in each
  // direction, across the whole cycle.
  //
  // Without this the output canvas was simply one cell, and moving a frame
  // could push part of it off the edge — which is precisely what happened to
  // the balloon: its frames are centre-aligned, the tall ones got shifted down,
  // and the balloon itself was sliced off the top in half the cycle. The canvas
  // therefore grows to hold the *union* of all four frames. It never shrinks
  // below a cell, because a tighter crop would make the sprite render larger
  // than the still it replaces and the kid would jump in size as the art loaded.
  let reachL = 0;
  let reachR = 0;
  let reachT = 0;
  let reachB = 0;
  for (const box of boxes) {
    const k = scaleOf(box);
    reachL = Math.max(reachL, (anchorXOf(box) - box.x) * k);
    reachR = Math.max(reachR, (box.x + box.w - anchorXOf(box)) * k);
    reachT = Math.max(reachT, (anchorYOf(box) - box.y) * k);
    reachB = Math.max(reachB, (box.y + box.h - anchorYOf(box)) * k);
  }
  const originX = Math.max(targetX, Math.ceil(reachL));
  const originY = Math.max(targetY, Math.ceil(reachT));
  const outW = Math.max(cellW, Math.ceil(originX + reachR));
  const outH = Math.max(cellH, Math.ceil(originY + reachB));

  const frames: HTMLCanvasElement[] = [];
  for (let i = 0; i < cells.length; i++) {
    const box = boxes[i]!;
    const scratch = document.createElement('canvas');
    scratch.width = cellW - CELL_INSET * 2;
    scratch.height = cellH - CELL_INSET * 2;
    const scratchCtx = scratch.getContext('2d');
    if (!scratchCtx) return null;
    scratchCtx.putImageData(cells[i]!, 0, 0);

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;

    const scale = scaleOf(box);
    // Anchor: the point on this frame that must land on the shared target.
    const anchorX = anchorXOf(box);
    const anchorY = anchorYOf(box);
    ctx.translate(originX, originY);
    // The mirror folds into the same transform. Because it reflects about the
    // anchor, and the anchor is the content's own centre line, a flipped frame
    // lands in exactly the place an unflipped one would.
    const mirror = spec.mirrored || (spec.mirrorRows?.includes(Math.floor(i / cols)) ?? false);
    ctx.scale(mirror ? -scale : scale, scale);
    ctx.translate(-anchorX, -anchorY);
    ctx.drawImage(scratch, 0, 0);
    frames.push(canvas);
  }
  return frames;
}

export interface ContentBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The smallest box containing every non-transparent pixel, or null if none. */
function contentBox(frame: ImageData): ContentBox | null {
  const { width, height, data } = frame;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! <= FRAME_ALPHA_FLOOR) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Publish a sliced sheet under one id, or one id per row.
 *
 * The row split is what lets a single generated image carry two animations of
 * the same character — see `rowIds`.
 */
/** A `rowIds` entry meaning "this row of the sheet is unusable, throw it away". */
const SKIP_ROW = 'skip';

function registerSheet(id: string, frames: HTMLCanvasElement[], spec: SheetSpec): void {
  const rowIds = spec.rowIds;
  if (!rowIds || rowIds.length === 0) {
    sheets.set(id, frames);
    return;
  }
  const cols = Math.max(1, Math.floor(spec.cols));
  // `toddler.motion` -> `toddler`, so the rows publish as `toddler.walk` etc.
  const base = id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : id;

  // Rows that name the SAME animation are concatenated into one longer cycle
  // rather than the later one replacing the earlier. That is what lets a
  // character with only one action — the Balloon Kid, who never stops to grab
  // because she is floating — still be asked for as the 4x2 grid the model
  // reliably draws, and get an eight-frame float out of it.
  //
  // A row named `SKIP_ROW` is thrown away instead. That is for a sheet where
  // one row came back unusable and the rest is fine: the alternative is either
  // shipping the bad row or dropping a whole character back to a still, and
  // both are worse than playing the frames that came out. See the Balloon Kid
  // in `scripts/art-manifest.mjs` for the one case, and its warning about
  // clearing this the moment the sheet is regenerated.
  const byId = new Map<string, HTMLCanvasElement[]>();
  rowIds.forEach((suffix, row) => {
    if (suffix === SKIP_ROW) return;
    const slice = frames.slice(row * cols, row * cols + cols);
    if (slice.length !== cols) return;
    const existing = byId.get(suffix);
    if (existing) existing.push(...slice);
    else byId.set(suffix, [...slice]);
  });
  for (const [suffix, cycle] of byId) sheets.set(`${base}.${suffix}`, cycle);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${url}`));
    image.src = url;
  });
}

/**
 * Crush near-black to black, for additive art. JPEG leaves a faint grey haze
 * in "black" backgrounds, and under additive blending haze is light: every
 * explosion would arrive in a dim glowing rectangle.
 */
function clampBlack(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = frame.data;
  for (let i = 0; i < d.length; i += 4) {
    const m = Math.max(d[i]!, d[i + 1]!, d[i + 2]!);
    if (m < 28) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
    }
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
}

function toCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')?.drawImage(image, 0, 0);
  return canvas;
}

/**
 * Remove the flat background by flooding inwards from every edge pixel.
 *
 * Returns a canvas rather than ImageData because a canvas can be handed
 * straight to `drawImage`, and doing the work once at load beats doing it
 * sixty times a second forever.
 */
function cutOutBackground(image: HTMLImageElement, topOnly = false): HTMLCanvasElement {
  const canvas = toCanvas(image);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const { width, height } = canvas;
  const frame = ctx.getImageData(0, 0, width, height);
  const data = frame.data;

  // The key colour is the average of the four corners. Averaging rather than
  // picking one corner survives a model that put a faint gradient in the
  // background instead of the flat fill it was asked for.
  const corners = topOnly
    ? [0, (width - 1) * 4, 2 * width * 4, (2 * width + width - 1) * 4]
    : [0, (width - 1) * 4, (height - 1) * width * 4, ((height - 1) * width + width - 1) * 4];
  let kr = 0;
  let kg = 0;
  let kb = 0;
  for (const i of corners) {
    kr += data[i]!;
    kg += data[i + 1]!;
    kb += data[i + 2]!;
  }
  kr /= 4;
  kg /= 4;
  kb /= 4;

  // If the corners already have alpha, the model gave us real transparency and
  // there is nothing to key out.
  const cornerAlpha = corners.reduce((sum, i) => sum + data[i + 3]!, 0) / 4;
  if (cornerAlpha < 200) return canvas;

  const distanceAt = (i: number): number => {
    const dr = data[i]! - kr;
    const dg = data[i + 1]! - kg;
    const db = data[i + 2]! - kb;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  // Iterative flood fill with an explicit stack — a recursive one blows the
  // call stack on a 1024x1024 image, which is exactly the size we generate.
  const seen = new Uint8Array(width * height);
  const flood = (stack: number[]): void => {
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (seen[p]) continue;
      seen[p] = 1;
      const i = p * 4;
      const distance = distanceAt(i);
      if (distance > KEY_TOLERANCE + KEY_FEATHER) continue;

      // Feathered edge: pixels close to the key go fully transparent, pixels on
      // the boundary fade. A hard cut leaves a green rim on every curve, which
      // at this scale is the difference between "a sprite" and "a sticker".
      if (distance <= KEY_TOLERANCE) {
        data[i + 3] = 0;
      } else {
        const t = (distance - KEY_TOLERANCE) / KEY_FEATHER;
        data[i + 3] = Math.min(data[i + 3]!, Math.round(255 * t));
        continue; // don't spread through a partially-kept pixel
      }

      const x = p % width;
      const y = (p / width) | 0;
      if (x > 0) stack.push(p - 1);
      if (x < width - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - width);
      if (y < height - 1) stack.push(p + width);
    }
  };

  const edges: number[] = [];
  for (let x = 0; x < width; x++) edges.push(x, x + (height - 1) * width);
  for (let y = 0; y < height; y++) edges.push(y * width, width - 1 + y * width);
  flood(edges);

  // Second pass: the pockets the first one cannot reach.
  //
  // A flood from the border only removes background CONNECTED to the border,
  // which is the whole reason it is a flood — but the Wagon Kid arrives towing a
  // wagon, and a wagon has holes in it. The gaps between the spokes, the
  // triangle under the tow handle and the slot between her arm and her shield
  // are all background enclosed by subject, and every one of them shipped as a
  // bright green patch on the board.
  //
  // Deleting every key-coloured pixel is the obvious fix and the wrong one — it
  // is what the flood exists to avoid, and it would eat a green highlight inside
  // the slime. So this seeds a fresh flood instead, from pixels that are
  // UNAMBIGUOUSLY the key: the seed test is more than twice as strict as the
  // flood's own tolerance, and once a pocket has one seed the ordinary flood
  // sweeps the JPEG noise around its rim exactly as it does on the outside.
  //
  // Only when the background is a vivid colour, which is the whole premise of
  // chroma key: nothing in this game's palette is anywhere near #00FF00. A model
  // that ignored the prompt and gave us a WHITE background gets the border flood
  // and nothing else — half the cast is cream, and the eyes are white.
  const vivid = Math.max(kr, kg, kb) - Math.min(kr, kg, kb) > 110;
  if (vivid) {
    const pockets: number[] = [];
    for (let p = 0; p < width * height; p++) {
      if (seen[p] || data[p * 4 + 3] === 0) continue;
      if (distanceAt(p * 4) <= KEY_SEED) pockets.push(p);
    }
    if (pockets.length > 0) flood(pockets);
  }

  ctx.putImageData(frame, 0, 0);
  return canvas;
}
