# Flappy Unicorn

Fly a unicorn through rainbow gates with two buttons — **FLY** and **MAGIC**.

Magic does two jobs, and they're the reason there's a second button at all:

| In the sky | What magic does |
| --- | --- |
| **Bomb** (dark, fused, pulsing red) | **Zap it.** +25. Or fly around it — every bomb has both answers. |
| **Fairy or person** (bright, haloed) | **Save them.** +50 shot, +20 if you just fly into them. Never a penalty. |
| **Rainbow gate** | Magic can't pass through one. Thread the gap. +10. |
| **Drifting gate** (chevrons on its lips) | Same, but the gap moves. The chevrons point the way it's going. |

Sister project to [Ellie's Rainbow Run](https://jonbcampos.github.io/runner-game/), and built
the same way: TypeScript, a 2D canvas, no engine, no runtime dependencies.

Ellie rides the unicorn through a painted meadow and a storybook town, the sky turns to sunset as a
run goes on, and there's music, a few short voice lines and a full set of cartoon sound effects.

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

### Six ideas worth knowing before you change anything

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

**5. The world changes as you fly.** Stretches of meadow alternate with a medieval brick town,
keyed to *world distance* rather than to the sector counter — so the boundary scrolls in from the
right and you fly into the town, instead of the scenery swapping between two frames.

**6. A run opens hovering.** Picking a difficulty puts you in a `ready` phase — the world holds
still and nothing can hurt you until you press FLY, and that first press is a real flap, so
starting lifts you rather than dropping you.

### Art and sound sit on top

The art (16 images, Gemini) and the voices and music (Gemini TTS and Lyria) are optional files in
`public/sprites/` and `public/sounds/`. Delete either folder and the game is the procedural one,
still fully readable. See [ART-PLAN.md](ART-PLAN.md) and DECISIONS.md 25–31.

```bash
npm run art          # generate any missing images (needs GEMINI_API_KEY in .env.local)
npm run art:shrink   # resample them to the size the game draws them (macOS sips)
npm run sound        # generate any missing voice lines and music (macOS afconvert)
```

Then `__game.checkArt()` in the console checks every sprite sheet's grid.

Gates are painted as textures clipped to their exact hitbox, and the white lip on every opening
stays procedural: it's how you read the gap. The bomb stays the darkest thing on screen with its
red pulse, the fairy the brightest with her halo.

Sound and music have separate toggles on the title and game-over screens, and both are remembered.

### Verifying it

The fairness guarantees are machine-checkable, because they're the thing most likely to break
silently when someone re-tunes a flap:

```js
__game.verify()   // in the browser console, dev builds only
```

60 trials, run against the **real `GameState`** driven by a fake input — not against the
arithmetic in `config.ts`. They cover gap threading at seven speeds per difficulty, coasting a gap
with no flap at all, gate-to-gate reachability over 300s of the real director, that no bomb ever
lands in the safe corridor, that every blocking bomb is *both* killable and dodgeable, that
fairies are harmless, that one obstacle costs exactly one heart, that you can't lose before the
run starts, that a field of *entirely* drifting gates is still threadable and never swings a
column out of the band, and that the flap arc really is speed-invariant.

`validateDesignContracts()` also runs on every page load and logs to the console if any tuning
number stops satisfying its guarantee.

`__game.tune({ flapRise: 30 })` changes feel live and re-runs all of it, because the feel knobs and
the fairness constraints are the same numbers. `__game.advance(2)` steps the real loop two seconds
and draws it, for screenshots in a tab whose animation frames are throttled.

## Status

Playable and deployed: https://jonbcampos.github.io/flappy-unicorn/

Three difficulties, hearts, rainbow-arch / cloud-tower / brick-gatehouse gates, drifting gates,
meadow and medieval-town biomes, corridor-aware bomb placement, fairy and person rescues,
generated art with parallax and a sunset, Lyria music that changes with the biome, voice lines,
synthesised effects, installable PWA with offline play.
