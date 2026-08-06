import { Rng } from '../core/rng';
import type { Input } from '../core/input';
import { BombField } from './bombs';
import { type Aabb, inset, overlaps } from './collision';
import {
  BOMB,
  CEILING_Y,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  FAIRY,
  FLIGHT,
  FLOOR_Y,
  GATE,
  JUICE,
  MIN_VIRTUAL_W,
  PLAYER_X,
  SHOT,
  UNICORN,
  UNICORN_HURT_H,
  WORLD,
  arcSpeedAt,
  corridorClearance,
  gravityAt,
  speedRange,
  type Difficulty,
  type DifficultyId,
} from './config';
import { freeFallOver, maxClimbOver } from './corridor';
import { GateDirector, maxKillableBombs, type Placements } from './director';
import { FairyField } from './fairies';
import { GateField } from './gates';
import { ShotPool } from './projectiles';
import { Unicorn } from './player';

export type Phase = 'title' | 'playing' | 'gameover';

export type GameEventType =
  | 'flap'
  | 'magic'
  | 'gate'
  | 'bomb-pop'
  | 'bomb-blast'
  | 'fairy-saved'
  | 'fairy-hug'
  | 'fairy-missed'
  | 'shot-fizzle'
  | 'hit'
  | 'death'
  | 'sector';

export interface GameEvent {
  type: GameEventType;
  x: number;
  y: number;
  /** Score awarded, for the floating popups. Zero when there isn't one. */
  value: number;
}

/** Pre-allocated event slots. See `emit`. */
const EVENT_POOL_SIZE = 16;

/**
 * The whole simulation.
 *
 * This module — and everything else under `src/game/` — never imports from
 * `src/render/`. It has no idea how the game looks. Presentation happens by
 * draining an event queue in main.ts, which is the boundary that keeps sound
 * and particles from leaking into gameplay code and vice versa.
 */
export class GameState {
  phase: Phase = 'title';
  difficulty: Difficulty = DIFFICULTIES.normal;
  rng = new Rng(1);

  readonly player = new Unicorn();
  readonly gates = new GateField();
  readonly bombs = new BombField();
  readonly fairies = new FairyField();
  readonly shots = new ShotPool();
  private readonly director = new GateDirector();

  score = 0;
  best = 0;
  gatesPassed = 0;
  elapsed = 0;
  distance = 0;
  sector = 1;
  // Annotated because WORLD is `as const`, which would otherwise pin this to
  // the literal 140 and reject every speed the game actually runs at.
  scrollSpeed: number = WORLD.baseScrollSpeed;

  /** Presentation state the renderer reads. Set here, decayed here. */
  shake = 0;
  hitstop = 0;
  sectorFlash = 0;

  private events: GameEvent[] = [];
  private eventCount = 0;

  /** Reusable collision boxes. Allocating these per check is the whole GC bill. */
  private boxA: Aabb = { x: 0, y: 0, w: 0, h: 0 };
  private boxB: Aabb = { x: 0, y: 0, w: 0, h: 0 };
  private boxC: Aabb = { x: 0, y: 0, w: 0, h: 0 };

  constructor() {
    for (let i = 0; i < EVENT_POOL_SIZE; i++) {
      this.events.push({ type: 'flap', x: 0, y: 0, value: 0 });
    }
  }

  start(difficultyId: DifficultyId, seed: number): void {
    this.difficulty = DIFFICULTIES[difficultyId];
    this.rng = new Rng(seed);
    this.phase = 'playing';
    this.score = 0;
    this.gatesPassed = 0;
    this.elapsed = 0;
    this.distance = 0;
    this.sector = 1;
    this.scrollSpeed = WORLD.baseScrollSpeed * this.difficulty.speedScale;
    this.shake = 0;
    this.hitstop = 0;
    this.sectorFlash = 0;
    this.eventCount = 0;

    this.player.reset(this.difficulty.hearts);
    this.gates.reset();
    this.bombs.reset();
    this.fairies.reset();
    this.shots.reset();
    this.director.reset(this.difficulty);
  }

  update(dt: number, input: Input): void {
    input.tick(dt);
    if (this.phase !== 'playing') return;

    // Hitstop freezes the entire simulation, input included. A few frames of
    // nothing is what makes an impact land — without it a collision is just a
    // number changing somewhere.
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      this.decayShake(dt);
      return;
    }

    this.elapsed += dt;
    this.distance += this.scrollSpeed * dt;
    this.advanceSector();
    this.decayShake(dt);
    if (this.sectorFlash > 0) this.sectorFlash = Math.max(0, this.sectorFlash - dt);

