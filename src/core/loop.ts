import { FIXED_DT, MAX_FRAME_TIME } from '../game/config';

/**
 * Fixed-timestep game loop with a render accumulator.
 *
 * Why not just `update(deltaTime)` on every animation frame? Because physics
 * that advances by a variable dt produces a different result at 60Hz than at
 * 120Hz — jump heights change with refresh rate, and collisions get tunnelled
 * through on slow frames. Android phones range from 60Hz to 144Hz, so this
 * matters in practice, not just in theory.
 *
 * Instead: accumulate real elapsed time, and step the simulation in exact
 * FIXED_DT increments as many times as fit. Leftover time becomes `alpha`, the
 * 0..1 fraction the renderer uses to interpolate between the previous and
 * current simulation states, so motion still looks smooth on any display.
 *
 * ## Drawing at most 60 times a second
 *
 * "Every time she plays on my phone my phone definitely gets hot." Drawing is
 * nearly all of a frame's cost, and a 90 or 120Hz phone asks for a frame up to
 * twice as often as these games need. So the simulation still steps on every
 * animation frame, but a picture is drawn only when 1/60 s of drawing time has
 * built up: every frame at 60Hz, two in three at 90Hz, every other one at
 * 120Hz. Steady 60 frames a second whatever the screen, and half the work on
 * the fastest ones. The same file is in every game in the set.
 */
export interface LoopCallbacks {
  update(dt: number): void;
  render(alpha: number): void;
}

/** Seconds between pictures, and how early one may come, so a 60Hz screen's jitter never skips one. */
const RENDER_EVERY = 1 / 60;
const RENDER_SLACK = 0.002;

export function startLoop({ update, render }: LoopCallbacks): () => void {
  let lastTime = performance.now() / 1000;
  let accumulator = 0;
  let renderClock = RENDER_EVERY;
  let frameHandle = 0;
  let running = true;

  const frame = (nowMs: number) => {
    if (!running) return;
    frameHandle = requestAnimationFrame(frame);

    const now = nowMs / 1000;
    // Clamp: after a backgrounded tab or a long hitch, don't try to simulate
    // the missing minutes. Better to drop time than to lock up catching up.
    const frameTime = Math.min(now - lastTime, MAX_FRAME_TIME);
    lastTime = now;
    accumulator += frameTime;

    while (accumulator >= FIXED_DT) {
      update(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    renderClock += frameTime;
    if (renderClock < RENDER_EVERY - RENDER_SLACK) return;
    // Keep the remainder (so 90Hz evens out to 60), but never bank more than a frame.
    renderClock = Math.max(-RENDER_SLACK, Math.min(renderClock - RENDER_EVERY, RENDER_EVERY));
    render(accumulator / FIXED_DT);
  };

  frameHandle = requestAnimationFrame(frame);

  // Dev only: lets the console time a frame's drawing directly (`__loop.render(0)`),
  // even in a hidden tab where animation frames never arrive.
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__loop = { update, render };

  return () => {
    running = false;
    cancelAnimationFrame(frameHandle);
  };
}
