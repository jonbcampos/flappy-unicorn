import {
  BOMB,
  CEILING_Y,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  FAIRY,
  FIXED_DT,
  FLIGHT,
  FLOOR_Y,
  GATE,
  PLAYER_X,
  SCREEN,
  UNICORN,
  corridorClearance,
  speedRange,
  type DifficultyId,
} from '../game/config';
import { maxKillableBombs } from '../game/director';
import { laneY, maxClimbOver, type Corridor } from '../game/corridor';
import { GameState } from '../game/state';
import type { Action } from '../core/input';

/**
 * Headless verification of the fairness guarantees.
 *
 * These run the **real GameState against a fake input**, not the arithmetic in
 * config.ts. That distinction is the whole value: it catches breakage anywhere
 * in the chain — physics, hitbox sizing, placement rules, collision resolution
 * — rather than just confirming that two numbers still compare the way they
 * did. A tuning change that quietly makes HARD unwinnable is exactly the bug
 * this exists to catch, and it is invisible to a type checker and to playtests
 * on NORMAL.
 *
 * Run it from the browser console: `__game.verify()`.
 */

/** Minimal stand-in for Input: only the surface the simulation actually reads. */
class FakeInput {
  down: Record<Action, boolean> = { fly: false, magic: false };
  private buffer: Record<Action, number> = { fly: 0, magic: 0 };

  press(action: Action): void {
    this.buffer[action] = 0.13;
    this.down[action] = true;
  }

  release(action: Action): void {
    this.down[action] = false;
  }

  tick(dt: number): void {
    for (const key of ['fly', 'magic'] as Action[]) {
      if (this.buffer[key] > 0) this.buffer[key] = Math.max(0, this.buffer[key] - dt);
    }
  }

  consume(action: Action): boolean {
    if (this.buffer[action] <= 0) return false;
    this.buffer[action] = 0;
    return true;
  }

  hasBuffered(action: Action): boolean {
    return this.buffer[action] > 0;
  }

  clearBuffers(): void {
    this.buffer = { fly: 0, magic: 0 };
  }

  consumeTap(): null {
    return null;
  }

  consumeAnyPress(): boolean {
    return false;
  }
}

export interface TrialResult {
  trial: string;
  difficulty: DifficultyId | 'all';
  detail: string;
  pass: boolean;
}

/** Casting helper — FakeInput implements the surface, not the class. */
function asInput(fake: FakeInput): Parameters<GameState['update']>[1] {
  return fake as unknown as Parameters<GameState['update']>[1];
}

/** Build a run pinned at one speed, so a trial tests the case it says it does. */
function fixedSpeedRun(id: DifficultyId, speed: number, seed = 7): {
  state: GameState;
  input: FakeInput;
  step: () => void;
} {
  const state = new GameState();
  const input = new FakeInput();
  state.start(id, seed);
  // Skip the pre-run hover. Every trial here is about the run itself, and the
  // hover is a UI affordance — making each bot press FLY first would add a
  // setup step to twelve trials to test one thing. That one thing gets its own
  // trial instead: trialReadyStateIsSafe.
  state.phase = 'playing';
  state.scrollSpeed = speed;
  return {
    state,
    input,
    step: () => {
      // Re-pin every tick: advanceSector() would otherwise ramp it away.
      state.scrollSpeed = speed;
      state.update(FIXED_DT, asInput(input));
    },
  };
}

// --- gate trials ------------------------------------------------------------

/**
 * A bot that aims its *arrival* at the next gap centre must survive.
 *
 * The policy matters, and getting it wrong makes this trial lie in both
 * directions. A naive "flap whenever I'm below the centre" controller
 * oscillates with an amplitude of one full flap — 26px — which is wider than
 * the 23px half-window of a HARD gap. It therefore fails on HARD no matter how
 * fair the tuning is, which would report a tuning bug that doesn't exist.
 *
 * So the bot projects where it will be when it reaches the gate and flaps if
 * that arrival is too low. That's the thing a competent player actually does,
 * and it's the weakest policy that can honestly be called "playing".
 */
