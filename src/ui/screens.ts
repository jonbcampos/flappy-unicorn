import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  LOOK,
  SCREEN,
  VIRTUAL_H,
  type DifficultyId,
} from '../game/config';
import type { GameState, Phase } from '../game/state';
import { PALETTE, alpha } from '../render/palette';
import { drawStar } from '../render/particles';
import { frameBounds, sprite, spriteFrames } from '../render/sprites';
import { drawText } from './text';

export interface MenuRect {
  id: DifficultyId | 'restart' | 'menu';
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
}

/**
 * Menu hit regions, defined once and used by both the renderer and the input
 * router in main.ts. Deriving both from the same list means a button can never
 * end up drawn somewhere other than where it's tappable.
 */
export function titleMenu(): MenuRect[] {
  const w = 152;
  const h = 30;
  const gap = 9;
  const totalH = DIFFICULTY_ORDER.length * h + (DIFFICULTY_ORDER.length - 1) * gap;
  const startY = VIRTUAL_H / 2 - totalH / 2 + 24;

  return DIFFICULTY_ORDER.map((id, i) => ({
    id,
    label: DIFFICULTIES[id].label,
    sub: describe(id),
    x: SCREEN.w / 2 - w / 2,
    y: startY + i * (h + gap),
    w,
    h,
  }));
}

/**
 * What a difficulty actually changes, spelled out on its button.
 *
 * A parent picking a mode for a small child should be able to see "three
 * hearts, wide gaps, the roof is safe" without playing it first. A name and a
 * number don't communicate that, and the difference between these modes is
 * mostly forgiveness rather than speed.
 */
function describe(id: DifficultyId): string {
  const d = DIFFICULTIES[id];
  const parts = [`${d.hearts}♥`, `${d.gapHeight}px GAP`];
  if (d.ceilingIsSafe) parts.push('SOFT ROOF');
  return parts.join('  ·  ');
}

export function gameOverMenu(): MenuRect[] {
  const w = 96;
  const h = 28;
  return [
    { id: 'restart', label: 'RETRY', x: SCREEN.w / 2 - w - 6, y: VIRTUAL_H / 2 + 32, w, h },
    { id: 'menu', label: 'MENU', x: SCREEN.w / 2 + 6, y: VIRTUAL_H / 2 + 32, w, h },
  ];
}

/** Sound toggle, bottom-left of the title and game-over screens. */
export function muteButton(): { x: number; y: number; w: number; h: number } {
  return { x: 10, y: VIRTUAL_H - 24, w: 62, h: 16 };
}

/** Music toggle, beside it. Separate, because a parent may want one and not the other. */
export function musicButton(): { x: number; y: number; w: number; h: number } {
  return { x: 80, y: VIRTUAL_H - 24, w: 62, h: 16 };
}

/**
 * Mirror of the audio mute flag, for drawing.
 *
 * Pushed in rather than read from storage each frame — this is drawn 60 times a
 * second and localStorage reads are synchronous.
 */
let mutedForDisplay = false;
let musicMutedForDisplay = false;
export function setMutedDisplay(muted: boolean, musicMuted = musicMutedForDisplay): void {
  mutedForDisplay = muted;
  musicMutedForDisplay = musicMuted;
}

// --- transitions --------------------------------------------------------------

/**
 * How long the current phase has been showing, render-side, so screens can
 * fade in rather than cut. The simulation switches phase in one tick; the
 * picture eases across it.
 */
let shownPhase: Phase = 'title';
let phaseAge = 0;
let clock = 0;
/** A brief full-screen colour wash: pink on a bump. */
let flash = 0;
let flashColor = '#ffffff';

export function updateScreens(dt: number, phase: Phase): void {
  clock += dt;
  if (phase !== shownPhase) {
    shownPhase = phase;
    phaseAge = 0;
  } else phaseAge += dt;
  flash = Math.max(0, flash - dt * 4);
}

