import type { Aabb } from './collision';
import { FAIRY } from './config';

export type FairyKind = 'fairy' | 'person';

/**
 * Fairies and people: the thing you're flying *toward*.
 *
 * Every other object in the game is something to avoid, and a game made
 * entirely of avoidance is a game about not losing. These are the only reason
 * to take a risk, and they're the half of the brief that came from Ellie
 * directly — the magic saves people.
 *
 * Three rules keep them a reward rather than another hazard:
 *  - Touching one is *never* punished. It scores, just less than shooting one.
 *  - Their boxes are inflated rather than inset, so a near-miss counts.
 *  - Missing one entirely costs nothing at all. No penalty, ever.
 */
export interface Fairy {
  x: number;
  prevX: number;
  baseY: number;
  y: number;
  prevY: number;
  phase: number;
  kind: FairyKind;
  saved: boolean;
  /** Counts down while the rescue sparkle plays. */
  deathTimer: number;
  active: boolean;
}

export class FairyField {
  readonly items: Fairy[] = [];

  constructor() {
    for (let i = 0; i < FAIRY.poolSize; i++) {
      this.items.push({
        x: 0, prevX: 0, baseY: 0, y: 0, prevY: 0,
        phase: 0, kind: 'fairy', saved: false, deathTimer: 0, active: false,
      });
    }
  }

  spawn(x: number, y: number, kind: FairyKind, phase: number): Fairy | null {
    const item = this.items.find((f) => !f.active);
    if (!item) return null;
    item.x = x;
    item.prevX = x;
    item.baseY = y;
    item.y = y;
    item.prevY = y;
    item.phase = phase;
    item.kind = kind;
    item.saved = false;
    item.deathTimer = 0;
    item.active = true;
    return item;
  }

  /**
   * @returns the number that drifted off the left edge unsaved this tick, so
   * the caller can wave them goodbye. Not a penalty — just an acknowledgement
   * that something was there.
   */
  update(dt: number, scrollSpeed: number, elapsed: number): number {
    let missed = 0;
    for (const item of this.items) {
      if (!item.active) continue;
      item.prevX = item.x;
      item.prevY = item.y;
      item.x -= scrollSpeed * dt;
      item.y = item.baseY + Math.sin(elapsed * FAIRY.bobRate + item.phase) * FAIRY.bobAmplitude;

      if (item.deathTimer > 0) {
        item.deathTimer -= dt;
        if (item.deathTimer <= 0) item.active = false;
        continue;
      }
      if (item.x + FAIRY.width < -8) {
        item.active = false;
        missed++;
      }
    }
    return missed;
  }

  save(item: Fairy): void {
    item.saved = true;
    item.deathTimer = FAIRY.deathTime;
  }

  reset(): void {
    for (const item of this.items) item.active = false;
  }

  static isRescuable(item: Fairy): boolean {
    return item.active && !item.saved;
  }

  /**
   * The rescue box, inflated by `pad`.
   *
   * Callers pass `FAIRY.touchPad` for flying into one and `FAIRY.shotboxPad`
   * for hitting one with magic. Both are bigger than the sprite, which is the
   * exact opposite of how every hazard box in the game is built.
   */
  static box(item: Fairy, pad: number, out: Aabb): Aabb {
    out.x = item.x - FAIRY.width / 2 - pad;
    out.y = item.y - FAIRY.height / 2 - pad;
    out.w = FAIRY.width + pad * 2;
    out.h = FAIRY.height + pad * 2;
    return out;
  }
}
