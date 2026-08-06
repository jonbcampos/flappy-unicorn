import type { Rng } from '../core/rng';
import {
  BOMB,
  CEILING_Y,
  FAIRY,
  FLOOR_Y,
  GATE,
  PLAYER_X,
  SHOT,
  UNICORN,
  WORLD,
  corridorClearance,
  spawnX,
  type Difficulty,
} from './config';
import { type Corridor, bandLimits, clearsLane, laneY, reachableCentreRange } from './corridor';

export interface BombPlacement {
  x: number;
  y: number;
  blocking: boolean;
}

export interface FairyPlacement {
  x: number;
  y: number;
  kind: 'fairy' | 'person';
}

export interface Placements {
  gate: { centreY: number; gapHeight: number; variant: 'arch' | 'tower' };
  bombs: BombPlacement[];
  fairies: FairyPlacement[];
}

export interface DirectorContext {
  difficulty: Difficulty;
  sector: number;
  scrollSpeed: number;
  rng: Rng;
}

/**
 * How many shots can actually land on something crossing the frame.
 *
 * The flappy analogue of the runner game's `maxKillableArmour`, and it exists
 * for the same reason: a hazard whose only answer is "shoot it" must be
 * shootable *in the time it takes to arrive*, and that time shrinks as the game
 * speeds up. Without this the director happily places a bomb that physically
 * cannot be destroyed before it reaches you.
 *
 * `killSafetyFactor` discounts the window because the player is also flying.
 */
export function maxKillableBombs(scrollSpeed: number): number {
  const muzzle = PLAYER_X + UNICORN.muzzleX;
  const speed = Math.max(scrollSpeed, 1);
  const approach = (spawnX() - muzzle) / speed;
  // Time spent too far away for a shot to reach it at all.
  const outOfRange = Math.max(0, (spawnX() - muzzle - SHOT.range) / speed);
  const usable = (approach - outOfRange) * BOMB.killSafetyFactor;
  return Math.floor(usable / SHOT.cooldown) + 1;
}

/** Rejection-sampling budget. Small on purpose — see the comment at the call. */
const PLACEMENT_ATTEMPTS = 6;

/**
 * The spawn scheduler.
 *
 * A metronome with a fairness veto, not the runner game's pattern picker. The
 * one structural rule, and the reason this file exists at all:
 *
 *   **Nothing spawns on its own timer.** The director emits one gate, and in
 *   the same call fills the corridor it just closed.
 *
 * Independent timers are how a bomb ends up parked in the only gap. Placing
 * hazards at the same moment as the gate that defines their corridor means the
 * safe path is always known at placement time, so an unfair placement is not
 * something to detect and patch — it is something that cannot be expressed.
 */
export class GateDirector {
  private timer = 0;
  /**
   * The centre of the gate that will spawn on the *next* firing.
   *
   * The director runs one gate ahead of itself, and that lookahead is what
   * makes off-screen placement possible at all. The naive version — spawn a
   * gate, then fill the corridor behind it — cannot work: by the time gate N+1
   * reaches the spawn edge, the space between it and gate N is already most of
   * the way across the screen, so anything dropped there materialises in front
   * of the player. Deciding N+1's altitude an interval early means the corridor
   * being filled is the one *ahead* of the gate just spawned, which lies
   * entirely beyond the right edge and scrolls in like everything else.
   */
  private pendingCentre = (CEILING_Y + FLOOR_Y) / 2;

  get secondsUntilNextGate(): number {
    return this.timer;
  }

  reset(difficulty: Difficulty): void {
    this.timer = WORLD.openingRest * difficulty.spacingScale;
    this.pendingCentre = (CEILING_Y + FLOOR_Y) / 2;
  }

  update(dt: number, ctx: DirectorContext, emit: (placements: Placements) => void): void {
    this.timer -= dt;
    if (this.timer > 0) return;

    this.timer += this.nextInterval(ctx);

    const gapHeight = ctx.difficulty.gapHeight;
    const centreY = this.pendingCentre;

    // Open space that will exist between this gate and the next one.
    //
    // Read off `timer` *after* the interval is added, because that is literally
    // the time remaining until the next gate — the raw interval is not. The
    // timer fires having already gone up to one tick negative, and adding the
    // interval to that carries the overshoot forward. Using the raw interval
    // instead over-predicts the gap by a tick's worth of travel, which at HARD
    // top speed is 2.6px, and that was enough to put a blocking bomb 1.2px
    // inside the gate-mouth exclusion the placement rule promises.
    //
    // If the speed steps up mid-interval the real gap comes out larger than
    // this, which only makes the next gate easier to reach — that residual
    // error is in the safe direction.
    const dx = Math.max(0, this.timer * ctx.scrollSpeed - GATE.width);
    const range = reachableCentreRange(centreY, dx, ctx.scrollSpeed, gapHeight);
    const nextCentre = ctx.rng.range(range.min, range.max);

    // Everything from here is off-screen, to the right of the gate spawning now.
    const corridor: Corridor = {
      startX: spawnX() + GATE.width,
      endX: spawnX() + GATE.width + dx,
      startY: centreY,
      endY: nextCentre,
      halfHeight: gapHeight / 2,
    };

    const variant: 'arch' | 'tower' =
      ctx.sector >= GATE.towerFromSector && ctx.rng.next() < 0.4 ? 'tower' : 'arch';

    const bombs = this.placeBombs(corridor, ctx);
    const fairies = this.placeFairies(corridor, ctx, bombs);

    this.pendingCentre = nextCentre;

    emit({ gate: { centreY, gapHeight, variant }, bombs, fairies });
  }