export function flashScreen(color: string, amount = 0.35): void {
  flashColor = color;
  flash = Math.max(flash, amount);
}

/** The render clock in seconds, for anything that drifts on its own. */
export function screenClock(): number {
  return clock;
}

export function hitTestMenu(rects: readonly MenuRect[], x: number, y: number): MenuRect | null {
  // Generous padding — menu taps are less precise than game inputs and there's
  // no cost to being forgiving here.
  const pad = 6;
  for (const rect of rects) {
    if (
      x >= rect.x - pad && x <= rect.x + rect.w + pad &&
      y >= rect.y - pad && y <= rect.y + rect.h + pad
    ) {
      return rect;
    }
  }
  return null;
}

export function hitTestBox(
  box: { x: number; y: number; w: number; h: number },
  x: number,
  y: number,
): boolean {
  return x >= box.x - 8 && x <= box.x + box.w + 8 && y >= box.y - 8 && y <= box.y + box.h + 8;
}

export function drawScreens(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (state.phase === 'title') drawTitle(ctx, state);
  else if (state.phase === 'ready') drawReady(ctx, state);
  else if (state.phase === 'gameover') drawGameOver(ctx, state);

  // Fade in from white as a run begins: the title doesn't cut to the world,
  // it opens onto it.
  if (state.phase === 'ready' && phaseAge < LOOK.startFade) {
    const t = phaseAge / LOOK.startFade;
    ctx.fillStyle = alpha('#fff4fa', 1 - t * t);
    ctx.fillRect(0, 0, SCREEN.w, VIRTUAL_H);
  }
  if (flash > 0) {
    ctx.fillStyle = alpha(flashColor, flash);
    ctx.fillRect(0, 0, SCREEN.w, VIRTUAL_H);
  }
}

/** Sound and music toggles, drawn the same way on every menu. */
function drawToggles(ctx: CanvasRenderingContext2D): void {
  for (const [box, off, on, offLabel] of [
    [muteButton(), mutedForDisplay, 'SOUND ON', 'SOUND OFF'],
    [musicButton(), musicMutedForDisplay, 'MUSIC ON', 'MUSIC OFF'],
  ] as const) {
    ctx.fillStyle = alpha(PALETTE.scrim, 0.45);
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = alpha('#ffffff', 0.6);
    ctx.lineWidth = 1;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    drawText(ctx, off ? offLabel : on, box.x + box.w / 2, box.y + box.h / 2, {
      size: 8,
      color: off ? '#c9b3d6' : PALETTE.fairyHalo,
      align: 'center',
    });
  }
}

/**
 * The cast on the title: Ellie on her unicorn swooping on the left, and the
 * ones she saves bobbing on the right, from their own sheets so they're the
 * same characters as in the game. Nothing without the art.
 */
function drawTitleCast(ctx: CanvasRenderingContext2D): void {
  const fly = spriteFrames('unicorn.fly');
  if (fly && fly.length >= 4) {
    const frame = fly[Math.floor(clock * 7) % 4]!;
    const ref = frameBounds(fly[0]!);
    const w = 96;
    const s = w / ref.w;
    const x = SCREEN.w * 0.17 + Math.sin(clock * 0.9) * 8;
    const y = VIRTUAL_H * 0.5 + Math.sin(clock * 1.8) * 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(clock * 1.8 + 1) * 0.06);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(frame, -(ref.x + ref.w / 2) * s, -(ref.y + ref.h / 2) * s, frame.width * s, frame.height * s);
    ctx.restore();
    // A sparkle trail behind her.
    for (let i = 0; i < 6; i++) {
      const t = (clock * 1.3 + i / 6) % 1;
      drawStar(ctx, x - 40 - t * 70, y + 10 + Math.sin((t + i) * 6) * 8, 3.5 * (1 - t), i % 2 ? '#ffffff' : PALETTE.shot, 1 - t);
    }
  }
  const cast: [string, number, number, number][] = [
    ['fairy.fly', 0.83, 0.42, 34],
    ['kid.wave', 0.88, 0.66, 34],
  ];
  for (const [id, fx, fy, h] of cast) {
    const frames = spriteFrames(id);
    if (!frames || frames.length === 0) continue;
    const frame = frames[Math.floor(clock * (id === 'fairy.fly' ? 9 : 3)) % frames.length]!;
    const ref = frameBounds(frames[0]!);
    const s = h / ref.h;
    const x = SCREEN.w * fx;
    const y = VIRTUAL_H * fy + Math.sin(clock * 2 + fx * 10) * 4;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(frame, x - (ref.x + ref.w / 2) * s, y - (ref.y + ref.h / 2) * s, frame.width * s, frame.height * s);
    ctx.restore();
  }
}