function trialGapThreadable(id: DifficultyId, speed: number): TrialResult {
  const { state, input, step } = fixedSpeedRun(id, speed);
  let ticks = 0;
  const limit = Math.ceil(25 / FIXED_DT);

  // The bot taps no faster than FLIGHT.assumedTapRate — the same rate the
  // reachability guarantee is bought with. An unlimited-rate bot can hold any
  // altitude by machine-gunning the button, which would let this trial pass on
  // tuning a human could never fly.
  let tapCooldown = 0;

  while (ticks < limit && state.phase === 'playing') {
    tapCooldown -= FIXED_DT;
    if (tapCooldown <= 0 && shouldFlap(state)) {
      input.press('fly');
      tapCooldown = 1 / FLIGHT.assumedTapRate;
    }
    input.tick(FIXED_DT);
    step();
    // Bombs are removed for the duration. This trial asks one question — "is
    // the gate rhythm itself threadable" — and a bot that ignores bombs dying
    // to a bomb answers a different one. Bombs get their own three trials,
    // where the bot is actually told about them.
    state.bombs.reset();
    ticks++;
  }

  const hearts = DIFFICULTIES[id].hearts;
  return {
    trial: `gap threadable @${Math.round(speed)}px/s`,
    difficulty: id,
    detail: `${state.gatesPassed} gates, ${state.player.hp}/${hearts} hearts`,
    pass: state.phase === 'playing' && state.player.hp === hearts && state.gatesPassed > 3,
  };
}

/**
 * Flap when the unicorn has sunk half a flap below the gap centre.
 *
 * Two things about this are load-bearing, and both were got wrong first:
 *
 * **The offset.** A flap is a fixed 26px impulse, so the altitude band a
 * bang-bang flyer occupies runs from the trigger height up to 26px above it.
 * Trigger *at* the centre and the whole band sits above the gap, so the bot
 * rides the top lip and clips it at every gate — which reads as "the gaps are
 * too small" when the gaps are fine. Triggering half a flap low centres the
 * band on the gap.
 *
 * **No velocity projection.** An earlier version compared a 0.12s-ahead
 * position against the target, reasoning that a player anticipates. It fires
 * roughly 22px early — that lead is *added* to the 26px band — and puts the bot
 * right back on the top lip. Anticipation belongs in choosing when to start
 * moving between gaps, not in holding one.
 */
function shouldFlap(state: GameState): boolean {
  const player = state.player;
  const gate = nextGate(state);
  const target = gate ? gate.centreY : (CEILING_Y + FLOOR_Y) / 2;

  // Never let a surface take a heart while lining up a distant gate.
  if (player.y > FLOOR_Y - UNICORN.height) return true;
  if (player.y < CEILING_Y + UNICORN.height) return false;

  return player.y > target + FLIGHT.flapRise / 2;
}

/**
 * The gate to aim at: the nearest one that can still touch the unicorn.
 *
 * The cutoff is the trailing edge passing the unicorn's *nose*, and it has to
 * be — a gate overlaps the body for as long as `gate.x + width > PLAYER_X`.
 * Retargeting any earlier means the bot starts hauling itself toward the next
 * gap, which may be 40px away, while still between the current gate's lips. It
 * then clips the lip it had already cleared, at every single gate, which looks
 * exactly like the gaps being too small.
 */
function nextGate(state: GameState): { x: number; centreY: number } | null {
  let best: { x: number; centreY: number } | null = null;
  for (const gate of state.gates.items) {
    if (!gate.active) continue;
    if (gate.x + GATE.width <= PLAYER_X) continue;
    if (!best || gate.x < best.x) best = { x: gate.x, centreY: gate.centreY };
  }
  return best;
}

/**
 * Entering a gap at its top lip with zero velocity, and never pressing
 * anything, must come out the far side untouched.
 *
 * This is design contract 3 proven against the real collision code rather than
 * against the free-fall formula. It's the property that makes a gap *fair*: a
 * gap you must flap inside of is a gap where the correct input depends on
 * sub-pixel position, which is not a skill, it's a coin flip.
 */
