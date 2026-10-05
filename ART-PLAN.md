# Art plan: painted sprites, parallax, and sound

Generated art for *Flappy Unicorn*, using the Gemini pipeline that tower-defense found and
slingshot extended. Read slingshot's ART-PLAN.md and tower-defense's decisions 20, 22, 26–28, 41,
57, 61 and 65 first. Almost every rule below is one of those lessons, applied here.

## What carries over unchanged

- **Art sits on top and never replaces anything.** `sprite(id)` returns null and the procedural
  painter runs. With `public/sprites/` deleted the game must still be *readable*. The simulation,
  the design contracts and `__game.verify()` never see the art.
- **One shared style paragraph, one sentence of subject per piece.**
- **One character = one image with all of its poses.** Never two calls for one character.
- **Grids are stated as a count**, loudly, and `checkArt()` must pass after every run.
- **Pose sheets face RIGHT.** That's where the unicorn flies anyway, so nothing is mirrored.
- **Flat #00FF00 key**, flooded from the edges plus the second flood for enclosed holes. Pieces
  that are green themselves (hills, grass) go on **magenta** instead.
- **Generate large, shrink with `npm run art:shrink`** to about 4× the drawn size.
- **Game state stays hand-drawn on top**: the white gap lips, drift chevrons, the bomb's red
  pulse, the fairy halo ring, the shot sparkle, the HUD.

## What's particular to this game

### F1. The gap is the lip, and the lip is still procedural

The 3 px white lip on each gate opening *is* the hitbox, and it is how a five-year-old judges
"how much room do I have" thirty times a second. Painted gates are therefore **textures clipped
to the exact column rectangle**, never stickers: a vertical 3-slice (cap at the opening end, the
middle tiled, mirrored every other copy so the seam hides), clipped with `ctx.clip()` to the
column's box, and the procedural lip drawn over it. A painted gate can't be a pixel wider or
longer than its hitbox, by construction.

### F2. Bombs stay the darkest thing on screen, fairies the brightest

The bomb is prompted as a **near-black navy** ball with a fuse; the red pulse ring and the spark
stay procedural on top so "dark, fused, pulsing red" survives any painting. Fairies keep their
procedural amber halo ring behind the art. If either painting ever reads the other way (a pale
bomb, a dull fairy), the procedural version wins: the rule outranks the art.

### F3. A zapped bomb fizzles into confetti

Nobody is hurt. The bomb sheet's second row is a fizzle: surprised, a puff, a puff full of
confetti and stars, a few last pieces. It plays as a little flipbook where the bomb was, drifting
with the world, over the procedural sparks.

### F4. Ellie rides the unicorn

The voice lines are Ellie's, so she's on the unicorn's back, in tower-defense's exact look. The
hurtbox doesn't change (16×10 on the unicorn's barrel); the art is fitted to the unicorn's body,
and Ellie sits above it. That's the forgiving direction (a near miss looks like a near miss),
which is the same deal the horn and mane already have.

### F5. Nothing in the background may look like a gate, a bomb or a fairy

Inherited from DECISIONS.md 14. The backdrops are side-on, hazy and pale; there are no rainbows,
no round dark things, no little winged things, and buildings stay below the middle of the band.

## The requests (16 images)