/**
 * The pre-run prompt.
 *
 * No scrim: the point of the hover is to let the player look at the world they
 * are about to fly through, and dimming it would defeat that. Just a pulsing
 * line of text, well clear of the unicorn.
 */
function drawReady(ctx: CanvasRenderingContext2D, state: GameState): void {
  const pulse = 0.65 + (Math.sin(state.readyTime * 5) + 1) * 0.175;

  // Dark text, not white. Everything behind it here is pale — sky, cloud,
  // meadow — and `glow` only stacks the same colour, so a white prompt on a
  // white-ish sky stays low-contrast no matter how bright it pulses.
  drawText(ctx, 'PRESS  FLY  TO  START', SCREEN.w / 2, VIRTUAL_H / 2 - 46, {
    size: 13,
    color: alpha(PALETTE.hudText, pulse),
    align: 'center',
  });
  drawText(
    ctx,
    `${state.difficulty.label}  ·  ${state.difficulty.hearts}♥`,
    SCREEN.w / 2,
    VIRTUAL_H / 2 - 28,
    { size: 8, color: alpha(PALETTE.hudText, 0.7), align: 'center' },
  );
}

function drawTitle(ctx: CanvasRenderingContext2D, state: GameState): void {
  const picture = sprite('title');
  if (picture) {
    // The painted cover, slowly breathing in, behind a light scrim: the
    // picture is the invitation, so it stays bright.
    const zoom = 1.04 + Math.sin(clock * 0.25) * 0.02;
    const scale = Math.max(SCREEN.w / picture.width, VIRTUAL_H / picture.height) * zoom;
    const w = picture.width * scale;
    const h = picture.height * scale;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(picture, (SCREEN.w - w) / 2, (VIRTUAL_H - h) / 2, w, h);
    ctx.restore();
    const scrim = ctx.createLinearGradient(0, 0, 0, VIRTUAL_H);
    scrim.addColorStop(0, alpha(PALETTE.scrim, 0.45));
    scrim.addColorStop(0.35, alpha(PALETTE.scrim, 0.22));
    scrim.addColorStop(1, alpha(PALETTE.scrim, 0.4));
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, SCREEN.w, VIRTUAL_H);
    drawTitleCast(ctx);
  } else {
    ctx.fillStyle = alpha(PALETTE.scrim, 0.62);
    ctx.fillRect(0, 0, SCREEN.w, VIRTUAL_H);
  }

  // A soft drop shadow behind the title: the pink would vanish into a pink sky.
  const bob = picture ? Math.sin(clock * 1.6) * 1.5 : 0;
  drawText(ctx, 'FLAPPY', SCREEN.w / 2, 30 + bob, { size: 14, color: PALETTE.scrim, align: 'center' });
  drawText(ctx, 'UNICORN', SCREEN.w / 2, 52 + bob, { size: 28, color: PALETTE.scrim, align: 'center' });
  drawText(ctx, 'FLAPPY', SCREEN.w / 2, 28 + bob, {
    size: 14,
    color: PALETTE.hudAccent,
    align: 'center',
    glow: true,
  });
  drawText(ctx, 'UNICORN', SCREEN.w / 2, 50 + bob, {
    size: 28,
    color: PALETTE.player,
    align: 'center',
    glow: true,
  });
  drawText(ctx, 'FLY  ·  ZAP BOMBS  ·  SAVE FAIRIES', SCREEN.w / 2, 68, {
    size: 9,
    color: '#ffffff',
    align: 'center',
  });

  for (const rect of titleMenu()) drawMenuButton(ctx, rect, PALETTE.player);

  if (state.best > 0) {
    drawText(ctx, `BEST  ${state.best}`, SCREEN.w / 2, VIRTUAL_H - 16, {
      size: 9,
      color: '#ffffff',
      align: 'center',
    });
  }

  drawToggles(ctx);

  // In portrait the game is drawn sideways to fill the screen, which only makes
  // sense once you turn the phone. Say so, and say which way — the rotation
  // direction is fixed, so guessing wrong means playing upside down.
  if (SCREEN.rotated) {
    drawText(ctx, '↺  TURN YOUR PHONE LEFT', SCREEN.w / 2, VIRTUAL_H - 34, {
      size: 10,
      color: PALETTE.shot,
      align: 'center',
      glow: true,
    });
  }
}

