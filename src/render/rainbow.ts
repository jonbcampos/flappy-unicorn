import type { Aabb } from '../game/collision';
import { BOMB, CEILING_Y, FAIRY, FLOOR_Y, GATE, SHOT, UNICORN } from '../game/config';
import type { Bomb } from '../game/bombs';
import type { Fairy } from '../game/fairies';
import type { Gate } from '../game/gates';
import type { GameState } from '../game/state';
import { PALETTE, alpha } from './palette';
import { puff } from './sky';

/**
 * Everything in the play field, drawn.
 *
 * Pure canvas rectangles and arcs — no sprite sheets, no images, no emoji. That
 * keeps the whole game a ~30 kB download and means art changes are code
 * changes, which is the right trade for a game with five object types.
 *
 * Two rules run through all of it:
 *
 * **1. A sprite may be smaller than its hitbox, never larger.** Every overhang
 * is a death the player watched themselves avoid.
 *
 * **2. The bomb is the darkest thing on screen and the fairy the brightest.**
 * They demand opposite responses within a fraction of a second. Hue alone is
 * not a reliable difference at speed for a small child; value is.
 */

const scratch: Aabb = { x: 0, y: 0, w: 0, h: 0 };

// --- the unicorn ------------------------------------------------------------

/**
 * Wingbeat animation, held here rather than in the simulation.
 *
 * The wings are pure presentation — nothing in the game reads them — so they
 * have no business occupying space in GameState. Seeded by the 'flap' event and
 * left to idle between flaps.
 */
let wingTimer = 0;
let wingPhase = 0;

export function onFlap(): void {
  wingTimer = 0.26;
}

export function updateUnicornAnim(dt: number): void {
  wingPhase += dt;
  if (wingTimer > 0) wingTimer = Math.max(0, wingTimer - dt);
}

export function resetUnicornAnim(): void {
  wingTimer = 0;
  wingPhase = 0;
  trailCount = 0;
}

/** Recent positions for the rainbow trail. A ring buffer, never reallocated. */
const TRAIL_LENGTH = 10;
const trailX = new Float32Array(TRAIL_LENGTH);
const trailY = new Float32Array(TRAIL_LENGTH);
let trailCursor = 0;
let trailCount = 0;

export function pushTrail(x: number, y: number): void {
  trailX[trailCursor] = x;
  trailY[trailCursor] = y;
  trailCursor = (trailCursor + 1) % TRAIL_LENGTH;
  if (trailCount < TRAIL_LENGTH) trailCount++;
}

export function drawUnicorn(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  interpolation: number,
): void {
  const player = state.player;
  // Blink through i-frames. Skipping every other frame is crude and completely
  // legible, which is the whole job — the player must know they're safe.
  if (!player.dead && player.invulnerable && Math.floor(state.elapsed * 20) % 2 === 0) return;

  player.bounds(scratch, interpolation);
  const cx = scratch.x + scratch.w / 2;
  const cy = scratch.y + scratch.h / 2;

  drawTrail(ctx, cx, cy);

  ctx.save();
  ctx.translate(cx, cy);
  // The death spin reads as "you lost control" without needing a new sprite.
  ctx.rotate(player.dead ? state.elapsed * 6 : player.tilt);

  const w = UNICORN.width;
  const h = UNICORN.height;

  // Wings behind the body, so the body reads as the solid thing.
  const beat = wingTimer > 0 ? 1 - wingTimer / 0.26 : (Math.sin(wingPhase * 4) + 1) / 2;
  const lift = -3 - beat * 7;
  ctx.fillStyle = alpha(PALETTE.playerCore, 0.85);
  ctx.fillRect(-w * 0.18, lift, 9, 4);
  ctx.fillRect(-w * 0.1, lift + 4, 7, 3);
  ctx.fillStyle = alpha(PALETTE.fairyWing, 0.7);
  ctx.fillRect(-w * 0.24, lift - 2, 6, 3);

  // Tail, streaming back.
  ctx.fillStyle = PALETTE.mane;
  ctx.fillRect(-w / 2 - 3, -2, 5, 3);
  ctx.fillRect(-w / 2 - 5, 0, 4, 3);

  // Barrel and legs.
  ctx.fillStyle = PALETTE.player;
  ctx.fillRect(-w / 2 + 1, -h / 2 + 4, w - 6, h - 7);
  ctx.fillStyle = PALETTE.playerDim;
  ctx.fillRect(-w / 2 + 3, h / 2 - 3, 3, 3);
  ctx.fillRect(w / 2 - 9, h / 2 - 3, 3, 3);

  // Neck and head, forward.
  ctx.fillStyle = PALETTE.player;
  ctx.fillRect(w / 2 - 8, -h / 2 + 1, 5, 6);
  ctx.fillRect(w / 2 - 6, -h / 2, 6, 5);

  // Mane along the neck.
  ctx.fillStyle = PALETTE.mane;
  ctx.fillRect(w / 2 - 10, -h / 2 + 1, 3, 6);

  // Horn. Gold, and the only gold on the body, so the muzzle is unmistakable.
  ctx.fillStyle = PALETTE.horn;
  ctx.fillRect(w / 2 - 1, -h / 2 - 2, 4, 2);
  ctx.fillRect(w / 2 + 1, -h / 2 - 3, 2, 2);

  // Eye.
  ctx.fillStyle = PALETTE.playerCore;
  ctx.fillRect(w / 2 - 4, -h / 2 + 1, 2, 2);

  ctx.restore();
}