| id | grid | aspect | key | What |
| --- | --- | --- | --- | --- |
| `unicorn.motion` | 4×2 | 16:9 | green | Ellie riding the unicorn. Row 1: flap cycle (glide, wings up, wings mid, wings down). Row 2: zap (horn glowing, Ellie pointing), oops (startled, holding on tight), cheer (Ellie's arm up), dizzy (swirly eyes, for game over). |
| `fairy.motion` | 2×2 | 1:1 | green | A tiny glowing fairy: wings up, wings down, waving "help!", cheering (saved). |
| `kid.motion` | 2×2 | 1:1 | green | A small child in blue on a little cloud: waving, waving harder, reaching up, cheering (saved). |
| `bomb.motion` | 4×2 | 16:9 | green | Row 1: a grumpy near-black cartoon bomb, fuse at four spark states. Row 2: fizzle into confetti. |
| `gate.arch` | still | 9:16 | green | One tall rainbow-striped pillar, decorative rounded cap at the TOP. |
| `gate.tower` | still | 9:16 | green | A pillar of stacked fluffy clouds, a puffy cap at the TOP. |
| `gate.brick` | still | 9:16 | green | A sandstone brick tower, battlements at the TOP. |
| `sky.day` | full-bleed | 21:9 | none | Sunny sky with soft clouds (lifted out and drifted, like slingshot). |
| `sky.dusk` | full-bleed | 21:9 | none | Sunset sky, cross-faded in as a run goes on. |
| `far.meadow` | strip | 21:9 | magenta | Distant hazy rolling hills, pale. |
| `far.town` | strip | 21:9 | magenta | Distant hazy town skyline, roofs and a castle, pale lilac. |
| `mid.meadow` | strip | 21:9 | magenta | Nearer hills with flower patches and round trees. |
| `mid.town` | strip | 21:9 | magenta | Nearer cottages with pitched roofs, low, in pale warm stone. |
| `ground.meadow` | full-bleed | 21:9 | none | Side-on grass top over soil. Tiled, every other copy mirrored. |
| `ground.town` | full-bleed | 21:9 | none | Side-on cobblestone street. Tiled the same way. |
| `title` | full-bleed | 16:9 | none | A rainbow meadow at golden hour, open sky in the centre for the menu. No characters: they're drawn over it from their own sheets. |

Budget: one retry each for a sheet that fails `checkArt()` or reads wrong, then fall back to
encoding what the model draws (tower-defense 57) or to the procedural painter.

### Size budget

The frame is 480–640 × 270 virtual pixels at up to DPR 2, so 1280 × 540 device pixels at most.

| Thing | Drawn (device px) | Shrink target |
| --- | --- | --- |
| Unicorn + Ellie | ~76 | 288 / frame |
| Fairy, kid, bomb | 30–50 | 192 / frame |
| Gate pillar | 52 wide | 256 wide |
| Sky, strips, ground, title | full width | 1280 |

## The rendering work

1. **Port the pipeline** from slingshot: `generate-art.mjs`, `shrink-art.mjs`,
   `art-manifest.mjs`, `src/render/sprites.ts`, `src/render/backdrop.ts`, `src/dev/art.ts`.
2. **Parallax**: sky (fixed) → lifted clouds drifting on the wind → far strip (0.18) → mid strip
   (0.42) → play field → ground (1.0). Each strip tile takes its biome from its own world
   position, the trick DECISIONS.md 22 already uses, so the town scrolls in from the right.
3. **Unicorn animation from game state**: a flap plays the wing cycle once, fast; between flaps
   it glides with a slow wing drift. MAGIC shows the zap pose for a beat, a hit shows the oops
   pose through the hitstop, a save shows the cheer, death shows dizzy. Squash-and-stretch on
   every flap, a tilt that follows the climb, and a sparkle trail.
4. **Juice**: sparkle stars and confetti on saves and zaps, hearts on a save, the fizzle
   flipbook, a little more shake on a hit, a fade-through-white from the title into the run, and
   a soft fade into the game-over card.
5. **Checks**: `checkArt()` over every sheet; play with `public/sprites/` moved away.

## Sound

Same split as slingshot (DECISIONS.md 16): Gemini makes voices and music, effects are
synthesised sample by sample in `src/core/sfx.ts`, and everything runs through a compressor and a
short procedural reverb.

- **Music (Lyria)**: `music.title`, `music.meadow` (calm, airy), `music.town` (a jaunty
  medieval lute-and-recorder take on the same mood). The flight music crossfades at the biome
  boundary. Loops are found by RMS and crossfaded, like slingshot.
- **Voices**, few and short, one at a time, rate-limited like `Cast.chatter`:
  Ellie (Zephyr, rate 1, slingshot's profile): "Wheee!", "Yay!", "Got it!", "Uh-oh!", "Oh no!",
  "Let's fly!". The fairy (squeaky, sped up): "Thank you!". The kid: "Yippee!".
- **Effects**: flap whoosh, zap sparkle, bomb fizzle-pop, save sparkle, gate chime that climbs a
  scale with the streak, a cartoon bonk on a hit, a gentle game-over slide.
- **Mute**: separate MUSIC and SOUND toggles, persisted. The context starts on the first
  gesture, suspends when the tab is hidden and resumes when it comes back.
