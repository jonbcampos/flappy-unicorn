import type { Aabb } from '../game/collision';
import { BOMB, CEILING_Y, FAIRY, FLOOR_Y, GATE, LOOK, SHOT, UNICORN } from '../game/config';
import type { Bomb } from '../game/bombs';
import type { Fairy, FairyKind } from '../game/fairies';
import type { Gate } from '../game/gates';
import type { GameState } from '../game/state';
import { PALETTE, alpha } from './palette';
import { puff } from './sky';
import { frameBounds, spriteFrames, sprite, type ContentBox } from './sprites';

/**
 * Everything in the play field, drawn.
 *
 * Procedural canvas rectangles and arcs, with generated paintings layered on
 * top when they've loaded (DECISIONS.md 25-27). Every painted path falls back
 * to the procedural one, so the game is complete with no images at all.
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
/** Pose timers, seeded by events in main.ts: the art shows what just happened. */
let zapTimer = 0;
let oopsTimer = 0;
let cheerTimer = 0;
/** Squash-and-stretch: a damped spring, kicked by every flap. */
let squash = 0;
let squashVel = 0;

const WING_TIME = 0.26;

export function onFlap(): void {
  wingTimer = WING_TIME;
  // Stretch tall and thin on the push, then the spring overshoots into a
  // little squash and settles. The single biggest "alive" cue per pixel.
  squash = LOOK.squashKick;
  squashVel = 0;
}

export function onZap(): void {
  zapTimer = 0.22;
}

export function onOops(): void {
  oopsTimer = 0.65;
  squash = -LOOK.squashKick;
  squashVel = 0;
}

export function onCheer(): void {
  cheerTimer = 0.6;
}

export function updateUnicornAnim(dt: number): void {
  wingPhase += dt;
  if (wingTimer > 0) wingTimer = Math.max(0, wingTimer - dt);
  zapTimer = Math.max(0, zapTimer - dt);
  oopsTimer = Math.max(0, oopsTimer - dt);
  cheerTimer = Math.max(0, cheerTimer - dt);
  const accel = -LOOK.squashSpring * squash - LOOK.squashDamping * squashVel;
  squashVel += accel * dt;
  squash += squashVel * dt;
}