function trialCoastThrough(id: DifficultyId, speed: number): TrialResult {
  const { state, input, step } = fixedSpeedRun(id, speed);
  const gap = DIFFICULTIES[id].gapHeight;
  const centre = (CEILING_Y + FLOOR_Y) / 2;

  // Clear whatever the director queued and stage exactly one gate.
  state.gates.reset();
  state.bombs.reset();
  state.fairies.reset();
  const gate = state.gates.spawn(centre, gap, 'arch');
  if (!gate) {
    return { trial: 'coast through', difficulty: id, detail: 'gate pool empty', pass: false };
  }
  // Staged immediately in front of the unicorn rather than at the spawn edge.
  // The contract is about the *crossing*, and a gate that has to fly the whole
  // frame first gives the unicorn three seconds of free fall to reach the floor
  // — which would make this trial a test of the floor, not of the gap.
  gate.x = PLAYER_X + UNICORN.width + 2;
  gate.prevX = gate.x;

  // Park the unicorn at the top lip, level.
  state.player.y = centre - gap / 2 + UNICORN.height / 2;
  state.player.prevY = state.player.y;
  state.player.vy = 0;

  const hearts = state.player.hp;
  let ticks = 0;
  const crossing = (GATE.width + UNICORN.width + gate.x - PLAYER_X) / speed;
  const limit = Math.ceil(crossing / FIXED_DT) + 2;
  while (ticks < limit && state.phase === 'playing') {
    input.tick(FIXED_DT);
    step();
    ticks++;
    if (gate.x + GATE.width < PLAYER_X) break;
  }

  return {
    trial: 'coast through gap, no flap',
    difficulty: id,
    detail: `${state.player.hp}/${hearts} hearts through a ${gap}px gap`,
    pass: state.player.hp === hearts,
  };
}

/**
 * Every consecutive pair of gates the real director emits must be reachable.
 *
 * Drives 300 seconds at cap speed and checks the altitude change against what
 * the flight model can actually deliver over the intervening distance.
 */
function trialGateSequenceReachable(id: DifficultyId): TrialResult {
  const speed = speedRange(DIFFICULTIES[id]).max;
  const { state, input, step } = fixedSpeedRun(id, speed, 12345);

  // Recorded against state.distance, not gate.x. Every gate spawns at the same
  // x, so an x captured at spawn time says nothing about how far apart two
  // gates are — the separation only exists in the distance the world travelled
  // between them. Getting this wrong is what hid the director bug.
  const seen: { distance: number; centreY: number }[] = [];
  let worst = 0;
  let worstAllowed = Infinity;
  const limit = Math.ceil(300 / FIXED_DT);

  for (let i = 0; i < limit; i++) {
    const before = activeSet(state.gates.items);
    input.tick(FIXED_DT);
    // Keep the bot alive so gates keep flowing; the trial is about placement.
    state.player.hp = 99;
    step();
    for (const gate of state.gates.items) {
      if (!gate.active || before.has(gate)) continue;
      const previous = seen[seen.length - 1];
      if (previous) {
        const dx = state.distance - previous.distance - GATE.width;
        const climb = Math.max(0, previous.centreY - gate.centreY);
        const allowed = maxClimbOver(dx, speed) * GATE.climbSafety;
        if (climb > 0 && climb - allowed > worst - worstAllowed) {
          worst = climb;
          worstAllowed = allowed;
        }
      }
      seen.push({ distance: state.distance, centreY: gate.centreY });
    }
  }

  return {
    trial: 'gate sequence reachable',
    difficulty: id,
    detail: `${seen.length} gates, worst climb ${worst.toFixed(1)}px of ${
      worstAllowed === Infinity ? '—' : worstAllowed.toFixed(1)
    }px allowed`,
    pass: seen.length > 20 && worst <= worstAllowed + 0.5,
  };
}

// --- bomb trials ------------------------------------------------------------

/**
 * No bomb the director places may sit in the safe corridor.
 *
 * The single most important trial in the file. A bomb parked on the flight line
 * between two gates is an unfair death — there is no input that answers it —
 * and it's the specific failure mode the entire director architecture exists to
 * make unexpressible. Recomputes each bomb's corridor from the gates that
 * actually bracket it, rather than trusting the director's own bookkeeping.
 */
