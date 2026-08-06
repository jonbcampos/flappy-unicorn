import {
  CEILING_Y,
  FLAP_SLOPE,
  FLIGHT,
  FLOOR_Y,
  GATE,
  WORLD_CURVATURE,
  arcSpeedAt,
} from './config';

/**
 * The geometry of "where it is safe to be".
 *
 * This module is the single authority on the flight line, and everything that
 * places something in the world has to ask it. That centralisation is the whole
 * point: the runner game could get away with spawning pickups on an independent
 * timer and patching overlaps afterwards, because in a runner there is always a
 * floor to stand on. In flappy there is exactly one survivable path between two
 * gates, and a bomb parked on it is an unfair death that no amount of skill
 * answers. So nothing is placed without checking against the corridor first.
 *
 * All the maths here is in *world distance*, not time, matching the flap arc.
 * See FLIGHT in config.ts for why.
 */

/** The open span between two consecutive gates. */
export interface Corridor {
  /** Trailing edge of the earlier gate. */
  startX: number;
  /** Leading edge of the later gate. */
  endX: number;
  /** Gap centre of the earlier gate. */
  startY: number;
  /** Gap centre of the later gate. */
  endY: number;
  halfHeight: number;
}

/**
 * The altitude of the safe flight line at a world x.
 *
 * A straight interpolation between the two gap centres. It isn't the path a
 * real player flies — that's a sawtooth of flaps and falls — but it is the
 * *centre* of the band they must stay inside, which is what clearance should be
 * measured from.
 */
export function laneY(c: Corridor, x: number): number {
  const span = c.endX - c.startX;
  if (span <= 0) return c.startY;
  const t = Math.max(0, Math.min(1, (x - c.startX) / span));
  return c.startY + (c.endY - c.startY) * t;
}

/** True if a point at (x, y) is at least `clearance` away from the flight line. */
export function clearsLane(c: Corridor, x: number, y: number, clearance: number): boolean {
  return Math.abs(y - laneY(c, x)) >= clearance;
}

/**
 * Altitude the unicorn can gain over `dx` px of forward travel.
 *
 * Modelled as a sustained sawtooth: each tap covers `dxTap = s / assumedTapRate`
 * px and nets `FLAP_SLOPE·dxTap − ½·κ·dxTap²` of climb. Dividing that by dxTap
 * gives a sustainable climb *rate*, which scales linearly with distance.
 *
 * `assumedTapRate` is the only time-based quantity anywhere in the flight model,
 * which is exactly why climbing — and nothing else — gets harder as the game
 * speeds up. That is honest, it is the thing the player can practise, and it's
 * the number the whole reachability guarantee is bought with.
 */
export function maxClimbOver(dx: number, scrollSpeed: number): number {
  if (dx <= 0) return 0;
  const a = arcSpeedAt(scrollSpeed);
  // Real forward travel per tap uses the *actual* speed; the arc shape uses the
  // railed speed. Above the upper rail those differ, and using the wrong one
  // here would over-promise the climb at high speed.
  const dxTap = scrollSpeed / FLIGHT.assumedTapRate;
  if (dxTap <= 0) return 0;
  const slope = FLAP_SLOPE * (a / scrollSpeed);
  const curvature = WORLD_CURVATURE * ((a * a) / (scrollSpeed * scrollSpeed));
  const netPerTap = slope * dxTap - 0.5 * curvature * dxTap * dxTap;
  if (netPerTap <= 0) return 0;
  return (netPerTap / dxTap) * dx;
}

/**
 * Altitude lost over `dx` px with no flaps at all, terminal-clamped.
 *
 * The other half of reachability, and the one that decides whether a gap can be
 * coasted through. See design contract 3.
 */
export function freeFallOver(dx: number, scrollSpeed: number): number {
  if (dx <= 0) return 0;
  const a = arcSpeedAt(scrollSpeed);
  const curvature = WORLD_CURVATURE * ((a * a) / (scrollSpeed * scrollSpeed));
  const terminalSlope = FLIGHT.terminalSlope * (a / scrollSpeed);
  // Distance covered before the fall speed saturates.
  const dxToTerminal = terminalSlope / curvature;
  if (dx <= dxToTerminal) return 0.5 * curvature * dx * dx;
  const atTerminal = 0.5 * curvature * dxToTerminal * dxToTerminal;
  return atTerminal + terminalSlope * (dx - dxToTerminal);
}

/**
 * The altitudes a gap centre may legally occupy, ignoring reachability.
 *
 * @param amplitude how far the gate will drift from this centre. The band
 * shrinks by it on both sides, so a moving gate's *extremes* still leave a full
 * `minColumn` of solid column. Sizing the band for the base position instead
 * would let a drifting gate swing its opening into the ceiling, which reads as
 * the column vanishing.
 */
export function bandLimits(gapHeight: number, amplitude = 0): { min: number; max: number } {
  return {
    min: CEILING_Y + GATE.minColumn + gapHeight / 2 + amplitude,
    max: FLOOR_Y - GATE.minColumn - gapHeight / 2 - amplitude,
  };
}

/**
 * The band the next gap centre may sit in, given where the last one was.
 *
 * Three limits intersected: the field itself, what the unicorn can climb to
 * over the intervening distance (discounted by `climbSafety`, because a player
 * has to *also* be reading the gap, not just tapping at maximum rate), and an
 * authored cap so that even a very long corridor doesn't produce a full-height
 * swing that reads as random.
 *
 * The result is always non-empty — if the limits cross, it collapses to the
 * clamped previous centre rather than returning something invalid.
 */
export function reachableCentreRange(
  previousCentre: number,
  dx: number,
  scrollSpeed: number,
  gapHeight: number,
  amplitude = 0,
): { min: number; max: number } {
  const band = bandLimits(gapHeight, amplitude);
  // Both gates may be drifting, so the worst case is the previous one at the
  // bottom of its swing and this one at the top of its. Charging that full
  // 2·amplitude against the climb budget is what keeps a pair of moving gates
  // from being further apart in practice than the reachability check believes.
  const climb = Math.min(
    Math.max(0, maxClimbOver(dx, scrollSpeed) * GATE.climbSafety - 2 * amplitude),
    GATE.maxDeltaY,
  );
  // Falling is free, so descending is bounded only by the authored cap.
  const drop = GATE.maxDeltaY;

  let min = Math.max(band.min, previousCentre - climb);
  let max = Math.min(band.max, previousCentre + drop);

  if (min > max) {
    const centre = Math.max(band.min, Math.min(band.max, previousCentre));
    min = centre;
    max = centre;
  }
  return { min, max };
}
