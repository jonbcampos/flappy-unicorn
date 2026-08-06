# Decisions

What we decided, why, and what would make us revisit it. **Append to this; don't rewrite
history.** A decision that turned out wrong gets a new entry saying so, not an edit to the old one
— the reasoning that led somewhere wrong is the most useful thing in the file.

Sister log to the one in [`../runner`](../runner/DECISIONS.md). Where a decision is inherited
wholesale from that project it's noted rather than re-argued.

---

## 1. A flappy game, because Ellie asked for one

She asked for "flappy bird with a unicorn, and the unicorn shoots magic that can save people and
blows up bombs". That's the whole brief and it's a good one: a one-button game plus a second verb
that turns avoidance into *choice*.

The temptation was to make the magic optional flavour. It isn't — the rescues are the only reason
to take a risk in a game otherwise made entirely of not-dying.

**Revisit if:** she stops playing it. She's the acceptance test.

## 2. Built on the runner, not from scratch

`../runner` already solved fixed-timestep, virtual-resolution letterboxing with portrait rotation,
multi-touch pointer handling, synthesized audio, a hand-rolled PWA and a GitHub Pages deploy. All
of that is game-agnostic and all of it took real debugging to get right. `src/core/loop.ts`,
`rng.ts`, `viewport.ts`, `game/collision.ts`, `render/renderer.ts` and `ui/text.ts` are copied
verbatim.

The corollary is a constraint worth stating: `config.ts` keeps the exact export names
`viewport.ts` imports (`SCREEN`, `VIRTUAL_H`, `MIN_VIRTUAL_W`, `MAX_VIRTUAL_W`, `MAX_DPR`), so
that file stays a byte-for-byte copy and fixes can flow between the two projects.

**Revisit if:** the two games' cores diverge enough that "verbatim" becomes a lie. At that point
extract a shared package rather than maintaining two drifting copies.

## 3. The flap arc is solved in world distance, not time

Inherited in spirit from runner's decision 9, and more important here.

`flapRise` (26px) and `flapRiseDistance` (42px) define the arc's *shape in the world*. Impulse and
gravity are derived per tick from the current scroll speed, so the apex is always exactly 26px and
the curvature `2·flapRise/flapRiseDistance²` is constant. A gap threadable at 140px/s is
geometrically threadable at 312px/s.

The alternative — fixed gravity and a fixed impulse — makes the arc stretch horizontally as the
run speeds up. Gaps that were fair in sector 1 quietly become unreachable in sector 6, and you
cannot tune your way out because the geometry itself has drifted. Every fairness proof in
`validateDesignContracts()` is written against those two derived constants.

Rails (`flapMinRiseTime`, `flapMaxRiseTime`) clamp the derived rise time so extreme speeds stay
playable; inside them the invariance is exact, and `trialFlapArcInvariance` measures it (0.66px of
drift between 120 and 250 px/s).

**Revisit if:** the rails start clamping during normal play, which would mean the speed range has
outgrown the arc.

## 4. No jump-cut, no coyote time, no ground state machine

The runner's `Player` is 401 lines of state machine. The `Unicorn` is a body with two verbs.

Coyote time needs a ledge. Jump-cut — variable height from how long you hold — is *actively wrong*
here: flappy's impulse is fixed, and its fixedness **is** the mechanic. A variable flap turns a
rhythm game into a hold-timing game, which is a harder thing to learn and a worse thing to ask of
a child.

**Revisit if:** never, probably. This is the genre's load-bearing constraint.

## 5. Hearts, and the floor and ceiling only cost one

True Flappy Bird is one hit and out. For a five-year-old that's a game about the last two seconds
of every attempt.

Hearts (3/2/1 by difficulty) with 1.2s of invulnerability, and touching a surface costs a heart
rather than ending the run. Design contract 7 exists because of this: i-frames must outlast the
column that caused them, or one mistake drains every heart before you understand what happened.

**Revisit if:** hearts make HARD feel weightless. The lever would be i-frame duration, not the
heart count.

## 6. EASY has a soft ceiling

The flappy version of runner's "EASY removes a thing to think about, not just a button".