  /** Spacing tightens with the sector, floored so it never becomes a blur. */
  private nextInterval(ctx: DirectorContext): number {
    const decayed =
      WORLD.gateInterval - WORLD.gateIntervalDecayPerSector * (ctx.sector - 1);
    const base = Math.max(WORLD.minGateInterval, decayed) * ctx.difficulty.spacingScale;
    const jitter = ctx.rng.range(-WORLD.gateIntervalJitter, WORLD.gateIntervalJitter);
    return Math.max(WORLD.minGateInterval * 0.9, base + jitter);
  }

  /**
   * Fill the corridor with bombs, if this roll wants any.
   *
   * Two classes, and the difference between them is the whole design:
   *
   * **Class A (aside)** sits well off the flight line. It's scenery you may
   * profit from — free points if you can spare the altitude to line it up, and
   * completely ignorable if you can't.
   *
   * **Class B (blocking)** sits *near* the line and genuinely demands an
   * answer. It's the only thing in the game that asks you to use both buttons
   * at once. It always has two answers — shoot it, or fly the wide side — and
   * both are guaranteed here rather than hoped for.
   */
  private placeBombs(corridor: Corridor, ctx: DirectorContext): BombPlacement[] {
    const out: BombPlacement[] = [];
    if (ctx.rng.next() >= ctx.difficulty.bombChance) return out;

    const wantsBlocking =
      ctx.rng.next() < ctx.difficulty.blockingBombShare &&
      // If a bomb can't be shot down in the time it has to arrive, it isn't a
      // question, it's a wall. Downgrade rather than place it.
      maxKillableBombs(ctx.scrollSpeed) >= 2;

    if (wantsBlocking) {
      const blocking = this.placeBlockingBomb(corridor, ctx);
      if (blocking) {
        out.push(blocking);
        return out;
      }
      // Fall through to an aside bomb if there was no legal blocking spot.
    }

    const aside = this.placeAsideBomb(corridor, ctx);
    if (aside) out.push(aside);
    return out;
  }

  private placeAsideBomb(corridor: Corridor, ctx: DirectorContext): BombPlacement | null {
    const clearance = corridorClearance(ctx.difficulty.gapHeight);
    const span = corridor.endX - corridor.startX;
    // Middle 60% of the span, so a bomb never crowds either gate mouth.
    const minX = corridor.startX + span * 0.2;
    const maxX = corridor.startX + span * 0.8;
    const minY = CEILING_Y + BOMB.height / 2 + 2;
    const maxY = FLOOR_Y - BOMB.height / 2 - 2;
    if (maxX <= minX || maxY <= minY) return null;

    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
      const x = ctx.rng.range(minX, maxX);
      const y = ctx.rng.range(minY, maxY);
      if (clearsLane(corridor, x, y, clearance)) return { x, y, blocking: false };
    }
    // Give up rather than relax the rule. A missing bomb is invisible; an
    // unfair one is the thing this entire module exists to prevent.
    return null;
  }

  private placeBlockingBomb(corridor: Corridor, ctx: DirectorContext): BombPlacement | null {
    const minX = corridor.startX + BOMB.minGateClearance;
    const maxX = corridor.endX - BOMB.minGateClearance;
    if (maxX <= minX) return null;

    const x = ctx.rng.range(minX, maxX);
    const lane = laneY(corridor, x);
    const band = bandLimits(ctx.difficulty.gapHeight);
    // Offset toward the nearer edge of the field, so the wide side — the one
    // you're meant to fly through — always points at open sky.
    const midField = (band.min + band.max) / 2;
    const sign = lane <= midField ? -1 : 1;
    const y = lane + sign * BOMB.blockOffset;

    const minSafeY = CEILING_Y + BOMB.height / 2 + 2;
    const maxSafeY = FLOOR_Y - BOMB.height / 2 - 2;
    if (y < minSafeY || y > maxSafeY) return null;

    return { x, y, blocking: true };
  }

  /**
   * Place a fairy, most often directly on the flight line.
   *
   * On-lane fairies do double duty: they're the reward, and they're a *hint* —
   * a bright thing sitting exactly where you should already be going. A child
   * who never works out the shooting still benefits from flying at them.
   */
  private placeFairies(
    corridor: Corridor,
    ctx: DirectorContext,
    bombs: readonly BombPlacement[],
  ): FairyPlacement[] {
    const out: FairyPlacement[] = [];
    if (ctx.rng.next() >= ctx.difficulty.fairyChance) return out;

    const span = corridor.endX - corridor.startX;
    const minX = corridor.startX + span * 0.25;
    const maxX = corridor.endX - span * 0.25;
    if (maxX <= minX) return out;

    const band = bandLimits(ctx.difficulty.gapHeight);
    const kind: 'fairy' | 'person' =
      ctx.sector >= FAIRY.personFromSector && ctx.rng.next() < 0.35 ? 'person' : 'fairy';

    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
      const x = ctx.rng.range(minX, maxX);
      const y =
        ctx.rng.next() < FAIRY.onLaneChance
          ? laneY(corridor, x)
          : ctx.rng.range(band.min, band.max);

      // Never next to a bomb. Two small bright-vs-dark things side by side at
      // speed is exactly the read the player will get wrong, and getting it
      // wrong means flying into a bomb on purpose.
      const crowded = bombs.some(
        (b) =>
          Math.abs(b.x - x) < FAIRY.minSeparationFromBomb &&
          Math.abs(b.y - y) < FAIRY.minSeparationFromBomb,
      );
      if (!crowded) {
        out.push({ x, y, kind });
        return out;
      }
    }
    return out;
  }
}
