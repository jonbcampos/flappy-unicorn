/**
 * Every tuning number in the game lives in this file.
 *
 * Units: virtual pixels and seconds. The game simulates at a fixed virtual
 * resolution and the renderer scales that to whatever the device actually is,
 * so these numbers mean the same thing on every phone.
 *
 * Rule: nothing else in the codebase should contain a magic gameplay number.
 * If you want to change how the game feels, you change it here.
 */

// --- Screen -----------------------------------------------------------------

/**
 * The virtual frame the game is drawn into.
 *
 * Height is FIXED. Everything about flappy is vertical — gap height, flap rise,
 * how far you fall — so a constant height means the game plays identically on
 * every device. Width ADAPTS to the device aspect ratio between the clamps
 * below, because a fixed 16:9 frame on a modern 20:9 phone wastes two fat black
 * bars, and hazards entering at the bar's edge reads as popping into existence.
 */
export const DESIGN_W = 480;
export const VIRTUAL_H = 270;

/** Never narrower than the design width, or gates arrive with no warning. */
export const MIN_VIRTUAL_W = DESIGN_W;
/** 2.37:1 — covers every phone up to 21:9 without letterboxing. */
export const MAX_VIRTUAL_W = 640;

/** The live frame size. Mutated by Viewport on resize. */
export const SCREEN = { w: DESIGN_W, h: VIRTUAL_H, rotated: false };

/** Retina beyond 2x costs fill rate and buys nothing at this art scale. */
export const MAX_DPR = 2;

/** How far off the right edge things spawn, so nothing pops in mid-frame. */
export const SPAWN_MARGIN = 16;
export function spawnX(): number {
  return SCREEN.w + SPAWN_MARGIN;
}

// --- The flyable band -------------------------------------------------------

/**
 * The play field is a horizontal band with a hard surface at each end.
 *
 * Both boundaries are hazards, and both get a sprite drawn *exactly on* the
 * hitbox — a 3px lip at the floor, a clamped cloud underside at the ceiling.
 * The rule the runner game learned the hard way: a sprite may be smaller than
 * its hitbox, never larger. An overhanging sprite is a death the player watched
 * themselves avoid.
 */
export const CEILING_Y = 24; // 24px strip above for the HUD
export const FLOOR_Y = 210; // 60px strip below for the meadow and the buttons
export const BAND_H = FLOOR_Y - CEILING_Y; // 186

/** The unicorn's fixed horizontal position. The world moves, it doesn't. */
export const PLAYER_X = 96;

// --- Loop -------------------------------------------------------------------

/**
 * Physics advances in exact 1/120s increments regardless of refresh rate, and
 * the renderer interpolates between steps. Without this, flap heights literally
 * differ between a 60Hz and a 120Hz phone.
 */
export const FIXED_DT = 1 / 120;
/** Clamp on a single frame's elapsed time, so a stall doesn't teleport anyone. */
export const MAX_FRAME_TIME = 0.25;

// --- The unicorn ------------------------------------------------------------

export const UNICORN = {
  /** Wider than tall: a horse in level flight. */
  width: 28,
  height: 20,
  /**
   * The hurtbox sits inside the sprite. Horn, mane, tail and wingtips are all
   * decoration you cannot die by. This is invisible when it works and it is the
   * whole difference between "tight" and "this game is cheating".
   *
   * The insets grew along with the sprite, on purpose. The unicorn went from
   * 22x16 to 28x20 to be easier for a small child to see, and the *hurtbox
   * height stayed at 10* — a bigger character that is no harder to fly. Scaling
   * the hurtbox with the art instead would have quietly made every gap tighter,
   * which is the opposite of the reason for the change.
   */
  hurtboxInsetX: 6,
  hurtboxInsetY: 5, // true hurtbox: 16 x 10
  /** Seconds of mercy after a hit. See design contract 7 for the lower bound. */
  invulnDuration: 1.2,
  /** Where magic leaves the horn, relative to the sprite's left edge. */
  muzzleX: 28,
} as const;

/** Hurtbox dimensions, derived so nothing re-does the arithmetic wrong. */
export const UNICORN_HURT_W = UNICORN.width - 2 * UNICORN.hurtboxInsetX; // 16
export const UNICORN_HURT_H = UNICORN.height - 2 * UNICORN.hurtboxInsetY; // 10

/**
 * How long a press stays alive waiting to be acted on.
 *
 * A flap pressed 100ms before you meant it should still fire. Without this the
 * game "eats inputs", which players experience as the game being broken rather
 * than as their own timing being off.
 */
