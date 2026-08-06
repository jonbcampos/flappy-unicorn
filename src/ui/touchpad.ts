import { FLOOR_Y, SCREEN, VIRTUAL_H } from '../game/config';
import type { Action, Input } from '../core/input';
import { PALETTE, alpha } from '../render/palette';
import { drawText } from './text';

export interface TouchButton {
  action: Action;
  label: string;
  /** Center + radius, in virtual pixels. Circles hit-test cleanly with a thumb. */
  cx: number;
  cy: number;
  r: number;
  /** Extra invisible radius. Thumbs are imprecise; a miss feels like a bug. */
  touchPadding: number;
}

/**
 * Two buttons: MAGIC under the left thumb, FLY under the right.
 *
 * They're drawn on the canvas rather than as DOM elements so they scale with
 * the letterbox transform automatically, and so every input — button presses
 * and menu taps alike — flows through one pointer pipeline.
 *
 * Both sit entirely below FLOOR_Y (design contract 15). A control drawn over
 * the play field hides the thing it's about to kill you with.
 */
function buildButtons(): TouchButton[] {
  return [
    {
      action: 'magic',
      label: 'MAGIC',
      cx: 52,
      cy: VIRTUAL_H - 30,
      r: 26,
      touchPadding: 12,
    },
    {
      action: 'fly',
      label: 'FLY',
      cx: SCREEN.w - 54,
      cy: VIRTUAL_H - 30,
      r: 30,
      touchPadding: 12,
    },
  ];
}

let cachedWidth = -1;
let cachedButtons: TouchButton[] = [];

/**
 * Button layout for the current frame width.
 *
 * Memoised on width rather than rebuilt per call: this runs once per frame for
 * drawing and again on every pointer event, and allocating two objects each
 * time is exactly the kind of steady garbage that shows up as a frame hitch.
 */
export function touchButtons(): readonly TouchButton[] {
  if (cachedWidth !== SCREEN.w) {
    cachedWidth = SCREEN.w;
    cachedButtons = buildButtons();
  }
  return cachedButtons;
}

export function hitTestButton(x: number, y: number): TouchButton | null {
  for (const button of touchButtons()) {
    const dx = x - button.cx;
    const dy = y - button.cy;
    const reach = button.r + button.touchPadding;
    if (dx * dx + dy * dy <= reach * reach) return button;
  }
  return null;
}

/**
 * What a touch at (x, y) does.
 *
 * The circles are the affordance; the *hit region for FLY is the entire right
 * half of the frame*. A five-year-old cannot reliably land a 30px circle while
 * panicking, and unlike every other control in either of these games, a missed
 * flap is not a wasted input — it's a heart. So the button says where to press
 * and the game accepts anywhere reasonable.
 *
 * MAGIC keeps its small circle deliberately: a mis-aimed shot costs nothing, so
 * there's no reason to steal screen from FLY for it. The asymmetry is the
 * point — the forgiving control is the one where forgiveness matters.
 */
export function hitTestAction(x: number, y: number): Action | null {
  const button = hitTestButton(x, y);
  if (button) return button.action;
  return x > SCREEN.w / 2 ? 'fly' : null;
}

/**
 * Draw the controls.
 *
 * They sit at low opacity so they don't compete with the gameplay, and light up
 * hard on press. That press feedback isn't decoration: when an input doesn't
 * work, it's the only way the player can tell whether the game missed the touch
 * or they simply pressed at the wrong moment.
 */
export function drawTouchpad(ctx: CanvasRenderingContext2D, input: Input): void {
  for (const button of touchButtons()) {
    const pressed = input.down[button.action];
    const fill = pressed ? alpha(PALETTE.buttonActive, 0.3) : alpha(PALETTE.buttonIdle, 0.42);
    const edge = pressed ? PALETTE.buttonActive : alpha(PALETTE.buttonEdge, 0.65);

    if (pressed) {
      ctx.fillStyle = alpha(PALETTE.buttonActive, 0.12);
      ctx.beginPath();
      ctx.arc(button.cx, button.cy, button.r + 6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(button.cx, button.cy, button.r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = pressed ? 2 : 1;
    ctx.stroke();

    drawText(ctx, button.label, button.cx, button.cy, {
      size: button.r > 26 ? 10 : 8,
      color: pressed ? PALETTE.playerCore : alpha(PALETTE.hudText, 0.7),
      align: 'center',
    });
  }
}

/**
 * Design contract 15: no control is drawn over the play field.
 *
 * It lives here rather than alongside the others in state.ts because the
 * simulation is not allowed to import the UI. Run from main.ts next to
 * validateDesignContracts(), so a broken layout is as loud as broken tuning.
 */
export function validateTouchpadContracts(): string[] {
  const problems: string[] = [];
  for (const button of touchButtons()) {
    const top = button.cy - button.r;
    if (top < FLOOR_Y) {
      problems.push(
        `${button.label} button is drawn over the play field (top ${top}, floor ${FLOOR_Y})`,
      );
    }
  }
  return problems;
}
