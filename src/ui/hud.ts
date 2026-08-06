import { CEILING_Y, JUICE, SCREEN, UNICORN, VIRTUAL_H } from '../game/config';
import type { GameState } from '../game/state';
import { PALETTE, alpha } from '../render/palette';
import { drawText } from './text';

/**
 * Score, hearts, and the sector banner.
 *
 * Everything lives in the 24px strip above CEILING_Y, which is why that strip
 * exists. A HUD drawn over the play field either hides a gate or gets ignored,
 * and both are worse than giving up the pixels.
 *
 * Score popups are held here rather than in GameState for the same reason the
 * wingbeat is: nothing in the simulation reads them.
 */

interface Popup {
  x: number;
  y: number;
  value: number;
  life: number;
  active: boolean;
}

const POPUP_POOL = 8;
const POPUP_LIFE = 0.9;

const popups: Popup[] = Array.from({ length: POPUP_POOL }, () => ({
  x: 0, y: 0, value: 0, life: 0, active: false,
}));
let popupCursor = 0;

export function addPopup(x: number, y: number, value: number): void {
  const popup = popups[popupCursor]!;
  popupCursor = (popupCursor + 1) % POPUP_POOL;
  popup.x = x;
  popup.y = y;
  popup.value = value;
  popup.life = POPUP_LIFE;
  popup.active = true;
}

export function updateHud(dt: number, scrollSpeed: number): void {
  for (const popup of popups) {
    if (!popup.active) continue;
    popup.life -= dt;
    if (popup.life <= 0) {
      popup.active = false;
      continue;
    }
    // Drift up and back with the world, so a popup stays attached to the thing
    // that earned it instead of hanging in the air.
    popup.y -= 26 * dt;
    popup.x -= scrollSpeed * dt;
  }
}

export function resetHud(): void {
  for (const popup of popups) popup.active = false;
}

export function drawPopups(ctx: CanvasRenderingContext2D): void {
  for (const popup of popups) {
    if (!popup.active) continue;
    const fade = Math.min(1, popup.life / (POPUP_LIFE * 0.5));
    drawText(ctx, `+${popup.value}`, popup.x, popup.y, {
      size: 9,
      color: alpha(PALETTE.fairyHalo, fade),
      align: 'center',
      glow: true,
    });
  }
}

export function drawHud(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (state.phase === 'title') return;

  drawText(ctx, String(state.score), 8, CEILING_Y / 2, {
    size: 14,
    color: PALETTE.hudText,
    align: 'left',
    glow: true,
  });

  drawText(ctx, `GATES ${state.gatesPassed}`, SCREEN.w / 2, CEILING_Y / 2, {
    size: 8,
    color: PALETTE.hudDim,
    align: 'center',
  });

  drawHearts(ctx, state);

  // Sector banner: escalation you can see, a moment before you feel it.
  if (state.sectorFlash > 0) {
    const fade = Math.min(1, state.sectorFlash / (JUICE.sectorFlash * 0.4));
    drawText(ctx, `SECTOR ${state.sector}`, SCREEN.w / 2, VIRTUAL_H / 2 - 40, {
      size: 16,
      color: alpha(PALETTE.hudAccent, fade),
      align: 'center',
      glow: true,
    });
  }
}

/**
 * Hearts, right-aligned.
 *
 * Empty slots are drawn rather than removed, so the total never changes shape
 * mid-run. A count that shrinks its own footprint makes "how many did I start
 * with" unanswerable at a glance, which is the one question hearts exist to
 * answer.
 */
function drawHearts(ctx: CanvasRenderingContext2D, state: GameState): void {
  const total = state.difficulty.hearts;
  const size = 7;
  const gap = 4;
  const right = SCREEN.w - 8;
  const y = CEILING_Y / 2 - size / 2;

  for (let i = 0; i < total; i++) {
    const filled = i < state.player.hp;
    const x = right - (total - i) * (size + gap) + gap;
    ctx.fillStyle = filled ? PALETTE.heart : alpha(PALETTE.heartEmpty, 0.5);
    // Two lobes and a point — a heart in five rectangles.
    ctx.fillRect(x, y + 1, 3, 3);
    ctx.fillRect(x + 4, y + 1, 3, 3);
    ctx.fillRect(x + 1, y + 3, 5, 2);
    ctx.fillRect(x + 2, y + 5, 3, 1);
    ctx.fillRect(x + 3, y + 6, 1, 1);
  }

  // Flash the frame while invulnerable, so mercy is visible rather than felt.
  if (state.player.invulnerable && Math.floor(state.elapsed * 10) % 2 === 0) {
    ctx.strokeStyle = alpha(PALETTE.heart, 0.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(
      right - total * (size + gap) - 2.5,
      y - 2.5,
      total * (size + gap) + 4,
      size + UNICORN.hurtboxInsetY + 2,
    );
  }
}