/** Four fading rainbow segments behind the body. */
function drawTrail(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  pushTrail(cx, cy);
  if (trailCount < 4) return;
  for (let i = 1; i <= 4; i++) {
    const index = (trailCursor - 1 - i * 2 + TRAIL_LENGTH * 2) % TRAIL_LENGTH;
    if (i * 2 >= trailCount) break;
    const fade = 0.34 * (1 - i / 5);
    ctx.fillStyle = alpha(PALETTE.gateBand[i % PALETTE.gateBand.length]!, fade);
    ctx.fillRect(Math.round(trailX[index]! - 12 - i * 3), Math.round(trailY[index]! - 2), 8, 4);
  }
}

// --- gates ------------------------------------------------------------------

export function drawGates(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  interpolation: number,
): void {
  for (const gate of state.gates.items) {
    if (!gate.active) continue;
    const x = gate.prevX + (gate.x - gate.prevX) * interpolation;
    // A moving gate's opening is interpolated too, or it stutters vertically at
    // exactly the moment the player is judging how much room they have.
    const centreY = gate.prevCentreY + (gate.centreY - gate.prevCentreY) * interpolation;
    if (gate.variant === 'tower') drawTowerGate(ctx, gate, x, centreY);
    else if (gate.variant === 'gatehouse') drawGatehouse(ctx, gate, x, centreY);
    else drawArchGate(ctx, gate, x, centreY);

    if (gate.amplitude > 0) drawDriftMarks(ctx, gate, x, centreY);
  }
}

/**
 * Chevrons on a drifting gate's lips.
 *
 * A moving gap has to *announce* that it moves. Without a tell the player reads
 * a gate, commits to an altitude, and only discovers it was the moving kind
 * when it closes on them — which is indistinguishable from the game cheating.
 * The marks point along the direction of travel, so the tell also says which
 * way it's currently going.
 */
function drawDriftMarks(
  ctx: CanvasRenderingContext2D,
  gate: Gate,
  x: number,
  centreY: number,
): void {
  const rising = gate.centreY < gate.prevCentreY;
  const dir = rising ? -1 : 1;
  const half = gate.gapHeight / 2;
  ctx.fillStyle = alpha(PALETTE.gateLip, 0.9);
  for (let i = 0; i < 3; i++) {
    const w = 6 - i * 2;
    const cx = x + GATE.width / 2 - w / 2;
    ctx.fillRect(Math.round(cx), Math.round(centreY - half - 6 + i * 2 * dir), w, 1);
    ctx.fillRect(Math.round(cx), Math.round(centreY + half + 5 - i * 2 * dir), w, 1);
  }
}

/**
 * A rainbow arch: six nested bands per column, plus the lip.
 *
 * The 3px white lip drawn exactly on the hitbox boundary is the single most
 * important detail in the game — it is not decoration, it is the instruction.
 * The player is reading "how much room do I have" thirty times a second, and
 * the lip is the only thing telling them the truth about where the hitbox ends.
 */
function drawArchGate(
  ctx: CanvasRenderingContext2D,
  gate: Gate,
  x: number,
  centreY: number,
): void {
  const top = centreY - gate.gapHeight / 2;
  const bottom = centreY + gate.gapHeight / 2;
  drawArchColumn(ctx, x, CEILING_Y, top - CEILING_Y, false);
  drawArchColumn(ctx, x, bottom, FLOOR_Y - bottom, true);
}