export const INPUT_TUNING = { bufferSeconds: 0.13 } as const;

// --- Flight -----------------------------------------------------------------

/**
 * The flap arc is defined in WORLD DISTANCE, not in time.
 *
 * This is the single most important idea in the file, and the direct heir of
 * the runner game's "tune in invariant units" rule. Impulse and gravity are
 * derived per tick from the current scroll speed, so the path the unicorn
 * traces *through the world* is identical at every speed. A gap that is
 * geometrically threadable at 140 px/s is geometrically threadable at 312 px/s.
 * What shrinks as the game speeds up is your time to read the gap — and that is
 * the honest difficulty lever, the one the player can feel and improve at.
 *
 * The alternative (fixed gravity, fixed impulse) makes the arc stretch out
 * horizontally as speed rises, so gaps that were fair at the start of a run
 * silently become unreachable later. You cannot tune your way out of that; the
 * geometry is simply wrong.
 */
export const FLIGHT = {
  /** Altitude gained at the apex of one flap from rest, in world px. */
  flapRise: 26,
  /**
   * World distance travelled while gaining it.
   *
   * Raised from 42 when the unicorn's sprite grew. A wider unicorn spends
   * longer inside a gate — the danger window is `GATE.width + UNICORN.width`,
   * which went 48 -> 54px — and free fall across that window is quadratic in
   * distance, so it jumped from 34 to 43px against HARD's 46px of slack. That
   * breaks the coast-through guarantee (contract 3): the gap would start
   * *requiring* a mid-column flap.
   *
   * Stretching the rise distance flattens the whole arc (curvature is
   * `2·flapRise/flapRiseDistance²`) and brings the fall back to 33px. The flap
   * feels marginally floatier and the apex is unchanged at exactly `flapRise`.
   */
  flapRiseDistance: 48,

  /**
   * Rails on the derived rise time, so extreme speeds stay playable. Below the
   * lower rail a flap would take most of a second; above the upper one it would
   * be a twitch. Direct analogue of the runner's jumpMin/MaxAirtime clamps.
   *
   * The upper rail is 0.45 rather than 0.42 so that the lower speed rail
   * (`flapRiseDistance / flapMaxRiseTime`) stays below EASY's 112px/s opening
   * speed. Otherwise the slowest mode would fly permanently clamped, which is
   * exactly where the arc invariance matters most.
   */
  flapMinRiseTime: 0.16,
  flapMaxRiseTime: 0.45,

  /** Fall speed cap, expressed as px fallen per px of forward travel. */
  terminalSlope: 2.2,
  /** Kick away from a surface after a boundary hit, as a slope. */
  boundaryBounceSlope: 0.85,
  /** Upward pop on death, so the corpse arcs before it falls off-screen. */
  deathPopSlope: 1.6,

  /**
   * Taps per second the fairness maths assumes a player can sustain.
   *
   * Deliberately conservative — this is the number the reachability guarantee
   * is bought with. Raise it and the director starts placing gates that only a
   * fast tapper can reach.
   */
  assumedTapRate: 5,

  /** Body tilt limits and how fast tilt chases velocity. Purely visual. */
  tiltUp: -0.42,
  tiltDown: 0.55,
  tiltLerp: 12,
} as const;

/** Lower and upper rail on the speed the arc is solved for. */
const ARC_SPEED_MIN = FLIGHT.flapRiseDistance / FLIGHT.flapMaxRiseTime; // 100
const ARC_SPEED_MAX = FLIGHT.flapRiseDistance / FLIGHT.flapMinRiseTime; // 262.5

/** The real speed, clamped by the rise-time rails. */
export function arcSpeedAt(scrollSpeed: number): number {
  return Math.min(ARC_SPEED_MAX, Math.max(ARC_SPEED_MIN, scrollSpeed));
}

/** Upward velocity a flap imparts, px/s. */
export function flapVelocityAt(scrollSpeed: number): number {
  return (2 * FLIGHT.flapRise * arcSpeedAt(scrollSpeed)) / FLIGHT.flapRiseDistance;
}

/** Downward acceleration, px/s². Derived so the apex is always `flapRise`. */
export function gravityAt(scrollSpeed: number): number {
  const a = arcSpeedAt(scrollSpeed);
  return (2 * FLIGHT.flapRise * a * a) / (FLIGHT.flapRiseDistance * FLIGHT.flapRiseDistance);
}

/** Fall speed cap, px/s. */
export function terminalVyAt(scrollSpeed: number): number {
  return FLIGHT.terminalSlope * arcSpeedAt(scrollSpeed);
}