A small child spams FLY. On EASY the ceiling clamps harmlessly instead of costing a heart, which
deletes a whole failure mode she cannot yet see coming, without making it a different game. She
still has to thread gaps and still has to dodge bombs. `ceilingIsSafe` is a difficulty flag read
in `resolveBounds()`, deliberately not in the physics — the clamp and the bounce happen either
way, only the *cost* differs.

**Revisit if:** she starts using the ceiling as a rail to hide against. Then it needs a cost, even
a small one.

## 7. Unlimited magic on a cooldown, no meter

An ammo meter is a resource to watch, and this game already asks a child to watch altitude,
gap position, bombs and fairies.

The cost of MAGIC isn't a resource — **aiming is flying**. The shot leaves the horn flat, so to
hit a bomb you must first put yourself at the bomb's altitude, using the same control keeping you
alive. That's the whole reason a second button is interesting, and it's why
unlimited-with-cooldown isn't the degenerate choice it looks like.

**Revisit if:** holding MAGIC permanently becomes strictly correct. It shouldn't, because firing
never helps you fly.

## 8. Nothing spawns on its own timer

The most important structural decision in the project, and the one that pushed hardest against the
inherited architecture.

The runner ran pickups on an independent timer and patched overlaps afterwards, which is fine when
there's always a floor to stand on. In flappy there is exactly one survivable path between two
gates, and a bomb parked on it is a death no input answers.

So `GateDirector` emits one gate and, in the same call, fills the corridor it defines. The safe
flight line is always known at placement time, which makes an unfair placement not something to
detect and patch but something that **cannot be expressed**. `corridor.ts` is the single authority
on where it's safe to be, and everything that places anything asks it.

**Revisit if:** a hazard type appears that isn't naturally corridor-relative. Then it needs its own
fairness argument, written down here, before it ships.

## 9. The director runs one gate ahead of itself

Discovered by a failing trial, and worth recording because the naive version looks obviously
correct.

Filling the corridor *behind* the gate being spawned cannot work: by the time gate N+1 reaches the
spawn edge, the space between it and gate N is already most of the way across the screen, so
anything dropped there materialises in front of the player. `trialSpawnOffScreen` caught bombs
appearing at x=210 in a 540-wide frame.

The fix is a one-gate lookahead — decide gate N+1's altitude an interval early, so the corridor
being filled lies entirely beyond the right edge. The gap width has to be *predicted* from the
interval rather than measured, which is acceptable only because the prediction errs in the safe
direction: if the speed steps up mid-interval the real gap comes out larger, never smaller.

**Revisit if:** something needs to be placed relative to two gates whose spacing genuinely can't
be predicted.

## 10. Corridor bookkeeping is distance, never x

Related bug, same root cause, found the same way. The first director stored the previous gate's
`x` and never scrolled it. Every gate spawns at the same x, so a stored x is stale the moment the
world moves — corridors came out with *negative* width, which silently disabled every placement
rule instead of failing loudly. No bombs spawned at all for a while and nothing complained.

Distance is the only quantity here that stays true. The same mistake was independently present in
`trialGateSequenceReachable`, which compared two gates' spawn-time x values and concluded they
were 26px apart.

**Revisit if:** never. Recorded so nobody reintroduces it.

## 11. Every blocking bomb has two answers, both guaranteed

A bomb near the flight line is the only thing in the game that asks for both buttons. It's also
the easiest thing to make unfair.

Three independent rules, any one of which would mostly work: it sits at least
`corridorClearance(gap)` from the line if it's a Class A "aside" bomb; it's never within 72px of a
gate column if it's Class B "blocking"; and a blocking bomb is offset 12px so its wide side leaves
a 36px lane against a 10px hurtbox. Plus `maxKillableBombs()` — the analogue of runner's
`maxKillableArmour` — refuses to place a blocking bomb that can't be shot down in the time it has
to arrive.

`trialBlockingBombKillable` and `trialBlockingBombDodgeable` both have to pass. A hazard with one
answer is a reflex test with a hidden correct input; if that answer is "shoot", a player who hasn't
found the second button is simply stuck.