function drawArchColumn(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  openingAbove: boolean,
): void {
  if (h <= 0) return;
  const bands = PALETTE.gateBand;
  const bandW = GATE.width / bands.length;
  for (let i = 0; i < bands.length; i++) {
    ctx.fillStyle = bands[i]!;
    ctx.fillRect(Math.round(x + i * bandW), Math.round(y), Math.ceil(bandW), Math.round(h));
  }

  // Stepped shoulder at the opening end, so the column reads as an arch rather
  // than a pipe. Cut INTO the column — it never grows past the hitbox.
  const lipY = openingAbove ? y : y + h;
  ctx.fillStyle = PALETTE.gateLip;
  ctx.fillRect(Math.round(x), Math.round(openingAbove ? lipY : lipY - 3), GATE.width, 3);
  ctx.fillStyle = alpha(PALETTE.gateLip, 0.55);
  const inner = openingAbove ? lipY + 3 : lipY - 5;
  ctx.fillRect(Math.round(x + 2), Math.round(inner), GATE.width - 4, 2);
}

/** Cloud tower: same hitbox, softer read, unlocked later in a run. */
function drawTowerGate(
  ctx: CanvasRenderingContext2D,
  gate: Gate,
  x: number,
  centreY: number,
): void {
  const top = centreY - gate.gapHeight / 2;
  const bottom = centreY + gate.gapHeight / 2;
  drawTowerColumn(ctx, x, CEILING_Y, top - CEILING_Y, false);
  drawTowerColumn(ctx, x, bottom, FLOOR_Y - bottom, true);
}

/**
 * The town's gate: a brick gatehouse with battlements.
 *
 * Same hitbox as an arch, same white lip on the opening. The lip is
 * non-negotiable across every variant — it is how the player reads the gap, and
 * a themed gate that dropped it would be pretty and unfair.
 */
function drawGatehouse(
  ctx: CanvasRenderingContext2D,
  gate: Gate,
  x: number,
  centreY: number,
): void {
  const top = centreY - gate.gapHeight / 2;
  const bottom = centreY + gate.gapHeight / 2;
  drawBrickColumn(ctx, x, CEILING_Y, top - CEILING_Y, false);
  drawBrickColumn(ctx, x, bottom, FLOOR_Y - bottom, true);
}

function drawBrickColumn(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  openingAbove: boolean,
): void {
  if (h <= 0) return;
  const left = Math.round(x);
  const w = GATE.width;

  ctx.fillStyle = PALETTE.brick;
  ctx.fillRect(left, Math.round(y), w, Math.round(h));

  // Staggered courses. Drawn INSIDE the column, never past its edges.
  ctx.fillStyle = alpha(PALETTE.brickMortar, 0.45);
  for (let row = 0; row * 6 < h; row++) {
    const ry = Math.round(y + row * 6);
    ctx.fillRect(left, ry, w, 1);
    const stagger = row % 2 === 0 ? 0 : w / 2;
    ctx.fillRect(Math.round(left + stagger + w / 4), ry, 1, 6);
  }

  ctx.fillStyle = PALETTE.brickDark;
  ctx.fillRect(left, Math.round(y), 2, Math.round(h));

  // Battlements at the opening end — crenellations cut into the column, so the
  // silhouette says "castle" without any sprite crossing the hitbox line.
  const lipY = openingAbove ? y : y + h - 3;
  const notchY = openingAbove ? y + 3 : y + h - 9;
  ctx.fillStyle = PALETTE.brickDark;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(Math.round(left + 2 + i * 9), Math.round(notchY), 5, 6);
  }

  ctx.fillStyle = PALETTE.gateLip;
  ctx.fillRect(left, Math.round(lipY), w, 3);
}

function drawTowerColumn(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  openingAbove: boolean,
): void {
  if (h <= 0) return;
  // Solid core first, filling the hitbox exactly.
  ctx.fillStyle = PALETTE.gateTower;
  ctx.fillRect(Math.round(x), Math.round(y), GATE.width, Math.round(h));

  // Puffs INSIDE the column only — same trick the ceiling uses. A puff allowed
  // to bulge sideways would be a cloud you die to a pixel early.
  ctx.fillStyle = alpha(PALETTE.cloudFar, 0.9);
  for (let py = y + 2; py < y + h - 6; py += 12) {
    puff(ctx, Math.round(x + 1), Math.round(py), GATE.width - 4);
  }

  ctx.fillStyle = PALETTE.gateLip;
  const lipY = openingAbove ? y : y + h - 3;
  ctx.fillRect(Math.round(x), Math.round(lipY), GATE.width, 3);
}

