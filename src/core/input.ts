import { INPUT_TUNING } from '../game/config';
import type { Viewport } from './viewport';
import { hitTestAction } from '../ui/touchpad';

export type Action = 'fly' | 'magic';

const ACTIONS: readonly Action[] = ['fly', 'magic'];

/**
 * Multi-touch input.
 *
 * The classic mobile-game bug is that shooting while flapping doesn't register.
 * It has three causes, all handled here:
 *
 *  1. Using `click`/`touchstart` semantics that assume one finger. We track
 *     every active pointer independently by pointerId, so N fingers work.
 *  2. Letting the browser treat a touch as a scroll or a zoom. `touch-action:
 *     none` in CSS plus preventDefault kills that.
 *  3. A thumb that slides off a button mid-press, or onto another one. We
 *     re-hit-test on pointermove so a rolling thumb behaves sensibly.
 *
 * Presses are also *buffered* rather than read as instantaneous edges: a press
 * lands in a small time window that the unicorn consumes when it next steps.
 * In a game where one missed flap is a heart, that window is the difference
 * between "responsive" and "it ate my input".
 */
export class Input {
  /** True while any pointer or key is holding the action. */
  readonly down: Record<Action, boolean> = { fly: false, magic: false };

  /** Seconds of life left on an unconsumed press. */
  private buffer: Record<Action, number> = { fly: 0, magic: 0 };

  /**
   * Every active pointer, mapped to the action it's currently over (or null if
   * it's touching empty screen). Pointers off a button stay tracked so a thumb
   * that slides away and back re-engages instead of going dead.
   */
  private pointers = new Map<number, Action | null>();

  /** Actions held by keyboard, tracked separately so touch + keys can coexist. */
  private keys = new Set<Action>();

  /** Set on any input at all — used to unlock WebAudio and dismiss screens. */
  anyPressThisTick = false;

  /**
   * Last un-consumed tap, in virtual coordinates. Menus hit-test against this
   * rather than going through the action buttons, so the title screen doesn't
   * have to pretend a difficulty choice is a "flap".
   */
  private pendingTap: { x: number; y: number } | null = null;

  constructor(private viewport: Viewport) {
    const canvas = viewport.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    // If a pointer leaves the canvas entirely, treat it as released — otherwise
    // an action can get stuck on.
    canvas.addEventListener('pointerleave', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    // A backgrounded tab never delivers pointerup/keyup. Clear everything.
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    const { x, y } = this.viewport.toVirtual(e.clientX, e.clientY);
    const action = hitTestAction(x, y);
    this.anyPressThisTick = true;
    this.pendingTap = { x, y };
    this.pointers.set(e.pointerId, action);
    if (action) this.press(action);
    this.recompute();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    const { x, y } = this.viewport.toVirtual(e.clientX, e.clientY);
    const action = hitTestAction(x, y);
    const previous = this.pointers.get(e.pointerId) ?? null;
    if (action === previous) return;

    this.pointers.set(e.pointerId, action);
    // Rolling onto a new button counts as a fresh press of that action.
    if (action) this.press(action);
    this.recompute();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    this.recompute();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const action = keyToAction(e.code);
    this.anyPressThisTick = true;
    if (!action || e.repeat) return;
    e.preventDefault();
    this.keys.add(action);
    this.press(action);
    this.recompute();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const action = keyToAction(e.code);
    if (!action) return;
    this.keys.delete(action);
    this.recompute();
  };

  private releaseAll = (): void => {
    this.pointers.clear();
    this.keys.clear();
    this.recompute();
  };

  /** Recompute held state from the union of all active input sources. */
  private recompute(): void {
    for (const action of ACTIONS) this.down[action] = this.keys.has(action);
    for (const action of this.pointers.values()) {
      if (action) this.down[action] = true;
    }
  }

  private press(action: Action): void {
    this.buffer[action] = INPUT_TUNING.bufferSeconds;
  }

  /** Advance buffer timers. Called once per fixed simulation step. */
  tick(dt: number): void {
    for (const action of ACTIONS) {
      if (this.buffer[action] > 0) this.buffer[action] = Math.max(0, this.buffer[action] - dt);
    }
  }

  /** True if the action was pressed recently and hasn't been acted on yet. */
  hasBuffered(action: Action): boolean {
    return this.buffer[action] > 0;
  }

  /** Take a buffered press. Returns true once per press, then clears it. */
  consume(action: Action): boolean {
    if (this.buffer[action] <= 0) return false;
    this.buffer[action] = 0;
    return true;
  }

  clearBuffers(): void {
    for (const action of ACTIONS) this.buffer[action] = 0;
    this.pendingTap = null;
  }

  /** Take the pending tap position, if any. Returns it once, then clears it. */
  consumeTap(): { x: number; y: number } | null {
    const tap = this.pendingTap;
    this.pendingTap = null;
    return tap;
  }

  /** Take the "something was pressed" flag. Used to unlock audio. */
  consumeAnyPress(): boolean {
    const pressed = this.anyPressThisTick;
    this.anyPressThisTick = false;
    return pressed;
  }
}

function keyToAction(code: string): Action | null {
  switch (code) {
    case 'Space':
    case 'ArrowUp':
    case 'KeyW':
      return 'fly';
    case 'KeyZ':
    case 'KeyJ':
    case 'ArrowRight':
      return 'magic';
    default:
      return null;
  }
}