**Revisit if:** blocking bombs read as free points. Then `blockOffset` shrinks, and contract 12
will tell you how far it can go.

## 12. Rescues are never punished

Shooting a fairy is 50, flying into one is 20, missing one entirely is nothing at all — no sound,
no penalty, not even a sad noise. Their collision boxes are *inflated* rather than inset, the only
boxes in the game that are.

A child should never learn that the bright friendly thing was a mistake. Shooting is worth more,
so the verb teaches itself with a carrot.

**Revisit if:** rescues become the whole score and gates stop mattering. Rebalance the values, not
the rule.

## 13. Bombs are the darkest thing on screen, fairies the brightest

Bombs and fairies demand opposite responses within a fraction of a second, at 14–18px, on a pale
sky. Hue alone isn't a reliable difference for a small child mid-panic. Value is.

The first fairy palette was near-white with a soft halo and vanished completely against the sky —
the one object you're meant to *aim for* was the hardest to see. Fixed with a saturated amber ring
(a crisp outline survives any background; a glow only survives a dark one) around a two-tone core.

**Revisit if:** a night or storm sector lands, which inverts the background value and breaks the
premise.

## 14. Nothing in the background may look like a hazard

Inherited from the runner, where a galloping background unicorn had to be deleted because "some
unicorns are scenery and some you must jump" is intolerable ambiguity. This game makes the trap
worse in two ways, and both bit.

**Butterflies are not carried over.** Small bright winged things in the middle distance are now
visually identical to a 50-point rescue. Drifting petals replace them — no glow, no halo, no
wings.

**The scenery rainbow was drawn wrong first.** The gates are literally rainbows. The initial
version had a 170px arc centred just below the floor, putting its apex at y=100 — dead centre of
the flyable band, at an opacity you could not ignore. It's now very faint, very wide and flat, and
clipped to its top cap so its limbs never dive through the play field.

**Revisit if:** a new background element is proposed. The bar is "could a tired six-year-old
mistake this for something they must act on".

## 15. Sprites may be smaller than their hitbox, never larger

Also inherited, and it drives real code. `puff()` centres its lozenges and would overhang, so the
ceiling's underside is explicit `fillRect`s clamped to `CEILING_Y`, the floor's grass tufts are
drawn strictly below the lip, and cloud-tower gates get a solid core filling the hitbox exactly
with puffs only *inside* it.

The 3px white lip on a gate is the single most important detail in the game. It isn't decoration —
the player is reading "how much room do I have" thirty times a second and the lip is the only
thing telling them the truth.

## 16. Design contracts are checked per difficulty, not once

Gap height varies per mode (72/60/52). That is precisely the axis where a change looks fine on
NORMAL and makes HARD impossible, so every geometric contract loops over all three difficulties
and reports which one broke.

The two that carry the most weight:

- **Contract 3 (coast-through).** Free-falling across the danger window from the top lip must not
  reach the bottom lip. It's 34px through 46px of slack on HARD. This is what makes a gap *fair*:
  a gap you must flap inside of is one where the correct input depends on sub-pixel position,
  which is a coin flip, not a skill.
- **Contract 5 (reachability).** Gate N+1's altitude must be reachable from gate N at
  `FLIGHT.assumedTapRate` taps per second, discounted by `climbSafety` because the player is also
  *reading* the gap, not just tapping at maximum rate.

`maxClimbOver()` is the only place a time-based quantity enters the flight model, which is why
climbing — and nothing else — gets harder as the game speeds up. That's honest, and it's the thing
a player can practise.

## 17. The verification bot's policy is part of the contract

Three separate versions of `shouldFlap` reported tuning failures that did not exist, and this cost
more time than any real bug. Recording all three, because each looked right:

1. **`y > target`.** Bang-bang at the centre. A flap is a fixed 26px impulse, so the whole
   oscillation band sits *above* the trigger — the bot rides the top lip and clips it at every
   gate. Reads as "the gaps are too small".
2. **Project free-fall to the gate.** Over a horizon of a second, gravity dwarfs the 26px a flap
   buys, so the projection *always* says "too low". The bot flaps every tick and pins itself to
   the ceiling.
