/** Axis-aligned box. (x, y) is the top-left corner; y grows downward. */
export interface Aabb {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlaps(a: Aabb, b: Aabb): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Shrink a box by an inset on every side, producing a hurtbox that is smaller
 * than the thing you can see.
 *
 * This is deliberate and it applies to both the player and the hazards. A
 * player who clips the visual corner of a spike and survives reads the moment
 * as "that was close" — a fair, exciting near-miss. A player hit by a pixel of
 * empty space reads it as a broken game. The asymmetry costs nothing and is
 * most of the difference between the two.
 */
export function inset(box: Aabb, insetX: number, insetY: number, out: Aabb): Aabb {
  out.x = box.x + insetX;
  out.y = box.y + insetY;
  out.w = Math.max(0, box.w - insetX * 2);
  out.h = Math.max(0, box.h - insetY * 2);
  return out;
}
