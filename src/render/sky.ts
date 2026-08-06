import {
  BIOME_SPAN,
  CEILING_Y,
  FLOOR_Y,
  SCREEN,
  VIRTUAL_H,
  biomeAt,
  type Biome,
} from '../game/config';
import { PALETTE, alpha } from './palette';

/**
 * The world behind the game.
 *
 * Everything here is procedural and derived deterministically from scroll
 * distance — no images, no per-frame allocation, no state to reset. Layers move
 * at different rates so the sky reads as deep rather than as a flat backdrop.
 *
 * **The one rule that governs this file: nothing in the background may look
 * like something in the foreground.** The runner game had to delete a unicorn
 * galloping through the middle distance for exactly this reason, and this game
 * makes the trap worse — the gates are literally rainbows and the fairies are
 * literally small bright winged things. So:
 *
 *  - The scenery rainbow is pale, wide and sits above the play band. The hazard
 *    rainbows are saturated, narrow and vertical.
 *  - There are no butterflies. The runner had them and they were charming, and
 *    at this game's speeds they are indistinguishable from a 50-point rescue.
 *    Drifting petals replace them: no glow, no halo, no wings.
 */

// --- band surfaces ----------------------------------------------------------

/**
 * The ceiling: a bank of cloud whose underside is drawn *exactly* at CEILING_Y.
 *
 * puff() centres its lozenges and would overhang the boundary by a few pixels,
 * which is the classic unfair-death sprite bug — you die to a cloud wisp that
 * is drawn below the surface that actually hits you. The bottom row is explicit
 * fillRects clamped to the line, and the puffs go strictly above it.
 */
export function drawCeiling(ctx: CanvasRenderingContext2D, distance: number): void {
  ctx.fillStyle = PALETTE.ceiling;
  ctx.fillRect(0, 0, SCREEN.w, CEILING_Y);

  const offset = distance * 0.5;
  const spacing = 26;
  const start = Math.floor(offset / spacing) * spacing;
  for (let i = 0; i * spacing < SCREEN.w + spacing * 3; i++) {
    const worldX = start + i * spacing;
    const x = worldX - offset;
    if (x > SCREEN.w + spacing || x < -spacing * 2) continue;
    const seed = Math.abs(Math.floor(worldX / spacing)) * 2654435761;
    const bulge = 3 + ((seed >>> 6) % 6);
    // Downward bulges only, and only into the strip we already own.
    ctx.fillRect(Math.round(x), CEILING_Y - bulge, spacing * 0.7, bulge);
  }

  // The hitbox, stated. Everything above this line is solid.
  ctx.fillStyle = PALETTE.ceilingLip;
  ctx.fillRect(0, CEILING_Y - 2, SCREEN.w, 2);
}

/**
 * The floor: meadow or cobbled street, with a bright lip on the hitbox.
 *
 * Drawn in spans rather than as one fill, because the biome changes with world
 * position and the changeover has to *scroll across* the screen like everything
 * else. Repainting the whole strip the moment a boundary is crossed would make
 * the ground under the player change colour instantaneously.
 */
export function drawFloor(ctx: CanvasRenderingContext2D, distance: number): void {
  forEachBiomeSpan(distance, (biome, screenX, spanW, spanWorldX) => {
    if (biome === 'town') drawCobbles(ctx, screenX, spanW, spanWorldX);
    else drawMeadow(ctx, screenX, spanW, spanWorldX);
  });

  // The lip runs unbroken across both: it's the hitbox, and the hitbox does not
  // care which biome it's in. Colour follows the biome under it, so the boundary
  // stays visible without the line ever breaking.
  ctx.fillStyle = PALETTE.floorLip;
  ctx.fillRect(0, FLOOR_Y, SCREEN.w, 3);
}

function drawMeadow(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  spanW: number,
  spanWorldX: number,
): void {
  ctx.fillStyle = PALETTE.meadow;
  ctx.fillRect(screenX, FLOOR_Y, spanW, VIRTUAL_H - FLOOR_Y);

  // Grass tufts strictly BELOW the lip. A tuft poking up through it would be a
  // sprite claiming ground the hitbox doesn't own.
  ctx.fillStyle = alpha(PALETTE.nearHill, 0.8);
  const spacing = 14;
  const first = Math.ceil(spanWorldX / spacing) * spacing;
  for (let wx = first; wx < spanWorldX + spanW; wx += spacing) {
    const seed = Math.abs(Math.floor(wx / spacing)) * 2246822519;
    const h = 3 + ((seed >>> 4) % 4);
    ctx.fillRect(Math.round(screenX + (wx - spanWorldX)), FLOOR_Y + 3, 2, h);
  }
}