    const shot = this.player.update(dt, input, this.scrollSpeed);
    if (this.player.justFlapped) this.emit('flap', PLAYER_X, this.player.y);
    if (shot) {
      this.shots.spawn(shot.x, shot.y);
      this.emit('magic', shot.x, shot.y);
    }

    this.gates.update(dt, this.scrollSpeed);
    this.bombs.update(dt, this.scrollSpeed, this.elapsed);
    const missed = this.fairies.update(dt, this.scrollSpeed, this.elapsed);
    for (let i = 0; i < missed; i++) this.emit('fairy-missed', 0, 0);
    this.shots.update(dt);

    this.director.update(
      dt,
      {
        difficulty: this.difficulty,
        sector: this.sector,
        scrollSpeed: this.scrollSpeed,
        rng: this.rng,
      },
      (placements) => this.applyPlacements(placements),
    );

    this.resolveShotHits();
    this.resolveRescues();
    this.resolveGateScoring();
    if (!this.player.dead) {
      this.resolveBounds();
      this.resolvePlayerHits();
    }

    if (this.player.fallenOffScreen) this.endRun();
  }

  private applyPlacements(placements: Placements): void {
    const { gate, bombs, fairies } = placements;
    this.gates.spawn(gate.centreY, gate.gapHeight, gate.variant);
    for (const bomb of bombs) {
      this.bombs.spawn(bomb.x, bomb.y, bomb.blocking, this.rng.range(0, Math.PI * 2));
    }
    for (const fairy of fairies) {
      this.fairies.spawn(fairy.x, fairy.y, fairy.kind, this.rng.range(0, Math.PI * 2));
    }
  }

  private advanceSector(): void {
    const next = Math.floor(this.elapsed / WORLD.sectorLength) + 1;
    if (next === this.sector) return;
    this.sector = next;
    this.scrollSpeed =
      Math.min(
        WORLD.speedCap,
        WORLD.baseScrollSpeed + WORLD.speedPerSector * (this.sector - 1),
      ) * this.difficulty.speedScale;
    this.sectorFlash = JUICE.sectorFlash;
    this.emit('sector', 0, 0);
  }

  private decayShake(dt: number): void {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - JUICE.shakeDecay * dt * this.shake);
  }

  // --- resolution -----------------------------------------------------------

  /**
   * Magic against everything it can touch.
   *
   * Gate columns are checked *first and stop the shot*. That isn't flavour: if
   * magic passed through a rainbow you could snipe a blocking bomb from two
   * corridors away, and the bomb would stop being a question about where you
   * are. One shot, one target, nearest first.
   */
  private resolveShotHits(): void {
    for (const shot of this.shots.shots) {
      if (!shot.active) continue;
      ShotPool.box(shot, this.boxA);

      let consumed = false;

      for (const gate of this.gates.items) {
        if (!gate.active) continue;
        GateField.topBox(gate, this.boxB);
        const hitTop = overlaps(this.boxA, this.boxB);
        GateField.bottomBox(gate, this.boxB);
        if (hitTop || overlaps(this.boxA, this.boxB)) {
          shot.active = false;
          this.emit('shot-fizzle', shot.x, shot.y);
          consumed = true;
          break;
        }
      }
      if (consumed) continue;

      for (const bomb of this.bombs.items) {
        if (!BombField.isHazardous(bomb)) continue;
        BombField.box(bomb, this.boxB);
        // Inflated: the shot box a bomb presents is larger than the box that
        // can kill you. Easier to destroy than to be destroyed by.
        inset(this.boxB, -BOMB.shotboxPad, -BOMB.shotboxPad, this.boxC);
        if (!overlaps(this.boxA, this.boxC)) continue;
        shot.active = false;
        this.bombs.kill(bomb);
        this.score += BOMB.score;
        this.hitstop = JUICE.killHitstopDuration;
        this.shake = Math.max(this.shake, JUICE.shakeOnKill);
        this.emit('bomb-pop', bomb.x, bomb.y, BOMB.score);
        consumed = true;
        break;
      }
      if (consumed) continue;

      for (const fairy of this.fairies.items) {
        if (!FairyField.isRescuable(fairy)) continue;
        FairyField.box(fairy, FAIRY.shotboxPad, this.boxB);
        if (!overlaps(this.boxA, this.boxB)) continue;
        shot.active = false;
        this.fairies.save(fairy);
        this.score += FAIRY.scoreShot;
        this.emit('fairy-saved', fairy.x, fairy.y, FAIRY.scoreShot);
        break;
      }
    }
  }

  /**
   * Flying into a fairy.
   *
   * Runs even while invulnerable, and uses the *drawn* box rather than the
   * hurtbox. Rescues are the one interaction in the game that should be as
   * generous as possible in every direction.
   */
  private resolveRescues(): void {
    if (this.player.dead) return;
    this.player.bounds(this.boxA);
    for (const fairy of this.fairies.items) {
      if (!FairyField.isRescuable(fairy)) continue;
      FairyField.box(fairy, FAIRY.touchPad, this.boxB);
      if (!overlaps(this.boxA, this.boxB)) continue;
      this.fairies.save(fairy);
      this.score += FAIRY.scoreTouch;
      this.emit('fairy-hug', fairy.x, fairy.y, FAIRY.scoreTouch);
    }
  }

  /** A gate scores once, when its trailing edge clears the unicorn's nose. */
  private resolveGateScoring(): void {
    for (const gate of this.gates.items) {
      if (!gate.active || gate.scored) continue;
      if (gate.x + GATE.width >= PLAYER_X) continue;
      gate.scored = true;
      this.gatesPassed += 1;
      this.score += GATE.score;
      this.emit('gate', gate.x, gate.centreY, GATE.score);
    }
  }

  /**
   * The floor and the ceiling.
   *
   * The clamp and the bounce already happened inside the player; this only
   * decides what it *cost*. Splitting it that way keeps the difficulty rule
   * (`ceilingIsSafe`) out of the physics, where it has no business being.
   */
  private resolveBounds(): void {
    if (this.player.justHitFloor) {
      this.applyHit(PLAYER_X, FLOOR_Y);
    } else if (this.player.justHitCeiling && !this.difficulty.ceilingIsSafe) {
      this.applyHit(PLAYER_X, CEILING_Y);
    }
  }

  /**
   * Gates and bombs against the unicorn.
   *
   * Skipped entirely while invulnerable, and returns after the first landed
   * hit — at most one heart per tick, no matter how many things you are inside
   * of. Without that, clipping the corner of a column where a bomb also sits
   * costs two hearts for one mistake.
   */
  private resolvePlayerHits(): void {
    if (this.player.invulnerable) return;
    this.player.hurtbox(this.boxA);

    for (const gate of this.gates.items) {
      if (!gate.active) continue;
      GateField.topBox(gate, this.boxB);
      inset(this.boxB, GATE.hurtboxInset, GATE.hurtboxInset, this.boxC);
      if (overlaps(this.boxA, this.boxC)) return void this.applyHit(gate.x, this.player.y);
      GateField.bottomBox(gate, this.boxB);
      inset(this.boxB, GATE.hurtboxInset, GATE.hurtboxInset, this.boxC);
      if (overlaps(this.boxA, this.boxC)) return void this.applyHit(gate.x, this.player.y);
    }

    for (const bomb of this.bombs.items) {
      if (!BombField.isHazardous(bomb)) continue;
      BombField.box(bomb, this.boxB);
      inset(this.boxB, BOMB.hurtboxInset, BOMB.hurtboxInset, this.boxC);
      if (!overlaps(this.boxA, this.boxC)) continue;
      // A bomb that hits you also detonates, so one bomb costs one heart at
      // most — it can't sit inside your i-frames and take a second one.
      this.bombs.kill(bomb);
      this.emit('bomb-blast', bomb.x, bomb.y);
      this.applyHit(bomb.x, bomb.y);
      return;
    }
  }

  private applyHit(x: number, y: number): void {
    if (!this.player.takeHit(this.scrollSpeed)) return;
    this.hitstop = JUICE.hitstopDuration;
    this.shake = JUICE.shakeOnHit;
    this.emit(this.player.dead ? 'death' : 'hit', x, y);
  }

  private endRun(): void {
    this.phase = 'gameover';
    if (this.score > this.best) this.best = this.score;
  }

  // --- events ---------------------------------------------------------------

  /**
   * Queue something for the presentation layer.
   *
   * Writes into a pre-allocated slot rather than pushing a new object, for the
   * same reason everything else here is pooled. Overflow is dropped: sixteen
   * events in a single 1/120s step already means something has gone wrong, and
   * a dropped sparkle beats a growing array.
   */
  private emit(type: GameEventType, x = 0, y = 0, value = 0): void {
    if (this.eventCount >= EVENT_POOL_SIZE) return;
    const event = this.events[this.eventCount]!;
    event.type = type;
    event.x = x;
    event.y = y;
    event.value = value;
    this.eventCount += 1;
  }

  drainEvents(consume: (event: GameEvent) => void): void {
    for (let i = 0; i < this.eventCount; i++) consume(this.events[i]!);
    this.eventCount = 0;
  }
}

