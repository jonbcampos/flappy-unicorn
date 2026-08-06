import { PALETTE, alpha } from '../render/palette';

/**
 * Text helpers.
 *
 * A monospace system font keeps this asset-free for now. When the 16-bit
 * renderer lands it will want a real bitmap font instead — this module is the
 * only place that would need to change.
 */
export function setFont(ctx: CanvasRenderingContext2D, size: number, bold = true): void {
  ctx.font = `${bold ? 'bold ' : ''}${size}px "SF Mono", "Roboto Mono", ui-monospace, monospace`;
  ctx.textBaseline = 'middle';
}

export interface TextOptions {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  glow?: boolean;
  bold?: boolean;
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  { size = 10, color = PALETTE.hudText as string, align = 'left', glow = false, bold = true }: TextOptions = {},
): void {
  setFont(ctx, size, bold);
  ctx.textAlign = align;
  if (glow) {
    ctx.fillStyle = alpha(color, 0.35);
    ctx.fillText(text, x, y + 1);
    ctx.fillText(text, x + 1, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
