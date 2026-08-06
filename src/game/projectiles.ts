import { SHOT, SCREEN } from './config';
import type { Aabb } from './collision';

export interface Shot {
  x: number;
  y: number;
  prevX: number;
  /** Distance covered so far, so the shot can expire at its range limit. */
  travelled: number;
  active: boolean;
}

/**
 * Fixed-size pool of magic shots.
 *
 * Nothing here is allocated after startup. Allocating a projectile per shot and
 * letting it fall out of scope hands the garbage collector a steady drip of
 * work, which surfaces as a periodic frame hitch. On a mid-range Android phone
 * that hitch is exactly long enough to make you miss a flap.
 */
export class ShotPool {
  readonly shots: Shot[] = [];

  constructor() {
    for (let i = 0; i < SHOT.poolSize; i++) {
      this.shots.push({ x: 0, y: 0, prevX: 0, travelled: 0, active: false });
    }
  }

  spawn(x: number, y: number): void {
    for (const shot of this.shots) {
      if (shot.active) continue;
      shot.x = x;
      shot.y = y;
      shot.prevX = x;
      shot.travelled = 0;
      shot.active = true;
      return;
    }
    // Pool exhausted. Silently dropping is correct: the pool is sized well
    // above what the cooldown can produce, so this can't happen in normal play.
  }

  update(dt: number): void {
    for (const shot of this.shots) {
      if (!shot.active) continue;
      shot.prevX = shot.x;
      const step = SHOT.speed * dt;
      shot.x += step;
      shot.travelled += step;
      if (shot.travelled >= SHOT.range || shot.x > SCREEN.w + SHOT.width) shot.active = false;
    }
  }

  reset(): void {
    for (const shot of this.shots) shot.active = false;
  }

  static box(shot: Shot, out: Aabb): Aabb {
    out.x = shot.x;
    out.y = shot.y;
    out.w = SHOT.width;
    out.h = SHOT.height;
    return out;
  }
}
