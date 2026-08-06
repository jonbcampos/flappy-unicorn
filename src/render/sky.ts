import { CEILING_Y, FLOOR_Y, SCREEN, VIRTUAL_H } from '../game/config';
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

/** The floor: meadow, with a bright lip sitting exactly on the hitbox. */
export function drawFloor(ctx: CanvasRenderingContext2D, distance: number): void {
  ctx.fillStyle = PALETTE.meadow;
  ctx.fillRect(0, FLOOR_Y, SCREEN.w, VIRTUAL_H - FLOOR_Y);

  ctx.fillStyle = PALETTE.floorLip;
  ctx.fillRect(0, FLOOR_Y, SCREEN.w, 3);

  // Grass tufts strictly BELOW the lip. A tuft poking up through it would be a
  // sprite claiming ground the hitbox doesn't own.
  ctx.fillStyle = alpha(PALETTE.nearHill, 0.8);
  const spacing = 14;
  const offset = distance % spacing;
  for (let x = -offset; x < SCREEN.w + spacing; x += spacing) {
    const seed = Math.abs(Math.floor((x + distance) / spacing)) * 2246822519;
    const h = 3 + ((seed >>> 4) % 4);
    ctx.fillRect(Math.round(x), FLOOR_Y + 3, 2, h);
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
  drawHills(ctx, distance * 0.3, PALETTE.midHill, 46, 30);
  drawPetals(ctx, distance * 0.42);
  drawHills(ctx, distance * 0.55, PALETTE.nearHill, 62, 18);
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

function drawHills(
  ctx: CanvasRenderingContext2D,
  offset: number,
  colour: string,
  spacing: number,
  maxHeight: number,
): void {
  ctx.fillStyle = colour;
  const start = Math.floor(offset / spacing) * spacing;
  for (let i = 0; i * spacing < SCREEN.w + spacing * 3; i++) {
    const worldX = start + i * spacing;
    const x = worldX - offset;
    if (x > SCREEN.w + spacing || x < -spacing * 2) continue;
    const seed = Math.abs(Math.floor(worldX / spacing)) * 2654435761;
    const h = ((seed >>> 5) % maxHeight) + 14;
    // Stepped mound rather than a rectangle, so hills read as rolling.
    const w = spacing + 16;
    ctx.fillRect(Math.round(x), Math.round(FLOOR_Y - h * 0.55), w, h);
    ctx.fillRect(Math.round(x + w * 0.18), Math.round(FLOOR_Y - h * 0.85), w * 0.64, h);
    ctx.fillRect(Math.round(x + w * 0.34), Math.round(FLOOR_Y - h), w * 0.3, h);
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