// --- bombs ------------------------------------------------------------------

export function drawBombs(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  interpolation: number,
): void {
  for (const bomb of state.bombs.items) {
    if (!bomb.active) continue;
    const x = bomb.prevX + (bomb.x - bomb.prevX) * interpolation;
    const y = bomb.prevY + (bomb.y - bomb.prevY) * interpolation;
    if (bomb.deathTimer > 0) drawBlast(ctx, bomb, x, y);
    else drawBomb(ctx, x, y, state.elapsed, bomb.blocking);
  }
}

function drawBomb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  elapsed: number,
  blocking: boolean,
): void {
  const r = BOMB.width / 2;

  // A slow red pulse. Blocking bombs pulse harder because they're the ones you
  // actually have to answer — the tell should scale with the demand.
  const pulse = 0.18 + (Math.sin(elapsed * 5) + 1) * (blocking ? 0.14 : 0.07);
  ctx.fillStyle = alpha(PALETTE.bombWarn, pulse);
  ctx.beginPath();
  ctx.arc(x, y, r + 4, 0, Math.PI * 2);
  ctx.fill();

  // Stepped sphere: five rects read as round at this scale and stay crisp.
  ctx.fillStyle = PALETTE.bomb;
  ctx.fillRect(Math.round(x - r + 3), Math.round(y - r), BOMB.width - 6, BOMB.height);
  ctx.fillRect(Math.round(x - r), Math.round(y - r + 3), BOMB.width, BOMB.height - 6);
  ctx.fillRect(Math.round(x - r + 1), Math.round(y - r + 1), BOMB.width - 2, BOMB.height - 2);

  // Highlight, upper-left, so it reads as a solid ball rather than a hole.
  ctx.fillStyle = PALETTE.bombShade;
  ctx.fillRect(Math.round(x - r + 3), Math.round(y - r + 3), 4, 3);

  // Fuse, curving up and back.
  ctx.fillStyle = PALETTE.bombFuse;
  ctx.fillRect(Math.round(x + 1), Math.round(y - r - 3), 2, 4);
  ctx.fillRect(Math.round(x + 3), Math.round(y - r - 5), 2, 3);

  // Spark on a 2-frame flicker.
  if (Math.floor(elapsed * 12) % 2 === 0) {
    ctx.fillStyle = PALETTE.bombSpark;
    ctx.fillRect(Math.round(x + 4), Math.round(y - r - 7), 3, 3);
  }
}