function drawCobbles(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  spanW: number,
  spanWorldX: number,
): void {
  ctx.fillStyle = PALETTE.cobble;
  ctx.fillRect(screenX, FLOOR_Y, spanW, VIRTUAL_H - FLOOR_Y);

  // Staggered stones, again strictly below the lip.
  ctx.fillStyle = PALETTE.cobbleDark;
  const w = 11;
  const h = 6;
  for (let row = 0; row < 4; row++) {
    const y = FLOOR_Y + 4 + row * (h + 2);
    if (y > VIRTUAL_H) break;
    const stagger = row % 2 === 0 ? 0 : w / 2;
    const first = Math.floor((spanWorldX - stagger) / w) * w + stagger;
    for (let wx = first; wx < spanWorldX + spanW; wx += w) {
      const x = screenX + (wx - spanWorldX);
      const clipL = Math.max(x, screenX);
      const clipR = Math.min(x + w - 2, screenX + spanW);
      if (clipR > clipL) ctx.fillRect(Math.round(clipL), y, Math.round(clipR - clipL), h);
    }
  }
}

// --- biome spans ------------------------------------------------------------

/**
 * Walk the visible strip, calling back once per run of a single biome.
 *
 * The whole reason the town works: biome is a function of *world position*, so
 * a boundary is a vertical line that scrolls in from the right and passes over
 * you. You fly out of the meadow and into the town. Deriving the biome from the
 * sector number instead — the obvious first idea — swaps every pixel of scenery
 * between one frame and the next, which reads as the renderer glitching rather
 * than as arriving somewhere.
 *
 * Callback receives (biome, screen x, span width, world x of the span start).
 */
export function forEachBiomeSpan(
  distance: number,
  draw: (biome: Biome, screenX: number, spanW: number, spanWorldX: number) => void,
): void {
  const left = distance;
  const right = distance + SCREEN.w;
  let worldX = left;
  while (worldX < right) {
    const biome = biomeAt(worldX);
    // Where this biome's run ends, clamped to the right edge of the screen.
    const boundary = (Math.floor(worldX / BIOME_SPAN) + 1) * BIOME_SPAN;
    const end = Math.min(boundary, right);
    draw(biome, worldX - left, end - worldX, worldX);
    worldX = end;
  }
}

// --- parallax ---------------------------------------------------------------

export function drawBackground(ctx: CanvasRenderingContext2D, distance: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
  sky.addColorStop(0, PALETTE.skyTop);
  sky.addColorStop(1, PALETTE.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, SCREEN.w, VIRTUAL_H);

  drawScenicRainbow(ctx, distance * 0.06);
  drawClouds(ctx, distance * 0.14, 34, 0.5);
  // Midground and near ground are biome-aware; the sky above them is not. A
  // town has the same weather as the field outside it.
  drawMidground(ctx, distance);
  drawPetals(ctx, distance * 0.42);
  drawNearground(ctx, distance);
}

/** The far layer: rolling hills, or the roofs of the town behind its wall. */
function drawMidground(ctx: CanvasRenderingContext2D, distance: number): void {
  drawLayer(distance, 0.3, 46, (biome, x, seed) => {
    if (biome === 'town') drawFarRoof(ctx, x, seed);
    else drawHill(ctx, x, seed, PALETTE.midHill, 46, 30);
  });
}

function drawNearground(ctx: CanvasRenderingContext2D, distance: number): void {
  drawLayer(distance, 0.55, 62, (biome, x, seed) => {
    if (biome === 'town') drawBuilding(ctx, x, seed);
    else drawHill(ctx, x, seed, PALETTE.nearHill, 62, 18);
  });
}

/**
 * Shared element walk for a parallax layer.
 *
 * The biome lookup divides the element's position by the layer's parallax rate
 * before asking, and that division is the whole trick. A layer scrolling at
 * 0.55 has covered 0.55x the world by the time the player has covered all of
 * it, so asking `biomeAt(layerOffset)` puts that layer most of a biome span
 * behind — which is how the first version ended up drawing green hills standing
 * on a cobbled street. Converting back to player-world coordinates first makes
 * every layer agree about where "here" is.
 *
 * It also keeps the transition pop-free: an element's style depends only on its
 * own fixed world position, so nothing ever restyles itself mid-scroll. Slower
 * layers simply change over slightly earlier, which reads as the town being
 * visible in the distance before you reach it.
 */