function trialBombNeverInCorridor(id: DifficultyId): TrialResult {
  const difficulty = DIFFICULTIES[id];
  const speed = speedRange(difficulty).max;
  const { state, input, step } = fixedSpeedRun(id, speed, 99);
  const required = corridorClearance(difficulty.gapHeight);

  let checked = 0;
  let violations = 0;
  let tightest = Infinity;
  let tightestBlocking = Infinity;
  // Bombs are marked once *evaluated*, not once seen. A bomb is placed ahead of
  // the gate that will bracket it, so on the tick it appears there is no gate
  // after it and no corridor to measure against. Marking on sight would skip
  // every bomb in the game and report a vacant pass.
  const judged = new Set<Bomb>();
  const limit = Math.ceil(300 / FIXED_DT);

  for (let i = 0; i < limit; i++) {
    input.tick(FIXED_DT);
    state.player.hp = 99;
    step();

    for (const bomb of state.bombs.items) {
      // Pool slots are reused, so a slot must become judgeable again once its
      // occupant despawns. Without this the trial silently caps at poolSize
      // bombs — it reported a pass off a sample of three.
      if (!bomb.active) {
        judged.delete(bomb);
        continue;
      }
      if (judged.has(bomb)) continue;
      const corridor = bracketingCorridor(state, bomb.baseY, bomb.x, difficulty.gapHeight);
      if (!corridor) continue;
      judged.add(bomb);
      checked++;

      if (bomb.blocking) {
        // A blocking bomb answers to the gate-mouth rule, not the lane rule.
        const clearance = gateMouthClearance(state, bomb.x);
        tightestBlocking = Math.min(tightestBlocking, clearance);
        if (clearance < BOMB.minGateClearance - 0.5) violations++;
      } else {
        const offLane = Math.abs(bomb.baseY - laneY(corridor, bomb.x));
        tightest = Math.min(tightest, offLane);
        if (offLane < required - 0.5) violations++;
      }
    }
  }

  return {
    trial: 'no bomb in the safe corridor',
    difficulty: id,
    detail: `${checked} bombs, tightest aside ${fmt(tightest)}/${required.toFixed(
      0,
    )}px, tightest blocking ${fmt(tightestBlocking)}/${BOMB.minGateClearance}px`,
    pass: violations === 0 && checked > 0,
  };
}

type Bomb = GameState['bombs']['items'][number];

function fmt(value: number): string {
  return value === Infinity ? '—' : value.toFixed(1);
}

/** The corridor between the gates immediately before and after a world x. */
function bracketingCorridor(
  state: GameState,
  _y: number,
  x: number,
  gapHeight: number,
): Corridor | null {
  let before: { x: number; centreY: number } | null = null;
  let after: { x: number; centreY: number } | null = null;
  for (const gate of state.gates.items) {
    if (!gate.active) continue;
    if (gate.x + GATE.width <= x && (!before || gate.x > before.x)) {
      before = { x: gate.x, centreY: gate.centreY };
    }
    if (gate.x >= x && (!after || gate.x < after.x)) {
      after = { x: gate.x, centreY: gate.centreY };
    }
  }
  if (!before || !after) return null;
  return {
    startX: before.x + GATE.width,
    endX: after.x,
    startY: before.centreY,
    endY: after.centreY,
    halfHeight: gapHeight / 2,
  };
}

/** Distance from a world x to the nearest gate column edge. */
function gateMouthClearance(state: GameState, x: number): number {
  let nearest = Infinity;
  for (const gate of state.gates.items) {
    if (!gate.active) continue;
    if (x >= gate.x && x <= gate.x + GATE.width) return 0;
    nearest = Math.min(nearest, Math.abs(x - gate.x), Math.abs(x - (gate.x + GATE.width)));
  }
  return nearest;
}

/**
 * A blocking bomb must have TWO answers: shoot it, or fly the wide side.
 *
 * Both trials must pass. A blocking bomb with only one answer isn't a decision,
 * it's a reflex check with a hidden correct input — and if that one answer is
 * "shoot", a player who hasn't discovered the second button is simply stuck.
 */
function trialBlockingBombKillable(id: DifficultyId): TrialResult {
  const speed = speedRange(DIFFICULTIES[id]).max;
  const { state, input, step } = fixedSpeedRun(id, speed);
  state.gates.reset();
  state.bombs.reset();
  state.fairies.reset();

  const y = (CEILING_Y + FLOOR_Y) / 2;
  const bomb = state.bombs.spawn(state.scrollSpeed * 0 + 480, y, true, 0);
  if (!bomb) {
    return { trial: 'blocking bomb killable', difficulty: id, detail: 'pool empty', pass: false };
  }

  state.player.y = y;
  state.player.prevY = y;
  const startHp = state.player.hp;
  let ticks = 0;
  const limit = Math.ceil(8 / FIXED_DT);

  while (ticks < limit && bomb.active && bomb.deathTimer <= 0 && state.player.hp === startHp) {
    // Hold altitude and fire continuously — the "I answered correctly" bot.
    if (state.player.y > y) input.press('fly');
    input.press('magic');
    input.tick(FIXED_DT);
    step();
    ticks++;
  }

  const destroyed = bomb.deathTimer > 0 || !bomb.active;
  return {
    trial: 'blocking bomb killable',
    difficulty: id,
    detail: destroyed
      ? `destroyed with ${maxKillableBombs(speed)} shots available`
      : 'survived to contact',
    pass: destroyed && state.player.hp === startHp,
  };
}

