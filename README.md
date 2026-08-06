# Flappy Unicorn

Fly a unicorn through rainbow gates with two buttons — **FLY** and **MAGIC**.

Magic does two jobs, and they're the reason there's a second button at all:

| In the sky | What magic does |
| --- | --- |
| **Bomb** (dark, fused, pulsing red) | **Zap it.** +25. Or fly around it — every bomb has both answers. |
| **Fairy or person** (bright, haloed) | **Save them.** +50 shot, +20 if you just fly into them. Never a penalty. |
| **Rainbow gate** | Magic can't pass through one. Thread the gap. +10. |

Sister project to [Ellie's Rainbow Run](https://jonbcampos.github.io/runner-game/), and built
the same way: TypeScript, a 2D canvas, no engine, no runtime dependencies.

## Running it

```bash
npm install && npm run dev
```

Open the printed Network URL on a phone to play it on a real touchscreen. On desktop: space/W/↑
to fly, `Z` to shoot.

## Why it's built this way

[DECISIONS.md](DECISIONS.md) is the running log of what we decided and why — read that before
changing anything structural. The short version follows.

- **`src/game/`** — the simulation. Never imports from `src/render/`; it has no idea how it
  looks. Presentation happens by draining an event queue in `main.ts`.
- **`src/game/config.ts`** — every tuning number in the game. Nothing magic lives anywhere else.
- Nothing is allocated after startup. Every entity, particle and event lives in a fixed pool.

### Four ideas worth knowing before you change anything

**1. The loop is fixed-timestep.** Physics advances in exact 1/120s increments regardless of the
display's refresh rate, and the renderer interpolates between steps. Without this, flap heights
literally differ between a 60Hz and a 120Hz phone.

**2. The flap arc is defined in world distance, not time.** Impulse and gravity are re-derived
each tick from the current scroll speed, so the path the unicorn traces *through the world* is
identical at every speed — the apex is always exactly `flapRise`. A gap that's threadable at
140px/s is threadable at 312px/s. What shrinks as you speed up is your time to *read* the gap,
which is the honest difficulty lever. With fixed gravity instead, the arc stretches horizontally
as the run accelerates and gaps that were fair silently stop being reachable.

**3. Nothing spawns on its own timer.** The director emits one gate and, in the same call, fills
the corridor *ahead* of it — the space that's still off-screen. That one rule is what makes a
bomb parked in the only gap unexpressible rather than merely unlikely. It runs a gate ahead of
itself so the space it's filling hasn't scrolled into view yet.

**4. The controls are forgiving on purpose.** Input buffering, hurtboxes inset inside the visible
sprites, i-frames after a hit, and a FLY hit region covering the whole right half of the screen.
A five-year-old cannot reliably land a 30px circle while panicking, and unlike a missed shot, a
missed flap costs a heart.

### Verifying it

The fairness guarantees are machine-checkable, because they're the thing most likely to break
silently when someone re-tunes a flap:

```js
__game.verify()   // in the browser console, dev builds only
```

50 trials, run against the **real `GameState`** driven by a fake input — not against the
arithmetic in `config.ts`. They cover gap threading at seven speeds per difficulty, coasting a gap
with no flap at all, gate-to-gate reachability over 300s of the real director, that no bomb ever
lands in the safe corridor, that every blocking bomb is *both* killable and dodgeable, that
fairies are harmless, that one obstacle costs exactly one heart, and that the flap arc really is
speed-invariant.

`validateDesignContracts()` also runs on every page load and logs to the console if any tuning
number stops satisfying its guarantee.

`__game.tune({ flapRise: 30 })` changes feel live and re-runs all of it, because the feel knobs and
the fairness constraints are the same numbers.

## Status

Playable and deployed: https://jonbcampos.github.io/flappy-unicorn/

Three difficulties, hearts, rainbow-arch and cloud-tower gates, corridor-aware bomb placement,
fairy and person rescues, synthesized audio, installable PWA with offline play.