function drawLayer(
  distance: number,
  rate: number,
  spacing: number,
  drawOne: (biome: Biome, screenX: number, seed: number) => void,
): void {
  const offset = distance * rate;
  const start = Math.floor(offset / spacing) * spacing;
  for (let i = 0; i * spacing < SCREEN.w + spacing * 3; i++) {
    const worldX = start + i * spacing;
    const x = worldX - offset;
    if (x > SCREEN.w + spacing || x < -spacing * 2) continue;
    const seed = Math.abs(Math.floor(worldX / spacing)) * 2654435761;
    drawOne(biomeAt(worldX / rate), x, seed);
  }
}

/**
 * A wide arc high in the sky.
 *
 * The riskiest thing in this file, and it was drawn wrong the first time. The
 * gate obstacles are literally rainbows, so a scenery rainbow arcing through
 * the middle of the play field is the single worst piece of background this
 * game could have — the player spends the run flinching at wallpaper. The first
 * version had a 170px radius centred just below the floor, which put its apex
 * at y=100, dead centre of the flyable band, at an opacity you could not
 * possibly ignore.
 *
 * Three things keep it honest now: it is very faint, it is very wide and flat
 * (a gate is narrow and vertical), and its apex sits just under the ceiling so
 * the whole thing reads as distant sky rather than as an object at play depth.
 */
function drawScenicRainbow(ctx: CanvasRenderingContext2D, offset: number): void {
  const cx = SCREEN.w * 0.62 - (offset % (SCREEN.w * 3));
  const radius = 320;
  const cy = CEILING_Y + 16 + radius;
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.lineWidth = 5;
  for (let i = 0; i < PALETTE.gateBand.length; i++) {
    ctx.strokeStyle = PALETTE.gateBand[i]!;
    ctx.beginPath();
    // Only the top cap of the circle, never the full semicircle. A 320px radius
    // spans wider than the frame, so drawing the whole arc sends its limbs
    // diving down through the middle of the play field — a steep coloured band
    // crossing exactly where the gates live. Clipping to the shallow top keeps
    // it horizon-like.
    ctx.arc(cx, cy, radius - i * 5, Math.PI * 1.16, Math.PI * 1.84);
    ctx.stroke();
  }
  ctx.restore();
}

function drawClouds(
  ctx: CanvasRenderingContext2D,
  offset: number,
  spacing: number,
  opacity: number,
): void {
  ctx.fillStyle = alpha(PALETTE.cloudFar, opacity);
  const period = spacing * 3;
  const start = Math.floor(offset / period) * period;
  for (let i = 0; i * spacing < SCREEN.w + period * 2; i++) {
    const worldX = start + i * spacing * 2.2;
    const x = worldX - offset;
    if (x > SCREEN.w + 40 || x < -60) continue;
    const seed = Math.abs(Math.floor(worldX / spacing)) * 2246822519;
    const y = CEILING_Y + 10 + ((seed >>> 7) % 60);
    const w = 20 + ((seed >>> 3) % 22);
    puff(ctx, x, y, w);
  }
}

/** Three overlapping lozenges read as a cloud without any curves. */
export function puff(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const h = Math.max(6, w * 0.42);
  ctx.fillRect(x, y + h * 0.35, w, h * 0.65);
  ctx.fillRect(x + w * 0.18, y, w * 0.4, h * 0.8);
  ctx.fillRect(x + w * 0.52, y + h * 0.12, w * 0.34, h * 0.7);
}

function drawHill(
  ctx: CanvasRenderingContext2D,
  x: number,
  seed: number,
  colour: string,
  spacing: number,
  maxHeight: number,
): void {
  ctx.fillStyle = colour;
  const h = ((seed >>> 5) % maxHeight) + 14;
  // Stepped mound rather than a rectangle, so hills read as rolling.
  const w = spacing + 16;
  ctx.fillRect(Math.round(x), Math.round(FLOOR_Y - h * 0.55), w, h);
  ctx.fillRect(Math.round(x + w * 0.18), Math.round(FLOOR_Y - h * 0.85), w * 0.64, h);
  ctx.fillRect(Math.round(x + w * 0.34), Math.round(FLOOR_Y - h), w * 0.3, h);
}

