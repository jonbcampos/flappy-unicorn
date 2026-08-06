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
 */
export interface LoopCallbacks {
  update(dt: number): void;
  render(alpha: number): void;
}

export function startLoop({ update, render }: LoopCallbacks): () => void {
  let lastTime = performance.now() / 1000;
  let accumulator = 0;
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

    render(accumulator / FIXED_DT);
  };

  frameHandle = requestAnimationFrame(frame);

  return () => {
    running = false;
    cancelAnimationFrame(frameHandle);
  };
}
