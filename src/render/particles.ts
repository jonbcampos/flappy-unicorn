import { FLOOR_Y } from '../game/config';
import { PALETTE, alpha } from './palette';

/**
 * Pooled particle system.
 *
 * Particles exist to make cause and effect legible: you can see the magic
 * connect, see the bomb come apart, see the fairy carried away. Without them,
 * hits register as things simply vanishing, and a five-year-old reads vanishing
 * as a glitch rather than as a result.
 *
 * Nothing is allocated after construction — same reasoning as every other pool
 * here. A steady drip of short-lived objects is what produces periodic GC
 * hitches, and a hitch during a flap is a heart.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  gravity: number;
  color: string;
  /** World-anchored particles scroll with the level; sparks fly free. */
  anchored: boolean;
  active: boolean;
}

const POOL_SIZE = 140;

export class Particles {
  private pool: Particle[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push({
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 1, gravity: 0,
        color: PALETTE.shot, anchored: false, active: false,
      });
    }
  }

  /**
   * Take the next slot, recycling the oldest if the pool is full.
   * Overwriting beats dropping: a missing burst is more noticeable than one
   * that ends a few milliseconds early.
   */
  private take(): Particle {
    const particle = this.pool[this.cursor]!;
    this.cursor = (this.cursor + 1) % POOL_SIZE;
    return particle;
  }

  private spawn(
    x: number, y: number, vx: number, vy: number,
    life: number, size: number, color: string,
    gravity: number, anchored: boolean,
  ): void {
    const p = this.take();
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.maxLife = life; p.size = size;
    p.color = color; p.gravity = gravity; p.anchored = anchored;
    p.active = true;
  }

  /** Magic fizzling out against a rainbow column. */
  shotFizzle(x: number, y: number, random: () => number): void {
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI + (random() - 0.5) * 1.6;
      const speed = 40 + random() * 70;
      this.spawn(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
        0.16 + random() * 0.1, 2, PALETTE.shot, 200, false);
    }
  }

  /** A bomb coming apart: hot sparks plus slower tumbling debris. */
  bombBlast(x: number, y: number, random: () => number): void {
    for (let i = 0; i < 14; i++) {
      const angle = random() * Math.PI * 2;
      const speed = 60 + random() * 170;
      this.spawn(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
        0.3 + random() * 0.3, 2 + Math.floor(random() * 2),
        random() < 0.5 ? PALETTE.bombSpark : PALETTE.bomb, 320, false);
    }
    for (let i = 0; i < 5; i++) {
      const angle = random() * Math.PI * 2;
      this.spawn(x, y, Math.cos(angle) * 40, Math.sin(angle) * 40 - 30,
        0.5 + random() * 0.3, 3, PALETTE.bombShade, 200, false);
    }
  }

  /**
   * A rescue: gold sparkles rising.
   *
   * Deliberately the opposite motion to a blast — upward and slow rather than
   * outward and fast. Two things happening at the same moment must never look
   * alike when one is a reward and the other is a hazard being removed.
   */
  fairySave(x: number, y: number, random: () => number): void {
    for (let i = 0; i < 12; i++) {
      this.spawn(x + (random() - 0.5) * 12, y + (random() - 0.5) * 12,
        (random() - 0.5) * 40, -50 - random() * 70,
        0.5 + random() * 0.35, 2,
        random() < 0.5 ? PALETTE.fairyHalo : PALETTE.fairy, -30, false);
    }
  }

  /** Feathers and sparks when the unicorn is hit. */
  playerHit(x: number, y: number, random: () => number): void {
    for (let i = 0; i < 16; i++) {
      const angle = random() * Math.PI * 2;
      const speed = 70 + random() * 170;
      this.spawn(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
        0.4 + random() * 0.4, 2 + Math.floor(random() * 3),
        random() < 0.6 ? PALETTE.mane : PALETTE.player, 340, false);
    }
  }

  /** A puff of cloud as a gate is cleared. Anchored, so it drifts with the world. */
  gateShimmer(x: number, y: number, random: () => number): void {
    for (let i = 0; i < 5; i++) {
      this.spawn(x, y + (random() - 0.5) * 20,
        (random() - 0.5) * 30, -20 - random() * 30,
        0.3 + random() * 0.2, 2, PALETTE.gateLip, -20, true);
    }
  }

  update(dt: number, scrollSpeed: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.anchored) p.x -= scrollSpeed * dt;
      // Anchored particles skid along the meadow rather than falling through it.
      if (p.anchored && p.y > FLOOR_Y) {
        p.y = FLOOR_Y;
        p.vy *= -0.3;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      // Fade out over the particle's life so nothing pops out of existence.
      const fade = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = alpha(p.color, fade);
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
  }

  reset(): void {
    for (const p of this.pool) p.active = false;
  }
}
