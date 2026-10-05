import { FLOOR_Y } from '../game/config';
import { PALETTE, alpha } from './palette';

/**
 * Pooled particle system.
 *
 * Particles exist to make cause and effect legible: you can see the magic
 * connect, see the bomb fizzle away, see the fairy carried off cheering.
 * Without them, hits register as things simply vanishing, and a five-year-old
 * reads vanishing as a glitch rather than as a result.
 *
 * Nothing is allocated after construction — same reasoning as every other pool
 * here. A steady drip of short-lived objects is what produces periodic GC
 * hitches, and a hitch during a flap is a heart.
 *
 * Shapes, not just squares (DECISIONS.md 26): twinkling four-point stars for
 * magic, tumbling confetti for a fizzled bomb, little hearts for a rescue, and
 * painted sprites (a flipbook or a single frame) when the art is there. The
 * motion rule is unchanged: rewards rise slowly, hazards scatter fast.
 */

enum Shape {
  Square,
  Star,
  Heart,
  Confetti,
  Sprite,
}

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
  shape: Shape;
  rot: number;
  spin: number;
  /** For sprites: one frame, or a flipbook played across the particle's life. */
  frames: readonly HTMLCanvasElement[] | null;
  /** World-anchored particles scroll with the level; sparks fly free. */
  anchored: boolean;
  active: boolean;
}

const POOL_SIZE = 280;

export class Particles {
  private pool: Particle[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push({
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 1, gravity: 0,
        color: PALETTE.shot, shape: Shape.Square, rot: 0, spin: 0, frames: null,
        anchored: false, active: false,
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
    gravity: number, anchored: boolean, shape: Shape = Shape.Square,
  ): Particle {
    const p = this.take();
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.maxLife = life; p.size = size;
    p.color = color; p.gravity = gravity; p.anchored = anchored;
    p.shape = shape; p.rot = 0; p.spin = 0; p.frames = null;
    p.active = true;
    return p;
  }

  /** Magic fizzling out against a rainbow column. */
  shotFizzle(x: number, y: number, random: () => number): void {
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI + (random() - 0.5) * 1.6;
      const speed = 40 + random() * 70;
      this.spawn(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
        0.16 + random() * 0.1, 2, PALETTE.shot, 200, false);
    }
    this.spawn(x, y, -20, -10, 0.25, 3, PALETTE.shotCore, 0, false, Shape.Star);
  }

  /**
   * A zapped bomb: it fizzles into confetti. Nobody is hurt, so this is a
   * party popper, not a blast: bright tumbling confetti and twinkles, plus the
   * painted fizzle flipbook when there is one.
   */
  bombZap(x: number, y: number, random: () => number, fizzle: readonly HTMLCanvasElement[] | null): void {
    const band = PALETTE.gateBand;
    for (let i = 0; i < 18; i++) {
      const angle = random() * Math.PI * 2;
      const speed = 50 + random() * 120;
      const p = this.spawn(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed - 40,
        0.7 + random() * 0.5, 2 + random() * 1.5, band[i % band.length]!, 160, true, Shape.Confetti);
      p.rot = random() * Math.PI;
      p.spin = (random() - 0.5) * 18;
    }
    for (let i = 0; i < 6; i++) {
      const angle = random() * Math.PI * 2;
      this.spawn(x + Math.cos(angle) * 8, y + Math.sin(angle) * 8, Math.cos(angle) * 30, Math.sin(angle) * 30 - 20,
        0.45 + random() * 0.3, 3 + random() * 2, PALETTE.shot, -20, true, Shape.Star);
    }
    for (let i = 0; i < 6; i++) {
      const angle = random() * Math.PI * 2;
      const speed = 80 + random() * 120;
      this.spawn(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
        0.25 + random() * 0.2, 2, PALETTE.bombSpark, 280, false);
    }
    if (fizzle) this.flipbook(fizzle, x, y, 0.55, 34);
  }

  /** A bomb that the unicorn bumped into: a soft puff and a few sparks. */
  bombBlast(x: number, y: number, random: () => number, fizzle: readonly HTMLCanvasElement[] | null): void {
    for (let i = 0; i < 12; i++) {
      const angle = random() * Math.PI * 2;
      const speed = 60 + random() * 150;
      this.spawn(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
        0.3 + random() * 0.3, 2 + Math.floor(random() * 2),
        random() < 0.5 ? PALETTE.bombSpark : PALETTE.bombShade, 320, false);
    }
    if (fizzle) this.flipbook(fizzle.slice(1), x, y, 0.45, 26);
  }

  /**
   * A rescue: gold sparkles rising, a few hearts, and the one you saved floating
   * up cheering (when the art is there).
   *
   * Deliberately the opposite motion to a blast — upward and slow rather than
   * outward and fast. Two things happening at the same moment must never look
   * alike when one is a reward and the other is a hazard being removed.
   */
  fairySave(x: number, y: number, random: () => number, cheer: HTMLCanvasElement | null): void {
    for (let i = 0; i < 12; i++) {
      this.spawn(x + (random() - 0.5) * 12, y + (random() - 0.5) * 12,
        (random() - 0.5) * 40, -50 - random() * 70,
        0.5 + random() * 0.35, 2,
        random() < 0.5 ? PALETTE.fairyHalo : PALETTE.fairy, -30, false);
    }
    for (let i = 0; i < 7; i++) {
      this.spawn(x + (random() - 0.5) * 22, y + (random() - 0.5) * 18,
        (random() - 0.5) * 30, -30 - random() * 40,
        0.6 + random() * 0.4, 3 + random() * 2.5, random() < 0.5 ? PALETTE.shotCore : PALETTE.shot, -10, false, Shape.Star);
    }
    for (let i = 0; i < 4; i++) {
      const p = this.spawn(x + (random() - 0.5) * 16, y - 4,
        (random() - 0.5) * 36, -40 - random() * 30,
        0.9 + random() * 0.3, 4, PALETTE.heart, -15, false, Shape.Heart);
      p.spin = (random() - 0.5) * 2;
    }
    if (cheer) {
      const p = this.spawn(x, y, -20, -38, 0.9, 22, '#ffffff', -10, false, Shape.Sprite);
      p.frames = [cheer];
    }
  }

  /** Bits of mane, and a ring of dizzy stars, when the unicorn is bumped. */
  playerHit(x: number, y: number, random: () => number): void {
    for (let i = 0; i < 14; i++) {
      const angle = random() * Math.PI * 2;
      const speed = 70 + random() * 170;
      this.spawn(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
        0.4 + random() * 0.4, 2 + Math.floor(random() * 3),
        random() < 0.6 ? PALETTE.mane : PALETTE.player, 340, false);
    }
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      this.spawn(x + Math.cos(angle) * 10, y - 8 + Math.sin(angle) * 4,
        Math.cos(angle) * 25, -25, 0.7, 4, PALETTE.shot, 0, false, Shape.Star);
    }
  }

