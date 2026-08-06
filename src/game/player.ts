import type { Aabb } from './collision';
import {
  CEILING_Y,
  FLIGHT,
  FLOOR_Y,
  PLAYER_X,
  SHOT,
  UNICORN,
  arcSpeedAt,
  flapVelocityAt,
  gravityAt,
  terminalVyAt,
} from './config';
import type { Input } from '../core/input';

/** What the unicorn wants to fire. Returned rather than pushed into a pool. */
export interface ShotRequest {
  x: number;
  y: number;
}

export type Pose = 'fly' | 'dead';

/**
 * The unicorn: a body with two verbs.
 *
 * Deliberately much simpler than the runner game's player — no ground, so no
 * state machine, no coyote time, no jump-cut. **Jump-cut in particular is
 * actively wrong here**: flappy's impulse is fixed, and its fixedness *is* the
 * mechanic. A variable-height flap turns a rhythm game into a hold-timing game,
 * which is a different (and worse) thing to ask a child to learn.
 *
 * What is kept from the runner is the important part: the arc is solved from
 * the current scroll speed every tick, so the shape it traces through the world
 * never changes as the game speeds up. See FLIGHT in config.ts.
 *
 * This class knows nothing about gates, bombs, difficulty or scoring. It
 * clamps itself to the band and raises one-shot flags; deciding what a
 * boundary touch *costs* is the caller's business.
 */
export class Unicorn {
  /** Vertical centre. Horizontal position is the constant PLAYER_X. */
  y = 0;
  /** Last tick's y, so the renderer can interpolate. */
  prevY = 0;
  vy = 0;

  pose: Pose = 'fly';
  hp = 1;
  invulnTimer = 0;
  shotTimer = 0;

  /** Visual only: the body pitches toward its direction of travel. */
  tilt = 0;

  /** One-shot flags, read and cleared by the caller each tick. */
  justFlapped = false;
  justHitCeiling = false;
  justHitFloor = false;

  get invulnerable(): boolean {
    return this.invulnTimer > 0;
  }

  get dead(): boolean {
    return this.pose === 'dead';
  }

  get canShoot(): boolean {
    return this.shotTimer <= 0 && !this.dead;
  }

  reset(hearts: number): void {
    this.y = (CEILING_Y + FLOOR_Y) / 2;
    this.prevY = this.y;
    this.vy = 0;
    this.pose = 'fly';
    this.hp = hearts;
    this.invulnTimer = 0;
    this.shotTimer = 0;
    this.tilt = 0;
    this.justFlapped = false;
    this.justHitCeiling = false;
    this.justHitFloor = false;
  }

  /**
   * Advance one fixed step.
   *
   * @returns a shot to spawn, or null. Returned rather than written into a
   * pool so the unicorn has no dependency on the rest of the world — the same
   * boundary that lets the dev harness drive it in isolation.
   */
  update(dt: number, input: Input, scrollSpeed: number): ShotRequest | null {
    this.prevY = this.y;
    this.justFlapped = false;
    this.justHitCeiling = false;
    this.justHitFloor = false;

    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (this.shotTimer > 0) this.shotTimer = Math.max(0, this.shotTimer - dt);

    const gravity = gravityAt(scrollSpeed);

    if (this.dead) {
      // No clamps and no input: the corpse arcs up and falls off the bottom of
      // the screen, which is what actually ends the run. The runner game
      // learned that stopping the body at the floor leaves the game-over
      // screen unreachable if the death happened while resting on it.
      this.vy += gravity * dt;
      this.y += this.vy * dt;
      this.tilt = Math.min(FLIGHT.tiltDown * 2, this.tilt + dt * 4);
      return null;
    }

    // Buffered rather than edge-read, so a flap pressed slightly early lands.
    if (input.consume('fly')) {
      this.vy = -flapVelocityAt(scrollSpeed);
      this.justFlapped = true;
    }

    this.vy = Math.min(this.vy + gravity * dt, terminalVyAt(scrollSpeed));
    this.y += this.vy * dt;

    this.clampToBand(scrollSpeed);

    // Tilt chases the velocity slope rather than the velocity itself, so the
    // body sits at the same angle for the same *shape* of arc at every speed.
    const slope = this.vy / Math.max(arcSpeedAt(scrollSpeed), 1);
    const target = Math.max(FLIGHT.tiltUp, Math.min(FLIGHT.tiltDown, slope * 0.5));
    this.tilt += (target - this.tilt) * Math.min(1, FLIGHT.tiltLerp * dt);

    let shot: ShotRequest | null = null;
    if (input.consume('magic') && this.canShoot) {
      this.shotTimer = SHOT.cooldown;
      shot = { x: PLAYER_X + UNICORN.muzzleX, y: this.y - SHOT.height / 2 };
    }

    return shot;
  }

  /**
   * Keep the body inside the band, bouncing off whichever surface it met.
   *
   * The bounce is not decoration. Without it a player pinned against the floor
   * takes a hit, gets i-frames, and is still against the floor when they end —
   * so the same surface eats every heart in under two seconds. The kick buys
   * enough altitude to react. See design contract 8.
   */
  private clampToBand(scrollSpeed: number): void {
    const half = UNICORN.height / 2;
    const kick = FLIGHT.boundaryBounceSlope * arcSpeedAt(scrollSpeed);

    if (this.y - half < CEILING_Y) {
      this.y = CEILING_Y + half;
      this.vy = kick;
      this.justHitCeiling = true;
    } else if (this.y + half > FLOOR_Y) {
      this.y = FLOOR_Y - half;
      this.vy = -kick;
      this.justHitFloor = true;
    }
  }

  /**
   * Spend a heart.
   *
   * @returns false if the hit was refused (already invulnerable, or already
   * dead), so the caller knows not to play an impact for it.
   */
  takeHit(scrollSpeed: number): boolean {
    if (this.invulnerable || this.dead) return false;
    this.hp -= 1;
    this.invulnTimer = UNICORN.invulnDuration;
    if (this.hp <= 0) {
      this.pose = 'dead';
      this.vy = -FLIGHT.deathPopSlope * arcSpeedAt(scrollSpeed);
    }
    return true;
  }

  /** True once the corpse has cleared the frame and the run can end. */
  get fallenOffScreen(): boolean {
    return this.dead && this.y - UNICORN.height / 2 > FLOOR_Y + 60;
  }

  /** The drawn box, interpolated for rendering. */
  bounds(out: Aabb, interpolation = 1): Aabb {
    const y = this.prevY + (this.y - this.prevY) * interpolation;
    out.x = PLAYER_X;
    out.y = y - UNICORN.height / 2;
    out.w = UNICORN.width;
    out.h = UNICORN.height;
    return out;
  }

  /** The box that can actually be killed. Always smaller than the drawn one. */
  hurtbox(out: Aabb): Aabb {
    out.x = PLAYER_X + UNICORN.hurtboxInsetX;
    out.y = this.y - UNICORN.height / 2 + UNICORN.hurtboxInsetY;
    out.w = UNICORN.width - 2 * UNICORN.hurtboxInsetX;
    out.h = UNICORN.height - 2 * UNICORN.hurtboxInsetY;
    return out;
  }
}