function drawGameOver(ctx: CanvasRenderingContext2D, state: GameState): void {
  // Eased in, and the card drops gently into place, so the end of a run is a
  // soft landing rather than a slammed door.
  const t = Math.min(1, phaseAge / LOOK.gameOverFade);
  const ease = 1 - (1 - t) * (1 - t);
  ctx.fillStyle = alpha(PALETTE.scrim, 0.66 * ease);
  ctx.fillRect(0, 0, SCREEN.w, VIRTUAL_H);
  ctx.save();
  ctx.globalAlpha = ease;
  ctx.translate(0, (1 - ease) * -14);

  const isBest = state.score >= state.best && state.score > 0;

  drawText(ctx, 'OH NO!', SCREEN.w / 2, VIRTUAL_H / 2 - 48, {
    size: 20,
    color: PALETTE.hudAccent,
    align: 'center',
    glow: true,
  });
  drawText(ctx, String(state.score), SCREEN.w / 2, VIRTUAL_H / 2 - 18, {
    size: 30,
    color: '#ffffff',
    align: 'center',
    glow: true,
  });
  drawText(ctx, `${state.gatesPassed} GATES`, SCREEN.w / 2, VIRTUAL_H / 2 + 4, {
    size: 9,
    color: '#ffffff',
    align: 'center',
  });
  drawText(
    ctx,
    isBest ? 'NEW BEST!' : `BEST  ${state.best}`,
    SCREEN.w / 2,
    VIRTUAL_H / 2 + 18,
    { size: 9, color: isBest ? PALETTE.fairyHalo : '#c9b3d6', align: 'center' },
  );

  for (const rect of gameOverMenu()) {
    drawMenuButton(ctx, rect, rect.id === 'restart' ? PALETTE.player : '#c9b3d6');
  }
  ctx.restore();
  drawToggles(ctx);
}

function drawMenuButton(ctx: CanvasRenderingContext2D, rect: MenuRect, color: string): void {
  // A dark plate under the tint, so white text reads over a bright painting.
  ctx.fillStyle = alpha(PALETTE.scrim, 0.55);
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = alpha(color, 0.18);
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = alpha(color, 0.85);
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

  const hasSub = Boolean(rect.sub);
  drawText(ctx, rect.label, rect.x + rect.w / 2, rect.y + rect.h / 2 - (hasSub ? 5 : 0), {
    size: 12,
    color: '#ffffff',
    align: 'center',
  });
  if (rect.sub) {
    drawText(ctx, rect.sub, rect.x + rect.w / 2, rect.y + rect.h / 2 + 8, {
      size: 7,
      color: alpha('#ffffff', 0.75),
      align: 'center',
    });
  }
}