3. **Project 0.12s ahead.** Fires ~22px early, and that lead adds to the 26px band. Back on the
   top lip.

What works: bang-bang triggered half a flap *below* the centre, so the band straddles the gap. And
the bot is rate-limited to `FLIGHT.assumedTapRate` — an unlimited-rate bot holds any altitude by
machine-gunning the button, which would let the suite pass on tuning no human could fly.

Two more trial-only bugs worth the same warning: the bomb-corridor trial keyed its "already
checked" set on pooled objects, so it silently capped at `poolSize` and passed off a sample of
three; and it marked bombs on *sight* rather than on *evaluation*, when a bomb is placed ahead of
the gate that brackets it and isn't measurable yet.

**The lesson:** a trial that passes is only as trustworthy as its sample size and its policy. Print
both — every trial reports what it actually measured, not just PASS.

## 18. Dropped from the runner: boss, powerups, patterns, themes

- **Boss.** Exists there to give a 90-second run a climax. Flappy runs are 30–60s and already
  escalate via speed and density. A boss also needs a vocabulary, and there's no ground to launch
  anything from.
- **Powerups.** Nine timed modifiers on a two-button game is more state than this game contains —
  and their independent-timer placement is exactly the bug decision 8 exists to prevent. Fairies
  fill the "bright thing worth collecting" slot. *If one is ever wanted, add exactly one (a shield
  heart) and place it through the director like everything else.*
- **Patterns.** Gates are a metronome; a table reading `[gate, gate, gate]` is ceremony. The real
  authoring surface is placement relative to the flight line, which only the director knows.
- **Theme registry.** One skin is planned. The `Renderer` interface stays because it's the seam
  that keeps `src/game/` renderer-free; the single-entry registry goes. `theme.ts` lifts verbatim
  from the runner if a second skin ever lands.
- **Distance as score.** Rewards hovering in open sky. Score is gates × 10 plus rescues, which
  rewards the thing the game is about.

## 19. A run opens hovering, not falling

First real playtest note, and it was the right call: *"it's not cool that you start immediately
thrown to the ground."*

Picking a difficulty used to drop you straight into `playing` with gravity already on, so the
game's opening move was to make you fall before you'd looked at the screen. Now `start()` enters a
`ready` phase — the world holds still, nothing spawns, nothing can hurt you, and the unicorn bobs
in place until you press FLY.

Three details that matter more than they look:

- **The starting press is a real flap.** `updateReady` calls the same `player.flap()` the run
  uses, so beginning costs no altitude and the control feels connected from the first frame. A
  state change that merely unfreezes gravity would reintroduce the original complaint with an
  extra tap in front of it.
- **The hover is assigned, not simulated.** `player.hover()` writes `y` outright with gravity
  never running. A hover built as thrust cancelling gravity drifts, and drifting into the floor
  before the player has pressed anything is precisely what this exists to prevent.
- **It bobs rather than freezing.** A completely static screen reads as "the game hasn't loaded".

MAGIC is inert during the hover, so the run can only start the way the prompt says.

`trialReadyStateIsSafe` holds still for ten seconds on HARD and asserts full hearts, no spawns, no
drift, and that the first FLY press yields a *negative* vy. The twelve run-focused trials skip the
phase by setting `state.phase = 'playing'` directly, rather than each growing a setup step to test
something one trial already covers.

**Revisit if:** restarting repeatedly starts to feel slow. The lever would be letting the game-over
RETRY skip straight to `playing`, not removing the hover.

## 20. The FLY hit region is the whole right half of the screen

The circle is the affordance; the hit region is enormous. A five-year-old cannot reliably land a
30px circle while panicking, and unlike every other control in either game a missed flap is not a
wasted input — it's a heart.

MAGIC keeps its small circle deliberately. A mis-aimed shot costs nothing, so there's no reason to
steal screen from FLY for it. The asymmetry is the point: the forgiving control is the one where
forgiveness matters.

**Revisit if:** players start flapping by accident while aiming. Unlikely — MAGIC is on the other
thumb.
