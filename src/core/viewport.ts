import {
  MAX_DPR,
  MAX_VIRTUAL_W,
  MIN_VIRTUAL_W,
  SCREEN,
  VIRTUAL_H,
} from '../game/config';

/**
 * Maps the virtual game frame onto whatever the real device screen is.
 *
 * Two things happen here, and both exist because a landscape game has to live
 * on a phone that may be held either way:
 *
 * **1. The frame width adapts.** Height is fixed (so gameplay is identical
 * everywhere) and width follows the screen's aspect ratio within clamps. A
 * fixed 16:9 frame on a 20:9 phone wastes two fat black bars.
 *
 * **2. Portrait rotates the whole presentation.** If the screen is taller than
 * it is wide, everything is drawn rotated 90°, so the game runs along the
 * screen's long axis and the player turns the phone.
 *
 * That second one matters more than it sounds. A landscape frame letterboxed
 * into portrait is a thin strip across the middle — most of the screen wasted.
 * Worse, plenty of people keep rotation lock ON, so the browser never reports
 * landscape no matter how they hold the phone, and no amount of asking politely
 * helps. Rotating it ourselves means the game fills the screen either way.
 */
export class Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  /** Virtual px -> CSS px. */
  scale = 1;
  /** Letterbox offsets in CSS px, along the game's own axes. */
  offsetX = 0;
  offsetY = 0;
  /** True when the game is drawn sideways because the device is portrait. */
  rotated = false;

  /** Kept for the rotated inverse transform in toVirtual. */
  private cssW = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;

    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
  }

  resize = (): void => {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.cssW = cssW;

    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;

    // Portrait: the game's long axis runs down the screen instead of across.
    this.rotated = cssH > cssW;
    SCREEN.rotated = this.rotated;
    const alongGameWidth = this.rotated ? cssH : cssW;
    const alongGameHeight = this.rotated ? cssW : cssH;

    // Pick the frame width from the aspect ratio, then the scale that fits it.
    const aspect = alongGameWidth / alongGameHeight;
    SCREEN.w = Math.round(clamp(VIRTUAL_H * aspect, MIN_VIRTUAL_W, MAX_VIRTUAL_W));
    SCREEN.h = VIRTUAL_H;
    this.scale = Math.min(alongGameWidth / SCREEN.w, alongGameHeight / VIRTUAL_H);

    this.offsetX = (alongGameWidth - SCREEN.w * this.scale) / 2;
    this.offsetY = (alongGameHeight - VIRTUAL_H * this.scale) / 2;

    // Everything downstream draws in plain virtual coordinates; this transform
    // absorbs the letterbox, the device pixel ratio, and the rotation.
    const s = this.scale * dpr;
    if (this.rotated) {
      // Game (x, y) -> screen (right - y*s, offsetX + x*s). A 90° turn, with
      // the game's +x running down the screen.
      const right = cssW - this.offsetY;
      this.ctx.setTransform(0, s, -s, 0, right * dpr, this.offsetX * dpr);
    } else {
      this.ctx.setTransform(s, 0, 0, s, this.offsetX * dpr, this.offsetY * dpr);
    }
    this.ctx.imageSmoothingEnabled = false;
  };

  /**
   * Convert a pointer event's CSS-pixel position into virtual coordinates.
   * Must invert whatever `resize` set up, rotation included — otherwise the
   * buttons are drawn in one place and tappable in another.
   */
  toVirtual(clientX: number, clientY: number): { x: number; y: number } {
    if (this.rotated) {
      return {
        x: (clientY - this.offsetX) / this.scale,
        y: (this.cssW - this.offsetY - clientX) / this.scale,
      };
    }
    return {
      x: (clientX - this.offsetX) / this.scale,
      y: (clientY - this.offsetY) / this.scale,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