// --- design contracts -------------------------------------------------------

/**
 * Assertions about the *tuning*, checked at runtime.
 *
 * These are the things most likely to break silently when someone re-tunes a
 * number: not code that throws, but geometry that quietly stops being fair.
 * Every check runs for each difficulty, because gap height varies per mode and
 * that is precisely the axis where a change looks fine on NORMAL and makes HARD
 * impossible.
 *
 * Run on every page load from main.ts, and again by `__game.tune()`.
 */
export function validateDesignContracts(): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) problems.push(message);
  };

  // --- speed-independent ---
  check(
    SHOT.range >= 0.65 * MIN_VIRTUAL_W,
    `shots fizzle before reaching things the player can see (range ${SHOT.range} < ${
      0.65 * MIN_VIRTUAL_W
    })`,
  );
  check(
    BOMB.minGateClearance >= GATE.width + UNICORN.width,
    'a blocking bomb can be placed inside a gate mouth',
  );
  check(
    BOMB.width + 2 * BOMB.shotboxPad > BOMB.width - 2 * BOMB.hurtboxInset,
    "a bomb's shot box is not larger than its hurtbox — harder to kill than to be killed by",
  );
  // Contract 15 (no control drawn over the play field) lives in ui/touchpad.ts,
  // because reaching for it from here would make src/game/ depend on the
  // renderer — the one boundary this codebase does not bend.

  for (const id of DIFFICULTY_ORDER) {
    const difficulty = DIFFICULTIES[id];
    const gap = difficulty.gapHeight;
    const label = difficulty.label;
    const { min: sMin, max: sTop } = speedRange(difficulty);

    /** True vertical slack through an opening, hurtboxes accounted for. */
    const freedom = gap + 2 * GATE.hurtboxInset - UNICORN_HURT_H;
    /** World distance during which a gate can touch the unicorn. */
    const dangerWindow = GATE.width + UNICORN.width;

    check(
      FLOOR_Y - CEILING_Y - gap >= 2 * GATE.minColumn,
      `${label}: a ${gap}px opening leaves no visible column`,
    );
    check(
      freedom >= 4 * UNICORN_HURT_H,
      `${label}: opening has only ${freedom.toFixed(1)}px of slack, under four hurtbox heights`,
    );
    check(
      freeFallOver(dangerWindow, sMin) + 8 <= freedom,
      `${label}: coasting from the top lip clips the bottom lip (falls ${freeFallOver(
        dangerWindow,
        sMin,
      ).toFixed(1)}px through ${freedom.toFixed(1)}px) — a gap must not REQUIRE a flap`,
    );
    check(
      FLIGHT.flapRise < freedom,
      `${label}: one flap from the bottom lip overshoots the top lip`,
    );

    const minCorridorDx =
      WORLD.minGateInterval * difficulty.spacingScale * sTop - GATE.width;
    check(
      GATE.maxDeltaY <= maxClimbOver(minCorridorDx, sTop) * GATE.climbSafety,
      `${label}: gate N+1 may sit ${GATE.maxDeltaY}px above gate N but only ${(
        maxClimbOver(minCorridorDx, sTop) * GATE.climbSafety
      ).toFixed(1)}px is reachable`,
    );
    check(
      WORLD.minGateInterval * difficulty.spacingScale * sMin > dangerWindow + 40,
      `${label}: consecutive gates can overlap on the player`,
    );
    check(
      UNICORN.invulnDuration > dangerWindow / sMin,
      `${label}: i-frames end while still inside the column that hit you — one gate drains every heart`,
    );

    const bounceApex =
      (FLIGHT.boundaryBounceSlope * arcSpeedAt(sMin)) ** 2 / (2 * gravityAt(sMin));
    check(
      bounceApex > 6,
      `${label}: the boundary bounce only lifts ${bounceApex.toFixed(1)}px — not visibly clear`,
    );

    check(
      maxKillableBombs(sTop) >= 2,
      `${label}: at top speed only ${maxKillableBombs(
        sTop,
      )} shot(s) can land on a bomb — no room to miss`,
    );
    check(
      corridorClearance(gap) >= gap / 2 + BOMB.height / 2 + UNICORN.height / 2,
      `${label}: an aside bomb can sit inside the safe flight corridor`,
    );
    const wideSide = gap / 2 + BOMB.blockOffset - BOMB.height / 2 + BOMB.hurtboxInset;
    check(
      wideSide >= UNICORN_HURT_H + 12,
      `${label}: a blocking bomb leaves only ${wideSide.toFixed(
        1,
      )}px on its wide side — no dodge lane`,
    );
  }

  return problems;
}