/**
 * World curvature: how much *slope* the unicorn loses per px of forward travel.
 *
 * Constant by construction inside the rails, which is what makes the
 * free-fall geometry in the design contracts speed-independent.
 */
export const WORLD_CURVATURE =
  (2 * FLIGHT.flapRise) / (FLIGHT.flapRiseDistance * FLIGHT.flapRiseDistance); // 0.02948

/** Slope of the flap at the instant it fires: px up per px forward. */
export const FLAP_SLOPE = (2 * FLIGHT.flapRise) / FLIGHT.flapRiseDistance; // 1.238

// --- Magic ------------------------------------------------------------------

/**
 * Unlimited, cooldown only. No ammo, no meter.
 *
 * The cost of MAGIC isn't a resource — it's that **aiming is flying**. The shot
 * leaves the horn flat, so to hit a bomb you must first put yourself at the
 * bomb's altitude, which is the same control you're using to survive. That is
 * the entire reason a second button is interesting here, and it's why
 * unlimited-with-cooldown isn't the degenerate choice it looks like.
 */
export const SHOT = {
  speed: 400,
  width: 10,
  height: 6,
  poolSize: 24,
  /** Shots fizzle at the screen edge rather than sniping unseen things. */
  range: 330,
  cooldown: 0.32, // 3.1 shots/sec
} as const;

// --- Gates ------------------------------------------------------------------

export const GATE = {
  width: 26,
  /** Solid column that must remain above and below the opening. */
  minColumn: 22,
  /** The opening is 2px more generous at each lip than it looks. */
  hurtboxInset: 2,
  /**
   * Authored ceiling on the altitude change between consecutive gates. The
   * physics-derived ceiling is applied on top of this; the smaller wins.
   */
  maxDeltaY: 40,
  /** Fraction of the theoretically-reachable climb the director will ask for. */
  climbSafety: 0.65,
  score: 10,
  /** Cloud-tower variant unlocks here. Identical hitbox, different sprite. */
  towerFromSector: 3,
  poolSize: 8,
} as const;

/**
 * Gates that drift up and down.
 *
 * A minority of them, on purpose — the request was "some of the gates should
 * move, not a ton". A field where everything moves stops being readable; a
 * field where one gate in three moves makes you look at each one.
 *
 * The amplitude is small and the rate is slow, and both are bounded by design
 * contracts rather than chosen by feel alone. A moving gap is the one thing in
 * this game that can close on a player who did everything right, so the motion
 * has to stay well inside the slack that makes a gap coastable in the first
 * place (see contracts 16 and 17).
 */
export const MOVING_GATE = {
  /** Peak offset from the gate's base centre, in px. */
  amplitude: 14,
  /** Radians per second. Slow enough to read as drifting, not bobbing. */
  rate: 1.1,
  /** Not in the opening sector — the first gates should teach the basic shape. */
  fromSector: 2,
} as const;

// --- Biomes -----------------------------------------------------------------

export type Biome = 'meadow' | 'town';

/**
 * How long a stretch of one biome lasts, in world px.
 *
 * Keyed to *distance* rather than to sectors so the changeover scrolls in from
 * the right like everything else. Tying it to a sector boundary would swap the
 * entire background between one frame and the next, which reads as a glitch
 * rather than as arriving somewhere.
 */
export const BIOME_SPAN = 1500;

/** Which biome a given world x falls in. */
export function biomeAt(worldX: number): Biome {
  return Math.floor(worldX / BIOME_SPAN) % 2 === 0 ? 'meadow' : 'town';
}

// --- Bombs ------------------------------------------------------------------

export const BOMB = {
  width: 18,
  height: 18,
  /** Player-collision box: 12 x 12. Small, because dying is expensive. */
  hurtboxInset: 3,
  /** Shot-collision box: 24 x 24. Large, because missing is annoying. */
  shotboxPad: 3,
  hp: 1,
  bobAmplitude: 4,
  bobRate: 1.6,
  score: 25,
  /** Seconds a killed bomb stays on screen playing its blast. */
  deathTime: 0.18,

  /** How far a blocking bomb sits off the safe flight line. */
  blockOffset: 12,
  /** A blocking bomb is never this close to a gate column. */
  minGateClearance: 72, // GATE.width + UNICORN.width + 24
  /** Fraction of a bomb's approach assumed to be usable shooting time. */
  killSafetyFactor: 0.6,
  poolSize: 10,
} as const;