export function resetUnicornAnim(): void {
  wingTimer = 0;
  wingPhase = 0;
  zapTimer = 0;
  oopsTimer = 0;
  cheerTimer = 0;
  squash = 0;
  squashVel = 0;
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
  player.bounds(scratch, interpolation);
  const cx = scratch.x + scratch.w / 2;
  const cy = scratch.y + scratch.h / 2;

  const fly = spriteFrames('unicorn.fly');
  const poses = spriteFrames('unicorn.pose');
  const art = fly && fly.length >= 4 && poses && poses.length >= 4;

  // Blink through i-frames, so the player knows they're safe. The painted
  // unicorn fades rather than vanishes: a picture of Ellie flickering out of
  // existence reads as something bad happening to her.
  const blink = !player.dead && player.invulnerable && Math.floor(state.elapsed * 20) % 2 === 0;
  if (blink && !art) return;

  drawTrail(ctx, cx, cy, art ? 10 : 0);

  if (art) {
    ctx.save();
    if (blink) ctx.globalAlpha = 0.35;
    drawUnicornArt(ctx, fly, poses, cx, cy, player.dead ? state.elapsed * 6 : player.tilt, player.dead, state.phase === 'ready');
    ctx.restore();
    return;
  }

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

/**
 * The painted unicorn, frame chosen from game state:
 * dizzy when the run is over, "oops" right after a bump, the zap pose as magic
 * leaves the horn, a cheer after a rescue, the wing cycle once per flap, and a
 * glide in between. Placed so its barrel sits on the hurtbox centre.
 */
function drawUnicornArt(
  ctx: CanvasRenderingContext2D,
  fly: readonly HTMLCanvasElement[],
  poses: readonly HTMLCanvasElement[],
  cx: number,
  cy: number,
  tilt: number,
  dead: boolean,
  hovering: boolean,
): void {
  let frame: HTMLCanvasElement;
  if (dead) frame = poses[3]!;
  else if (oopsTimer > 0) frame = poses[1]!;
  else if (zapTimer > 0) frame = poses[0]!;
  else if (cheerTimer > 0) frame = poses[2]!;
  else if (wingTimer > 0) {
    const t = 1 - wingTimer / WING_TIME;
    frame = fly[[1, 2, 3, 0][Math.min(3, Math.floor(t * 4))]!]!;
  } else if (hovering) {
    // A lazy, slow flap while waiting to start, so the screen is alive.
    frame = fly[[0, 1, 2, 3][Math.floor(wingPhase * 5) % 4]!]!;
  } else frame = fly[0]!;

  // Every frame shares the first frame's registration (sliceSheet lines them
  // up), so measuring once keeps the body from hopping between poses.
  const ref = frameBounds(fly[0]!);
  const s = LOOK.unicornArtWidth / ref.w;
  const ax = ref.x + ref.w * LOOK.unicornBodyX;
  const ay = ref.y + ref.h * LOOK.unicornBodyY;
  const stretch = Math.max(-0.3, Math.min(0.3, squash));

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.scale(1 - stretch * 0.7, 1 + stretch);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(frame, -ax * s, -ay * s, frame.width * s, frame.height * s);
  ctx.restore();
}

/** Four fading rainbow segments behind the body. */
function drawTrail(ctx: CanvasRenderingContext2D, cx: number, cy: number, back: number): void {
  pushTrail(cx, cy);
  if (trailCount < 4) return;
  for (let i = 1; i <= 4; i++) {
    const index = (trailCursor - 1 - i * 2 + TRAIL_LENGTH * 2) % TRAIL_LENGTH;
    if (i * 2 >= trailCount) break;
    const fade = 0.34 * (1 - i / 5);
    ctx.fillStyle = alpha(PALETTE.gateBand[i % PALETTE.gateBand.length]!, fade);
    ctx.fillRect(Math.round(trailX[index]! - 12 - back - i * 3), Math.round(trailY[index]! - 2), 8, 4);
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
    const art = sprite(gate.variant === 'tower' ? 'gate.tower' : gate.variant === 'gatehouse' ? 'gate.brick' : 'gate.arch');
    if (art) drawPaintedGate(ctx, art, gate, x, centreY);
    else if (gate.variant === 'tower') drawTowerGate(ctx, gate, x, centreY);
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
 * A painted gate: the pillar art as a TEXTURE, clipped to the exact column box.
 *
 * ART-PLAN.md F1. The cap sits at the opening end, the middle is tiled (every
 * other copy mirrored, so the seam hides), and the whole thing is clipped to
 * the hitbox rectangle, so no painted pixel can be wider or longer than the
 * column that collides. The lip goes on top, procedurally, exactly as on every
 * other gate: it is the instruction, and art never gets to move it.
 */
function drawPaintedGate(
  ctx: CanvasRenderingContext2D,
  art: HTMLCanvasElement,
  gate: Gate,
  x: number,
  centreY: number,
): void {
  const top = centreY - gate.gapHeight / 2;
  const bottom = centreY + gate.gapHeight / 2;
  const pillar = measurePillar(art);
  drawPillar(ctx, art, pillar, x, CEILING_Y, top - CEILING_Y, false);
  drawPillar(ctx, art, pillar, x, bottom, FLOOR_Y - bottom, true);
  drawEdges(ctx, x, CEILING_Y, top - CEILING_Y);
  drawEdges(ctx, x, bottom, FLOOR_Y - bottom);
  drawLip(ctx, x, CEILING_Y, top - CEILING_Y, false);
  drawLip(ctx, x, bottom, FLOOR_Y - bottom, true);
}

/**
 * A crisp dark line down each side of a painted column, inside the box. The
 * painting's own outline is soft at this size, and a pale sandstone column in
 * front of pale cottages has to stand out as the thing that matters.
 */
function drawEdges(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  if (h <= 0) return;
  ctx.fillStyle = alpha(PALETTE.hudText, 0.55);
  ctx.fillRect(Math.round(x), Math.round(y), 1, Math.round(h));
  ctx.fillRect(Math.round(x + GATE.width - 1), Math.round(y), 1, Math.round(h));
}

interface Pillar {
  /** Left edge and width of the straight shaft, in source pixels. */
  shaftL: number;
  shaftW: number;
  /** Top of the cap and its height. */
  top: number;
  capH: number;
  /** The slice of shaft that tiles. */
  bodyY: number;
  bodyH: number;
}

const pillars = new WeakMap<HTMLCanvasElement, Pillar>();

/**
 * Find the shaft in a pillar picture: measured, not assumed, because the model
 * draws the column wherever it likes and the cap wider than the shaft. The
 * SHAFT is what's fitted to the column's 26px; the wider cap is then clipped.
 */
function measurePillar(art: HTMLCanvasElement): Pillar {
  const cached = pillars.get(art);
  if (cached) return cached;
  const box: ContentBox = frameBounds(art);
  let pillar: Pillar = {
    shaftL: box.x, shaftW: box.w, top: box.y, capH: box.h * 0.2,
    bodyY: box.y + box.h * 0.4, bodyH: box.h * 0.4,
  };
  const ctx = art.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    try {
      const data = ctx.getImageData(0, 0, art.width, art.height).data;
      const span = (y: number): [number, number] => {
        let l = -1;
        let r = -1;
        for (let x = 0; x < art.width; x++) {
          if (data[(y * art.width + x) * 4 + 3]! > 160) {
            if (l < 0) l = x;
            r = x;
          }
        }
        return [l, r];
      };
      const [l, r] = span(Math.floor(box.y + box.h * 0.65));
      if (l >= 0 && r > l) {
        const shaftW = r - l + 1;
        let capEnd = box.y + Math.floor(box.h * 0.05);
        for (let y = capEnd; y < box.y + box.h * 0.5; y++) {
          const [a, b] = span(y);
          if (a >= 0 && b - a + 1 <= shaftW * 1.04) {
            capEnd = y;
            break;
          }
        }
        const capH = Math.max(4, capEnd - box.y + 2);
        const bodyY = box.y + capH + (box.h - capH) * 0.15;
        pillar = { shaftL: l, shaftW, top: box.y, capH, bodyY, bodyH: (box.h - capH) * 0.6 };
      }
    } catch {
      // Unreadable: the rough guess above still draws a sensible pillar.
    }
  }
  pillars.set(art, pillar);
  return pillar;
}

function drawPillar(
  ctx: CanvasRenderingContext2D,
  art: HTMLCanvasElement,
  p: Pillar,
  x: number,
  y: number,
  h: number,
  openingAbove: boolean,
): void {
  if (h <= 0) return;
  const s = GATE.width / p.shaftW;
  const left = x - p.shaftL * s;
  const w = art.width * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, GATE.width, h);
  ctx.clip();
  // The art is drawn with its cap at the top; a column hanging from the
  // ceiling has its opening at the BOTTOM, so it's flipped about itself.
  if (!openingAbove) {
    ctx.translate(0, y + h);
    ctx.scale(1, -1);
    ctx.translate(0, -y);
  }
  ctx.imageSmoothingEnabled = true;
  const capH = p.capH * s;
  const bodyH = p.bodyH * s;
  let yy = y + capH - 0.5;
  for (let k = 0; yy < y + h; k++) {
    if (k % 2 === 1) {
      ctx.save();
      ctx.translate(0, yy + bodyH / 2);
      ctx.scale(1, -1);
      ctx.drawImage(art, 0, p.bodyY, art.width, p.bodyH, left, -bodyH / 2, w, bodyH);
      ctx.restore();
    } else {
      ctx.drawImage(art, 0, p.bodyY, art.width, p.bodyH, left, yy, w, bodyH);
    }
    yy += bodyH - 0.5;
  }
  ctx.drawImage(art, 0, p.top, art.width, p.capH, left, y, w, capH);
  ctx.restore();
}

/** The lip, exactly on the hitbox boundary at the opening end. */
function drawLip(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, openingAbove: boolean): void {
  if (h <= 0) return;
  const lipY = openingAbove ? y : y + h;
  ctx.fillStyle = PALETTE.gateLip;
  ctx.fillRect(Math.round(x), Math.round(openingAbove ? lipY : lipY - 3), GATE.width, 3);
  ctx.fillStyle = alpha(PALETTE.gateLip, 0.45);
  ctx.fillRect(Math.round(x + 2), Math.round(openingAbove ? lipY + 3 : lipY - 5), GATE.width - 4, 2);
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
    const fuse = spriteFrames('bomb.fuse');
    if (bomb.deathTimer > 0) {
      // With art, the fizzle flipbook (a particle, spawned by main.ts) plays
      // instead; the procedural ring stays for the art-less game.
      if (!fuse) drawBlast(ctx, bomb, x, y);
    } else if (fuse && fuse.length > 0) drawPaintedBomb(ctx, fuse, x, y, state.elapsed + bomb.phase, bomb.blocking);
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

interface Ball {
  cx: number;
  cy: number;
  d: number;
}
const balls = new WeakMap<HTMLCanvasElement, Ball>();

/**
 * Where the round part of a painted bomb is: the widest row in the lower part
 * of the picture. The fuse and spark stick out above and to the side, and the
 * BALL is what has to match the bomb's 18px box (ART-PLAN.md F2): a sprite may
 * be smaller than its hitbox, never larger.
 */
function measureBall(frame: HTMLCanvasElement): Ball {
  const cached = balls.get(frame);
  if (cached) return cached;
  const box = frameBounds(frame);
  let ball: Ball = { cx: box.x + box.w * 0.45, cy: box.y + box.h * 0.6, d: box.w * 0.85 };
  const ctx = frame.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    try {
      const data = ctx.getImageData(0, 0, frame.width, frame.height).data;
      let best = 0;
      let bestL = 0;
      for (let y = Math.floor(box.y + box.h * 0.4); y < box.y + box.h; y++) {
        let l = -1;
        let r = -1;
        for (let x = 0; x < frame.width; x++) {
          if (data[(y * frame.width + x) * 4 + 3]! > 160) {
            if (l < 0) l = x;
            r = x;
          }
        }
        if (l >= 0 && r - l > best) {
          best = r - l;
          bestL = l;
        }
      }
      if (best > 0) ball = { cx: bestL + best / 2, cy: box.y + box.h - best / 2, d: best };
    } catch {
      // Keep the estimate.
    }
  }
  balls.set(frame, ball);
  return ball;
}

function drawPaintedBomb(
  ctx: CanvasRenderingContext2D,
  fuse: readonly HTMLCanvasElement[],
  x: number,
  y: number,
  elapsed: number,
  blocking: boolean,
): void {
  const r = BOMB.width / 2;
  // The red pulse stays procedural: "dark, fused, pulsing red" is the read,
  // and it must survive any painting.
  const pulse = 0.2 + (Math.sin(elapsed * 5) + 1) * (blocking ? 0.16 : 0.08);
  ctx.fillStyle = alpha(PALETTE.bombWarn, pulse);
  ctx.beginPath();
  ctx.arc(x, y, r + 4 + Math.sin(elapsed * 5) * 1.2, 0, Math.PI * 2);
  ctx.fill();

  const frame = fuse[Math.floor(elapsed * 9) % fuse.length]!;
  const ball = measureBall(fuse[0]!);
  const s = BOMB.width / ball.d;
  // A grumpy little wobble, so it looks alive and cross rather than parked.
  const wobble = Math.sin(elapsed * 7) * 0.08;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(wobble);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(frame, -ball.cx * s, -ball.cy * s, frame.width * s, frame.height * s);
  ctx.restore();
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
    else if (!drawPaintedRescue(ctx, fairy.kind, x, y, state.elapsed + fairy.phase)) {
      if (fairy.kind === 'person') drawPerson(ctx, x, y, state.elapsed);
      else drawFairy(ctx, x, y, state.elapsed);
    }
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

/**
 * A painted fairy or kid, over the procedural halo. Returns false if there's no
 * art, so the caller draws the procedural one. The halo ring is kept: it's the
 * "this is a rescue" read, and it must not depend on a painting.
 *
 * The fairy flutters fast (two wing frames) and now and then cups her hands to
 * call for help; the kid waves slowly and now and then reaches up.
 */
function drawPaintedRescue(ctx: CanvasRenderingContext2D, kind: FairyKind, x: number, y: number, t: number): boolean {
  const person = kind === 'person';
  const idle = spriteFrames(person ? 'kid.wave' : 'fairy.fly');
  const extra = spriteFrames(person ? 'kid.saved' : 'fairy.saved');
  if (!idle || idle.length < 2) return false;
  drawHalo(ctx, x, y, t);
  const calling = extra && extra.length > 0 && t % 3.2 < 0.7;
  const frame = calling ? extra[0]! : idle[Math.floor(t * (person ? 3 : 9)) % idle.length]!;
  const ref = frameBounds(idle[0]!);
  const s = (person ? LOOK.kidArtHeight : LOOK.fairyArtHeight) / ref.h;
  const ax = ref.x + ref.w / 2;
  const ay = ref.y + ref.h / 2;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(frame, x - ax * s, y - ay * s, frame.width * s, frame.height * s);
  ctx.restore();
  return true;
}

/** The cheering frame for a rescue, for the particle that floats up. Null without art. */
export function rescueCheerFrame(kind: FairyKind): HTMLCanvasElement | null {
  const saved = spriteFrames(kind === 'person' ? 'kid.saved' : 'fairy.saved');
  return saved && saved.length > 1 ? saved[1]! : null;
}

/** The painted fizzle flipbook for a zapped bomb, or null. */
export function bombFizzleFrames(): readonly HTMLCanvasElement[] | null {
  return spriteFrames('bomb.fizzle');
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