function drawBlast(ctx: CanvasRenderingContext2D, bomb: Bomb, x: number, y: number): void {
  const t = 1 - bomb.deathTimer / BOMB.deathTime;
  const r = BOMB.width / 2 + t * 16;
  ctx.strokeStyle = alpha(PALETTE.bombSpark, 1 - t);
  ctx.lineWidth = 3 * (1 - t) + 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

// --- fairies and people -----------------------------------------------------

export function drawFairies(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  interpolation: number,
): void {
  for (const fairy of state.fairies.items) {
    if (!fairy.active) continue;
    const x = fairy.prevX + (fairy.x - fairy.prevX) * interpolation;
    const y = fairy.prevY + (fairy.y - fairy.prevY) * interpolation;
    if (fairy.deathTimer > 0) drawRescueSparkle(ctx, fairy, x, y);
    else if (fairy.kind === 'person') drawPerson(ctx, x, y, state.elapsed);
    else drawFairy(ctx, x, y, state.elapsed);
  }
}

/**
 * The halo, shared by both kinds — it's what says "this is a rescue".
 *
 * Three passes, not one. A single soft fill washes out completely against a
 * pale sky, which is fatal for the only object in the game you're supposed to
 * fly toward. The crisp amber ring is what actually does the work: an outline
 * survives any background, where a glow only survives a dark one.
 */
function drawHalo(ctx: CanvasRenderingContext2D, x: number, y: number, elapsed: number): void {
  const pulse = (Math.sin(elapsed * 4) + 1) * 0.5;
  const r = FAIRY.width / 2 + 5;

  ctx.fillStyle = alpha(PALETTE.fairyHalo, 0.2 + pulse * 0.12);
  ctx.beginPath();
  ctx.arc(x, y, r + 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = alpha(PALETTE.fairyHalo, 0.85);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = alpha(PALETTE.fairy, 0.75);
  ctx.beginPath();
  ctx.arc(x, y, r - 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawFairy(ctx: CanvasRenderingContext2D, x: number, y: number, elapsed: number): void {
  drawHalo(ctx, x, y, elapsed);

  // Wings on a fast 2-frame flap — much quicker than the unicorn's, so the two
  // never read as the same creature.
  const up = Math.floor(elapsed * 14) % 2 === 0;
  ctx.fillStyle = alpha(PALETTE.fairyWing, 0.95);
  ctx.fillRect(Math.round(x - 6), Math.round(y - (up ? 5 : 2)), 4, 5);
  ctx.fillRect(Math.round(x + 2), Math.round(y - (up ? 5 : 2)), 4, 5);

  // Amber body with a white-hot centre. The two-tone core is what reads as
  // "lit from inside" at 14px rather than as a pale smudge.
  ctx.fillStyle = PALETTE.fairyHalo;
  ctx.fillRect(Math.round(x - 2), Math.round(y - 4), 4, 7);
  ctx.fillStyle = PALETTE.fairy;
  ctx.fillRect(Math.round(x - 1), Math.round(y - 3), 2, 4);
  ctx.fillRect(Math.round(x - 1), Math.round(y - 6), 2, 2);

  // Sparkle trail.
  ctx.fillStyle = alpha(PALETTE.fairyHalo, 0.9);
  ctx.fillRect(Math.round(x - 10), Math.round(y - 1), 2, 2);
  ctx.fillRect(Math.round(x - 14), Math.round(y + 1), 1, 1);
}

/** A child on a small cloud, waving. Same box, same halo, different story. */
function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, elapsed: number): void {
  drawHalo(ctx, x, y, elapsed);

  ctx.fillStyle = PALETTE.cloudFar;
  ctx.fillRect(Math.round(x - 7), Math.round(y + 4), 14, 3);
  ctx.fillRect(Math.round(x - 5), Math.round(y + 3), 10, 2);

  ctx.fillStyle = PALETTE.personDress;
  ctx.fillRect(Math.round(x - 3), Math.round(y - 1), 6, 5);

  ctx.fillStyle = PALETTE.personSkin;
  ctx.fillRect(Math.round(x - 2), Math.round(y - 5), 4, 4);

  // The waving arm — the read that says "help me", on a slow 2-frame cycle.
  const wave = Math.floor(elapsed * 6) % 2 === 0 ? -3 : -5;
  ctx.fillRect(Math.round(x + 3), Math.round(y + wave), 2, 3);
}

function drawRescueSparkle(
  ctx: CanvasRenderingContext2D,
  fairy: Fairy,
  x: number,
  y: number,
): void {
  const t = 1 - fairy.deathTimer / FAIRY.deathTime;
  ctx.fillStyle = alpha(PALETTE.fairyHalo, 1 - t);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const r = 4 + t * 18;
    ctx.fillRect(Math.round(x + Math.cos(angle) * r), Math.round(y + Math.sin(angle) * r - t * 8), 2, 2);
  }
}

// --- magic ------------------------------------------------------------------

export function drawShots(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  interpolation: number,
): void {
  for (const shot of state.shots.shots) {
    if (!shot.active) continue;
    const x = shot.prevX + (shot.x - shot.prevX) * interpolation;
    const y = shot.y;

    // A four-point sparkle rather than a bullet. It's magic, and it should not
    // look like ordnance in a game about rescuing people.
    ctx.fillStyle = alpha(PALETTE.shot, 0.55);
    ctx.fillRect(Math.round(x - 3), Math.round(y + 1), SHOT.width + 4, SHOT.height - 2);

    ctx.fillStyle = PALETTE.shot;
    ctx.fillRect(Math.round(x), Math.round(y + 1), SHOT.width, SHOT.height - 2);
    ctx.fillRect(Math.round(x + 3), Math.round(y - 1), SHOT.width - 6, SHOT.height + 2);

    ctx.fillStyle = PALETTE.shotCore;
    ctx.fillRect(Math.round(x + 4), Math.round(y + 1), 3, 2);
  }
}

