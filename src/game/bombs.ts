import type { Aabb } from './collision';
import { BOMB } from './config';

/**
 * Floating bombs: the thing MAGIC is for.
 *
 * A bomb has two answers — destroy it, or fly around it — and the director
 * guarantees both are available for every one it places (see director.ts).
 * That's deliberate: a hazard with exactly one answer turns into a reflex test,
 * and a hazard with none is a bug the player experiences as unfairness.
 *
 * `baseY` and the bob are kept separate so placement reasoning stays about a
 * fixed altitude while the thing still looks alive on screen. The bob amplitude
 * is small enough to be inside the clearance margins the director works with.
 */
export interface Bomb {
  x: number;
  prevX: number;
  baseY: number;
  y: number;
  prevY: number;
  /** Phase offset so a row of bombs doesn't bob in lockstep. */
  phase: number;
  blocking: boolean;
  hp: number;
  /** Counts down while the blast plays; the bomb is harmless during it. */
  deathTimer: number;
  active: boolean;
}

export class BombField {
  readonly items: Bomb[] = [];

  constructor() {
    for (let i = 0; i < BOMB.poolSize; i++) {
      this.items.push({
        x: 0, prevX: 0, baseY: 0, y: 0, prevY: 0,
        phase: 0, blocking: false, hp: BOMB.hp, deathTimer: 0, active: false,
      });
    }
  }

  spawn(x: number, y: number, blocking: boolean, phase: number): Bomb | null {
    const item = this.items.find((b) => !b.active);
    if (!item) return null;
    item.x = x;
    item.prevX = x;
    item.baseY = y;
    item.y = y;
    item.prevY = y;
    item.phase = phase;
    item.blocking = blocking;
    item.hp = BOMB.hp;
    item.deathTimer = 0;
    item.active = true;
    return item;
  }

  update(dt: number, scrollSpeed: number, elapsed: number): void {
    for (const item of this.items) {
      if (!item.active) continue;
      item.prevX = item.x;
      item.prevY = item.y;
      item.x -= scrollSpeed * dt;
      item.y = item.baseY + Math.sin(elapsed * BOMB.bobRate + item.phase) * BOMB.bobAmplitude;

      if (item.deathTimer > 0) {
        item.deathTimer -= dt;
        if (item.deathTimer <= 0) item.active = false;
        continue;
      }
      if (item.x + BOMB.width < -8) item.active = false;
    }
  }

  /** Detonate. Kept as a method so the death timer is set in exactly one place. */
  kill(item: Bomb): void {
    item.hp = 0;
    item.deathTimer = BOMB.deathTime;
  }

  reset(): void {
    for (const item of this.items) item.active = false;
  }

  /** Live and able to hurt you. A bomb mid-blast is neither. */
  static isHazardous(item: Bomb): boolean {
    return item.active && item.deathTimer <= 0;
  }

  static box(item: Bomb, out: Aabb): Aabb {
    out.x = item.x - BOMB.width / 2;
    out.y = item.y - BOMB.height / 2;
    out.w = BOMB.width;
    out.h = BOMB.height;
    return out;
  }
}