function trialBlockingBombDodgeable(id: DifficultyId): TrialResult {
  const difficulty = DIFFICULTIES[id];
  const speed = speedRange(difficulty).max;
  const { state, input, step } = fixedSpeedRun(id, speed);
  state.gates.reset();
  state.bombs.reset();
  state.fairies.reset();

  // Worst case: the bomb sits blockOffset below the line, so the wide lane is
  // above it, and the bot must find that lane without firing a single shot.
  const lane = (CEILING_Y + FLOOR_Y) / 2;
  const bombY = lane + BOMB.blockOffset;
  const bomb = state.bombs.spawn(480, bombY, true, 0);
  if (!bomb) {
    return { trial: 'blocking bomb dodgeable', difficulty: id, detail: 'pool empty', pass: false };
  }

  const target = bombY - BOMB.height / 2 - UNICORN.height / 2 - 4;
  state.player.y = target;
  state.player.prevY = target;
  const startHp = state.player.hp;
  let ticks = 0;
  const limit = Math.ceil(8 / FIXED_DT);

  while (ticks < limit && bomb.active && state.player.hp === startHp) {
    if (state.player.y > target) input.press('fly');
    input.tick(FIXED_DT);
    step();
    ticks++;
    if (bomb.x + BOMB.width < PLAYER_X) break;
  }

  return {
    trial: 'blocking bomb dodgeable, no shots',
    difficulty: id,
    detail: `${state.player.hp}/${startHp} hearts flying the wide side`,
    pass: state.player.hp === startHp,
  };
}

// --- fairy trials -----------------------------------------------------------

/** Flying into a fairy must never cost anything, and must score. */
function trialFairyHarmless(id: DifficultyId): TrialResult {
  const { state, input, step } = fixedSpeedRun(id, speedRange(DIFFICULTIES[id]).min);
  state.gates.reset();
  state.bombs.reset();
  state.fairies.reset();

  const y = (CEILING_Y + FLOOR_Y) / 2;
  state.fairies.spawn(360, y, 'fairy', 0);
  state.player.y = y;
  state.player.prevY = y;
  const startHp = state.player.hp;
  const startScore = state.score;

  let ticks = 0;
  const limit = Math.ceil(6 / FIXED_DT);
  while (ticks < limit && state.score === startScore) {
    // Hold the altitude the fairy is at, so contact is certain.
    if (state.player.y > y) input.press('fly');
    input.tick(FIXED_DT);
    step();
    ticks++;
  }

  return {
    trial: 'fairy harmless on contact',
    difficulty: id,
    detail: `+${state.score - startScore} score, ${state.player.hp}/${startHp} hearts`,
    pass: state.player.hp === startHp && state.score > startScore,
  };
}

/** No fairy is ever placed close enough to a bomb to be confused with one. */
function trialFairyBombSeparation(id: DifficultyId): TrialResult {
  const { state, input, step } = fixedSpeedRun(id, speedRange(DIFFICULTIES[id]).max, 4242);
  let closest = Infinity;
  const limit = Math.ceil(240 / FIXED_DT);

  for (let i = 0; i < limit; i++) {
    input.tick(FIXED_DT);
    state.player.hp = 99;
    step();
    for (const fairy of state.fairies.items) {
      if (!fairy.active) continue;
      for (const bomb of state.bombs.items) {
        if (!bomb.active) continue;
        // Both axes, matching the director's own rule.
        const separation = Math.max(
          Math.abs(fairy.baseY - bomb.baseY),
          Math.abs(fairy.x - bomb.x),
        );
        closest = Math.min(closest, separation);
      }
    }
  }

  return {
    trial: 'fairies never crowd bombs',
    difficulty: id,
    detail: `closest ${fmt(closest)}px (need ${FAIRY.minSeparationFromBomb})`,
    pass: closest === Infinity || closest >= FAIRY.minSeparationFromBomb - 0.5,
  };
}

// --- structural trials ------------------------------------------------------

/**
 * One obstacle costs exactly one heart.
 *
 * Design contract 7, proven. If i-frames run out while still inside the column
 * that started them, a single mistake drains three hearts and the player has no
 * idea why the run ended.
 */
