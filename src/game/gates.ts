import type { Aabb } from './collision';
import { CEILING_Y, FLOOR_Y, GATE, spawnX } from './config';

export type GateVariant = 'arch' | 'tower';

/**
 * A gate is a pair of columns with an opening between them.
 *
 * Stored as centre + gap rather than as two boxes, because every piece of
 * reasoning in the game — reachability, clearance, whether the thing is even
 * threadable — is about the *opening*, and deriving the opening back out of two
 * rectangles every time is how the two halves drift apart.
 */
export interface Gate {
  x: number;
  prevX: number;
  centreY: number;
  gapHeight: number;
  variant: GateVariant;
  /** True once the unicorn is fully past it, so it scores exactly once. */
  scored: boolean;
  active: boolean;
}

/**
 * Fixed-size pool of gates.
 *
 * Nothing is allocated after startup. Games run a hot loop 60+ times a second;
 * a steady drip of short-lived objects hands the garbage collector regular work
 * that surfaces as a periodic frame hitch, and a hitch here is a missed flap.
 */
export class GateField {
  readonly items: Gate[] = [];

  constructor() {
    for (let i = 0; i < GATE.poolSize; i++) {
      this.items.push({
        x: 0,
        prevX: 0,
        centreY: 0,
        gapHeight: 0,
        variant: 'arch',
        scored: false,
        active: false,
      });
    }
  }

  spawn(centreY: number, gapHeight: number, variant: GateVariant): Gate | null {
    const item = this.items.find((g) => !g.active);
    // Pool exhausted. Skipping a gate leaves a gap in the rhythm, which is far
    // better than recycling one that's still on screen and having it teleport.
    if (!item) return null;
    item.x = spawnX();
    item.prevX = item.x;
    item.centreY = centreY;
    item.gapHeight = gapHeight;
    item.variant = variant;
    item.scored = false;
    item.active = true;
    return item;
  }

  update(dt: number, scrollSpeed: number): void {
    for (const item of this.items) {
      if (!item.active) continue;
      item.prevX = item.x;
      item.x -= scrollSpeed * dt;
      if (item.x + GATE.width < -8) item.active = false;
    }
  }

  reset(): void {
    for (const item of this.items) item.active = false;
  }

  /** The upper column: from the ceiling down to the top lip of the opening. */
  static topBox(gate: Gate, out: Aabb): Aabb {
    out.x = gate.x;
    out.y = CEILING_Y;
    out.w = GATE.width;
    out.h = gate.centreY - gate.gapHeight / 2 - CEILING_Y;
    return out;
  }

  /** The lower column: from the bottom lip of the opening down to the floor. */
  static bottomBox(gate: Gate, out: Aabb): Aabb {
    const bottomLip = gate.centreY + gate.gapHeight / 2;
    out.x = gate.x;
    out.y = bottomLip;
    out.w = GATE.width;
    out.h = FLOOR_Y - bottomLip;
    return out;
  }
}
