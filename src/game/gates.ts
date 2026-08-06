import type { Aabb } from './collision';
import { CEILING_Y, FLOOR_Y, GATE, MOVING_GATE, spawnX } from './config';

/**
 * Three looks, one hitbox.
 *
 * `arch` and `tower` belong to the meadow; `gatehouse` is the brick version
 * that stands in the town. They are purely cosmetic — every fairness guarantee
 * in the game is about `GATE.width`, `gapHeight` and `centreY`, and none of
 * them care what the column is made of.
 */
export type GateVariant = 'arch' | 'tower' | 'gatehouse';

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
  /** Where the opening sits right now. Derived each tick for a moving gate. */
  centreY: number;
  prevCentreY: number;
  /** The centre it oscillates around. Equal to centreY for a still gate. */
  baseCentreY: number;
  /** 0 for a still gate. See MOVING_GATE. */
  amplitude: number;
  /** Offset so a run of moving gates doesn't drift in unison. */
  phase: number;
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
        prevCentreY: 0,
        baseCentreY: 0,
        amplitude: 0,
        phase: 0,
        gapHeight: 0,
        variant: 'arch',
        scored: false,
        active: false,
      });
    }
  }

  spawn(
    centreY: number,
    gapHeight: number,
    variant: GateVariant,
    amplitude = 0,
    phase = 0,
  ): Gate | null {
    const item = this.items.find((g) => !g.active);
    // Pool exhausted. Skipping a gate leaves a gap in the rhythm, which is far
    // better than recycling one that's still on screen and having it teleport.
    if (!item) return null;
    item.x = spawnX();
    item.prevX = item.x;
    item.baseCentreY = centreY;
    item.amplitude = amplitude;
    item.phase = phase;
    item.centreY = centreY;
    item.prevCentreY = centreY;
    item.gapHeight = gapHeight;
    item.variant = variant;
    item.scored = false;
    item.active = true;
    return item;
  }

  /**
   * @param elapsed run time, so a moving gate's position is a pure function of
   * it rather than an integrated one. Integrating a sine wave frame by frame
   * accumulates drift, and a hazard whose position depends on how long the tab
   * has been open is not reproducible from a seed.
   */
  update(dt: number, scrollSpeed: number, elapsed: number): void {
    for (const item of this.items) {
      if (!item.active) continue;
      item.prevX = item.x;
      item.prevCentreY = item.centreY;
      item.x -= scrollSpeed * dt;
      if (item.amplitude > 0) {
        item.centreY =
          item.baseCentreY + Math.sin(elapsed * MOVING_GATE.rate + item.phase) * item.amplitude;
      }
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