  /** A puff of glitter as a gate is cleared. Anchored, so it drifts with the world. */
  gateShimmer(x: number, y: number, random: () => number): void {
    for (let i = 0; i < 5; i++) {
      this.spawn(x, y + (random() - 0.5) * 20,
        (random() - 0.5) * 30, -20 - random() * 30,
        0.3 + random() * 0.2, 2, PALETTE.gateLip, -20, true);
    }
    for (let i = 0; i < 2; i++) {
      this.spawn(x + (random() - 0.5) * 8, y + (random() - 0.5) * 30, 0, -15,
        0.5, 3 + random() * 2, PALETTE.gateLip, 0, true, Shape.Star);
    }
  }

  /** Twinkles shed behind the unicorn as it flies. Anchored, so they stream away. */
  trail(x: number, y: number, random: () => number): void {
    const band = PALETTE.gateBand;
    this.spawn(x + (random() - 0.5) * 6, y + (random() - 0.5) * 8,
      -10 - random() * 20, (random() - 0.5) * 12,
      0.45 + random() * 0.3, 1.5 + random() * 2, random() < 0.4 ? PALETTE.shotCore : band[Math.floor(random() * band.length)]!,
      0, true, Shape.Star);
  }

  /** A painted flipbook, played once over `life` seconds, drifting with the world. */
  private flipbook(frames: readonly HTMLCanvasElement[], x: number, y: number, life: number, size: number): void {
    if (frames.length === 0) return;
    const p = this.spawn(x, y, 0, -12, life, size, '#ffffff', 0, true, Shape.Sprite);
    p.frames = frames;
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
      p.rot += p.spin * dt;
      if (p.shape === Shape.Confetti) {
        // Confetti flutters: air drag, so it drifts down rather than drops.
        p.vx *= 1 - 2.2 * dt;
        p.vy *= 1 - 1.6 * dt;
      }
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
      switch (p.shape) {
        case Shape.Square:
          ctx.fillStyle = alpha(p.color, fade);
          ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
          break;
        case Shape.Star:
          drawStar(ctx, p.x, p.y, p.size * (0.6 + 0.4 * Math.sin(fade * 9)), p.color, fade);
          break;
        case Shape.Heart:
          drawHeart(ctx, p.x, p.y, p.size, p.color, Math.min(1, fade * 2));
          break;
        case Shape.Confetti: {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          // A spinning strip foreshortens as it turns: that's what makes it read
          // as paper and not as a square.
          ctx.scale(1, Math.abs(Math.cos(p.rot * 1.7)) * 0.8 + 0.2);
          ctx.fillStyle = alpha(p.color, Math.min(1, fade * 2.5));
          ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
          ctx.restore();
          break;
        }
        case Shape.Sprite: {
          const frames = p.frames;
          if (!frames || frames.length === 0) break;
          const t = 1 - fade;
          const frame = frames[Math.min(frames.length - 1, Math.floor(t * frames.length))]!;
          const scale = frames.length > 1 ? 1 : 1 + 0.15 * Math.sin(t * Math.PI);
          const h = p.size * scale;
          const w = (h * frame.width) / frame.height;
          ctx.save();
          ctx.globalAlpha = frames.length > 1 ? Math.min(1, fade * 3) : Math.min(1, fade * 1.6);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(frame, p.x - w / 2, p.y - h / 2, w, h);
          ctx.restore();
          break;
        }
      }
    }
  }

  reset(): void {
    for (const p of this.pool) p.active = false;
  }
}

/** A four-point twinkle: two thin crossed diamonds and a bright centre. */
export function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a: number): void {
  if (r <= 0.3 || a <= 0) return;
  ctx.fillStyle = alpha(color, a);
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.28, y - r * 0.28);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + r * 0.28, y + r * 0.28);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.28, y + r * 0.28);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - r * 0.28, y - r * 0.28);
  ctx.closePath();
  ctx.fill();
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, a: number): void {
  ctx.fillStyle = alpha(color, a);
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s, x, y - s * 0.3);
  ctx.bezierCurveTo(x + s * 0.6, y - s, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
  ctx.fill();
}