function trialOneHeartPerObstacle(): TrialResult {
  const id: DifficultyId = 'kid';
  const speed = speedRange(DIFFICULTIES[id]).min;
  const { state, input, step } = fixedSpeedRun(id, speed);
  state.gates.reset();
  state.bombs.reset();
  state.fairies.reset();

  const gap = DIFFICULTIES[id].gapHeight;
  const centre = (CEILING_Y + FLOOR_Y) / 2;
  const gate = state.gates.spawn(centre, gap, 'arch');
  if (!gate) {
    return { trial: 'one heart per obstacle', difficulty: id, detail: 'pool empty', pass: false };
  }

  // Park the unicorn inside the lower column's path — a guaranteed hit.
  const inColumn = centre + gap / 2 + UNICORN.height;
  const startHp = state.player.hp;
  let ticks = 0;
  const limit = Math.ceil(6 / FIXED_DT);

  while (ticks < limit && !state.player.dead) {
    // Pin the altitude so the unicorn stays in the column for its whole pass.
    state.player.y = inColumn;
    state.player.prevY = inColumn;
    state.player.vy = 0;
    input.tick(FIXED_DT);
    step();
    ticks++;
    if (gate.x + GATE.width < PLAYER_X - UNICORN.width) break;
  }

  const lost = startHp - state.player.hp;
  return {
    trial: 'one gate costs one heart',
    difficulty: id,
    detail: `lost ${lost} of ${startHp}`,
    pass: lost === 1,
  };
}

/**
 * You cannot lose before you have started.
 *
 * The whole point of the hover: hold still for ten seconds on the harshest
 * difficulty and nothing happens — no fall, no floor, no spawns, full hearts.
 * Then one FLY press starts the run *and* counts as a flap, so beginning costs
 * no altitude.
 */
function trialReadyStateIsSafe(): TrialResult {
  const state = new GameState();
  const input = new FakeInput();
  state.start('hard', 3);

  for (let i = 0; i < Math.ceil(10 / FIXED_DT); i++) {
    input.tick(FIXED_DT);
    state.update(FIXED_DT, asInput(input));
  }

  const heldStill =
    state.phase === 'ready' &&
    state.player.hp === DIFFICULTIES.hard.hearts &&
    state.gates.items.every((g) => !g.active) &&
    Math.abs(state.player.y - (CEILING_Y + FLOOR_Y) / 2) < 8;

  input.press('fly');
  input.tick(FIXED_DT);
  state.update(FIXED_DT, asInput(input));

  return {
    trial: 'cannot lose before the run starts',
    difficulty: 'hard',
    detail: heldStill
      ? `held 10s at y=${state.player.y.toFixed(1)}, FLY -> ${state.phase}, vy=${state.player.vy.toFixed(0)}`
      : `hover leaked: phase ${state.phase}, ${state.player.hp} hearts`,
    // vy must be negative: the starting press has to be a real flap, not just
    // a state change that drops you.
    pass: heldStill && state.phase === 'playing' && state.player.vy < 0,
  };
}

/** Doing nothing on HARD must actually reach the game-over screen. */
function trialGameOver(): TrialResult {
  const { state, input, step } = fixedSpeedRun('hard', speedRange(DIFFICULTIES.hard).min);
  let ticks = 0;
  const limit = Math.ceil(30 / FIXED_DT);
  while (ticks < limit && state.phase === 'playing') {
    input.tick(FIXED_DT);
    step();
    ticks++;
  }
  return {
    trial: 'doing nothing ends the run',
    difficulty: 'hard',
    detail: `phase ${state.phase} after ${(ticks * FIXED_DT).toFixed(1)}s`,
    pass: state.phase === 'gameover',
  };
}

/**
 * Nothing may pop into existence inside the frame.
 *
 * A full-height gate appearing mid-screen is catastrophic — it's an obstacle
 * the player was given zero frames to read. Checks gates, bombs and fairies,
 * each on the tick it first appears.
 */
