import type { Renderer } from './renderer';
import { drawBackground, drawCeiling, drawFloor } from './sky';
import { drawBombs, drawFairies, drawGates, drawShots, drawUnicorn } from './rainbow';
import { drawHud, drawPopups } from '../ui/hud';
import { drawScreens } from '../ui/screens';
import { drawTouchpad } from '../ui/touchpad';

/**
 * Draws a frame.
 *
 * The layer order lives here rather than inside any drawing module, because
 * it's a rule about the *game* and not about how it looks. Three orderings in
 * particular are load-bearing:
 *
 *  - **Bombs behind gates**, so a bomb can never visually occlude a gap lip.
 *    The lip is how the player judges the opening; nothing may cover it.
 *  - **Fairies behind the unicorn**, so a rescue reads as flying through
 *    something rather than bumping into it.
 *  - **The HUD and controls outside the screenshake**, so the buttons never
 *    move under a thumb that's already committed to pressing them.
 */
export const sceneRenderer: Renderer = {
  draw(ctx, state, input, interpolation, particles) {
    ctx.save();

    if (state.shake > 0.05) {
      const angle = state.elapsed * 90;
      ctx.translate(Math.sin(angle) * state.shake, Math.cos(angle * 1.7) * state.shake * 0.6);
    }

    drawBackground(ctx, state.distance);
    drawBombs(ctx, state, interpolation);
    drawGates(ctx, state, interpolation);
    drawFairies(ctx, state, interpolation);
    drawShots(ctx, state, interpolation);
    drawUnicorn(ctx, state, interpolation);
    particles.draw(ctx);
    // The band surfaces draw last within the world layer: they are hazards, and
    // nothing may appear to pass in front of a surface that will kill you.
    drawCeiling(ctx, state.distance);
    drawFloor(ctx, state.distance);
    drawPopups(ctx);

    ctx.restore();

    drawHud(ctx, state);
    if (state.phase === 'playing') drawTouchpad(ctx, input);
    drawScreens(ctx, state);
  },
};