/** Distant rooftops, hazed toward the sky so they sit behind everything. */
function drawFarRoof(ctx: CanvasRenderingContext2D, x: number, seed: number): void {
  const h = 24 + ((seed >>> 5) % 34);
  const w = 46 + ((seed >>> 11) % 18);
  const top = FLOOR_Y - h;

  ctx.fillStyle = PALETTE.townFar;
  ctx.fillRect(Math.round(x), Math.round(top + 8), w, h);

  // Stepped gable — a pitched roof without needing a triangle.
  ctx.fillRect(Math.round(x + 6), Math.round(top + 4), w - 12, 6);
  ctx.fillRect(Math.round(x + 12), Math.round(top), w - 24, 6);

  // A spire on some of them, so the skyline isn't a flat row of boxes.
  if ((seed >>> 17) % 3 === 0) {
    ctx.fillRect(Math.round(x + w * 0.45), Math.round(top - 16), 5, 18);
  }
}

/**
 * A near brick building: wall, mortar courses, windows, pitched roof.
 *
 * Kept firmly below the play band's midpoint and drawn in muted stone. It's
 * scenery, and the standing rule for this file is that scenery must never be
 * mistakable for something you have to act on — no bright accents, nothing
 * pulsing, nothing round and dark.
 */
function drawBuilding(ctx: CanvasRenderingContext2D, x: number, seed: number): void {
  // Capped well below the middle of the band. Tall background buildings crowd
  // the airspace the gates live in, and a gate has to be the most legible
  // vertical thing on screen.
  const h = 26 + ((seed >>> 5) % 32);
  const w = 58 + ((seed >>> 13) % 20);
  const top = FLOOR_Y - h;

  ctx.fillStyle = PALETTE.buildingWall;
  ctx.fillRect(Math.round(x), Math.round(top), w, h);

  // Mortar courses. Two-pixel bands are enough to read as brickwork at this
  // scale, and a full brick grid turns into visual noise that competes with
  // the gates.
  ctx.fillStyle = alpha(PALETTE.brickMortar, 0.3);
  for (let y = top + 7; y < FLOOR_Y - 2; y += 7) {
    ctx.fillRect(Math.round(x), Math.round(y), w, 1);
  }

  // Roof, overhanging slightly on both sides.
  ctx.fillStyle = PALETTE.buildingRoof;
  ctx.fillRect(Math.round(x - 3), Math.round(top - 5), w + 6, 6);
  ctx.fillStyle = alpha(PALETTE.roofDark, 0.65);
  ctx.fillRect(Math.round(x + 4), Math.round(top - 10), w - 8, 6);

  // Windows: small and square, and never dark. The darkest thing on screen is
  // always a bomb — that is a rule, and a row of black windows would break it.
  ctx.fillStyle = PALETTE.buildingWindow;
  const cols = Math.max(2, Math.floor(w / 22));
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r * 18 < h - 20; r++) {
      ctx.fillRect(
        Math.round(x + 9 + c * 22),
        Math.round(top + 10 + r * 18),
        7,
        9,
      );
    }
  }

  // An occasional banner, for the medieval read.
  if ((seed >>> 19) % 4 === 0) {
    ctx.fillStyle = alpha(PALETTE.banner, 0.7);
    ctx.fillRect(Math.round(x + w - 14), Math.round(top + 4), 6, 16);
    ctx.fillRect(Math.round(x + w - 13), Math.round(top + 20), 4, 3);
  }
}

/** Tumbling petals. Dull on purpose — see the file comment. */
function drawPetals(ctx: CanvasRenderingContext2D, offset: number): void {
  ctx.fillStyle = alpha(PALETTE.petal, 0.55);
  const spacing = 58;
  const start = Math.floor(offset / spacing) * spacing;
  for (let i = 0; i * spacing < SCREEN.w + spacing * 3; i++) {
    const worldX = start + i * spacing;
    const x = worldX - offset;
    if (x > SCREEN.w + spacing || x < -spacing) continue;
    const seed = Math.abs(Math.floor(worldX / spacing)) * 1597334677;
    const y = CEILING_Y + 20 + ((seed >>> 9) % (FLOOR_Y - CEILING_Y - 40));
    // Two-pixel tumble derived from position, so it flutters without a clock.
    const tumble = (seed >>> 3) % 3;
    ctx.fillRect(Math.round(x), Math.round(y), 3 - tumble, 1 + tumble);
  }
}