/**
 * Minimum distance from the safe flight line for a non-blocking bomb.
 *
 * Derived from gap height rather than hard-coded, because EASY's 72px gap needs
 * more clearance than HARD's 52px one and a single constant would be wrong for
 * two of the three modes.
 */
export function corridorClearance(gapHeight: number): number {
  return gapHeight / 2 + BOMB.height / 2 + UNICORN.height / 2 + 6;
}

// --- Fairies and people -----------------------------------------------------

export const FAIRY = {
  width: 14,
  height: 14,
  /**
   * Rescue boxes are INFLATED, not inset — the exact opposite of a hazard. You
   * should be able to *nearly* touch a fairy and still save her.
   */
  touchPad: 3,
  shotboxPad: 4,
  /** Shooting is worth more than touching, so the verb teaches itself. */
  scoreShot: 50,
  scoreTouch: 20,
  bobAmplitude: 5,
  bobRate: 2.2,
  /** Share placed exactly on the safe flight line, where they mark the path. */
  onLaneChance: 0.6,
  /** Never this close to a bomb, in either axis. */
  minSeparationFromBomb: 40,
  /** The "person" variant (a waving child) unlocks here. Identical hitbox. */
  personFromSector: 2,
  deathTime: 0.2,
  poolSize: 8,
} as const;

// --- World ------------------------------------------------------------------

export const WORLD = {
  baseScrollSpeed: 140,
  speedPerSector: 7,
  speedCap: 260,
  /** Seconds per sector. Speed and density step up at each boundary. */
  sectorLength: 20,
  /** Empty sky before the first gate, so a run doesn't open with a demand. */
  openingRest: 2.2,

  /** Seconds between gates, before difficulty scaling. */
  gateInterval: 1.35,
  gateIntervalJitter: 0.08,
  gateIntervalDecayPerSector: 0.03,
  minGateInterval: 0.95,
} as const;

// --- Difficulty -------------------------------------------------------------

export type DifficultyId = 'kid' | 'normal' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  label: string;
  speedScale: number;
  spacingScale: number;
  gapHeight: number;
  hearts: number;
  /**
   * Whether the ceiling is a soft clamp instead of a hazard.
   *
   * The flappy version of "EASY removes a thing to think about, not just a
   * button". A small child spams FLY; making the ceiling harmless deletes an
   * entire failure mode she cannot yet see coming, without turning the mode
   * into a different game.
   */
  ceilingIsSafe: boolean;
  bombChance: number;
  blockingBombShare: number;
  fairyChance: number;
  /** Fraction of gates that drift. See MOVING_GATE. */
  movingGateShare: number;
}

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  kid: {
    id: 'kid',
    label: 'EASY',
    speedScale: 0.8,
    spacingScale: 1.45,
    gapHeight: 72,
    hearts: 3,
    ceilingIsSafe: true,
    bombChance: 0.22,
    blockingBombShare: 0,
    fairyChance: 0.5,
    // A couple of drifting gates so the idea is introduced, not withheld.
    movingGateShare: 0.15,
  },
  normal: {
    id: 'normal',
    label: 'NORMAL',
    speedScale: 1,
    spacingScale: 1,
    gapHeight: 60,
    hearts: 2,
    ceilingIsSafe: false,
    bombChance: 0.5,
    blockingBombShare: 0.3,
    fairyChance: 0.45,
    movingGateShare: 0.3,
  },
  hard: {
    id: 'hard',
    label: 'HARD',
    speedScale: 1.2,
    spacingScale: 0.82,
    gapHeight: 52,
    hearts: 1,
    ceilingIsSafe: false,
    bombChance: 0.75,
    blockingBombShare: 0.5,
    fairyChance: 0.4,
    movingGateShare: 0.45,
  },
};

export const DIFFICULTY_ORDER: readonly DifficultyId[] = ['kid', 'normal', 'hard'];

/** Slowest and fastest this difficulty will ever scroll. */
export function speedRange(difficulty: Difficulty): { min: number; max: number } {
  return {
    min: WORLD.baseScrollSpeed * difficulty.speedScale,
    max: WORLD.speedCap * difficulty.speedScale,
  };
}

// --- Juice ------------------------------------------------------------------

export const JUICE = {
  /** Freezing the whole simulation for a few frames is what sells an impact. */
  hitstopDuration: 0.05,
  killHitstopDuration: 0.03,
  shakeOnHit: 6,
  shakeOnKill: 2.5,
  shakeDecay: 8,
  /** How long the sector banner stays up. */
  sectorFlash: 1.4,
} as const;
