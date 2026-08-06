import type { GameState } from '../game/state';
import type { Input } from '../core/input';
import type { Particles } from './particles';

/**
 * Everything the game knows how to draw, behind one interface.
 *
 * `src/game/` never imports from `src/render/` — the simulation has no idea how
 * it looks. That separation is the whole reason swapping this neon renderer for
 * the planned 16-bit pixel one is a contained job rather than a rewrite: the
 * pixel version is a second implementation of this interface, and the game
 * logic doesn't change by a line.
 */
export interface Renderer {
  draw(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    input: Input,
    alpha: number,
    particles: Particles,
  ): void;
}