function trialSpawnOffScreen(id: DifficultyId): TrialResult {
  const { state, input, step } = fixedSpeedRun(id, speedRange(DIFFICULTIES[id]).max, 555);
  let counted = 0;
  let leftmost = Infinity;
  const limit = Math.ceil(180 / FIXED_DT);

  const note = (x: number): void => {
    counted++;
    leftmost = Math.min(leftmost, x);
  };

  for (let i = 0; i < limit; i++) {
    input.tick(FIXED_DT);
    state.player.hp = 99;
    const before = {
      gates: activeSet(state.gates.items),
      bombs: activeSet(state.bombs.items),
      fairies: activeSet(state.fairies.items),
    };
    step();
    for (const gate of state.gates.items) {
      if (gate.active && !before.gates.has(gate)) note(gate.x);
    }
    for (const bomb of state.bombs.items) {
      if (bomb.active && !before.bombs.has(bomb)) note(bomb.x - BOMB.width / 2);
    }
    for (const fairy of state.fairies.items) {
      if (fairy.active && !before.fairies.has(fairy)) note(fairy.x - FAIRY.width / 2);
    }
  }

  return {
    trial: 'nothing spawns on screen',
    difficulty: id,
    detail: `${counted} spawns, leftmost at x=${fmt(leftmost)} (frame is ${SCREEN.w} wide)`,
    pass: counted > 0 && leftmost >= SCREEN.w,
  };
}

function activeSet<T extends { active: boolean }>(items: readonly T[]): Set<T> {
  const set = new Set<T>();
  for (const item of items) if (item.active) set.add(item);
  return set;
}

/**
 * The flap arc covers the same WORLD DISTANCE at every speed.
 *
 * The invariance the whole flight model is built on. If this fails, gaps that
 * were fair at the start of a run stop being fair later, and no amount of
 * tuning gap height fixes it because the geometry itself has drifted.
 */
function trialFlapArcInvariance(): TrialResult {
  const measure = (speed: number): number => {
    const { state, input, step } = fixedSpeedRun('normal', speed);
    state.gates.reset();
    state.bombs.reset();
    state.fairies.reset();
    const startY = (CEILING_Y + FLOOR_Y) / 2 + 40;
    state.player.y = startY;
    state.player.prevY = startY;
    state.player.vy = 0;

    input.press('fly');
    let ticks = 0;
    let apex = startY;
    // Run until the body starts falling again.
    while (ticks < 600) {
      input.tick(FIXED_DT);
      step();
      apex = Math.min(apex, state.player.y);
      if (state.player.vy > 0 && ticks > 2) break;
      ticks++;
    }
    return startY - apex;
  };

  const slow = measure(120);
  const fast = measure(250);
  const drift = Math.abs(slow - fast);
  return {
    trial: 'flap apex is speed-invariant',
    difficulty: 'all',
    detail: `${slow.toFixed(1)}px @120  vs  ${fast.toFixed(1)}px @250 (drift ${drift.toFixed(2)})`,
    pass: drift < 1.5,
  };
}

// --- runner -----------------------------------------------------------------

export function verify(): TrialResult[] {
  const results: TrialResult[] = [];

  for (const id of DIFFICULTY_ORDER) {
    const { min, max } = speedRange(DIFFICULTIES[id]);
    // Seven speeds across the run's whole range, not just the endpoints — the
    // arc rails kick in partway up and that's where a bug would hide.
    for (let i = 0; i < 7; i++) {
      results.push(trialGapThreadable(id, min + ((max - min) * i) / 6));
    }
    results.push(trialCoastThrough(id, min));
    results.push(trialCoastThrough(id, max));
    results.push(trialGateSequenceReachable(id));
    results.push(trialBombNeverInCorridor(id));
    results.push(trialBlockingBombDodgeable(id));
    results.push(trialFairyHarmless(id));
    results.push(trialFairyBombSeparation(id));
    results.push(trialSpawnOffScreen(id));
    if (DIFFICULTIES[id].blockingBombShare > 0) {
      results.push(trialBlockingBombKillable(id));
    }
  }

  results.push(trialOneHeartPerObstacle());
  results.push(trialReadyStateIsSafe());
  results.push(trialGameOver());
  results.push(trialFlapArcInvariance());

  const failures = results.filter((r) => !r.pass);
  console.table(
    results.map((r) => ({
      trial: r.trial,
      mode: r.difficulty,
      result: r.pass ? 'PASS' : 'FAIL',
      detail: r.detail,
    })),
  );
  if (failures.length === 0) {
    console.log(`%c${results.length}/${results.length} fairness trials pass`, 'color: #2a2');
  } else {
    console.error(`${failures.length} of ${results.length} trials FAILED`);
  }
  return results;
}
