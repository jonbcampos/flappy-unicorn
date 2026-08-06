import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  SCREEN,
  VIRTUAL_H,
  type DifficultyId,
} from '../game/config';
import type { GameState } from '../game/state';
import { PALETTE, alpha } from '../render/palette';
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

/** Sound toggle, bottom-left of the title screen. */
export function muteButton(): { x: number; y: number; w: number; h: number } {
  return { x: 10, y: VIRTUAL_H - 24, w: 62, h: 16 };
}

/**
 * Mirror of the audio mute flag, for drawing.
 *
 * Pushed in rather than read from storage each frame — this is drawn 60 times a
 * second and localStorage reads are synchronous.
 */
let mutedForDisplay = false;
export function setMutedDisplay(muted: boolean): void {
  mutedForDisplay = muted;
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
  ctx.fillStyle = alpha(PALETTE.scrim, 0.62);
  ctx.fillRect(0, 0, SCREEN.w, VIRTUAL_H);

  drawText(ctx, 'FLAPPY', SCREEN.w / 2, 28, {
    size: 14,
    color: PALETTE.hudAccent,
    align: 'center',
    glow: true,
  });
  drawText(ctx, 'UNICORN', SCREEN.w / 2, 50, {
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

  const mute = muteButton();
  ctx.strokeStyle = alpha('#ffffff', 0.6);
  ctx.lineWidth = 1;
  ctx.strokeRect(mute.x + 0.5, mute.y + 0.5, mute.w - 1, mute.h - 1);
  drawText(
    ctx,
    mutedForDisplay ? 'SOUND OFF' : 'SOUND ON',
    mute.x + mute.w / 2,
    mute.y + mute.h / 2,
    { size: 8, color: mutedForDisplay ? '#c9b3d6' : PALETTE.fairyHalo, align: 'center' },
  );

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
  ctx.fillStyle = alpha(PALETTE.scrim, 0.72);
  ctx.fillRect(0, 0, SCREEN.w, VIRTUAL_H);

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
}

function drawMenuButton(ctx: CanvasRenderingContext2D, rect: MenuRect, color: string): void {
  ctx.fillStyle = alpha(color, 0.14);
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
