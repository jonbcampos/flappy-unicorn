import {
  DIFFICULTIES,
  FLIGHT,
  arcSpeedAt,
  flapVelocityAt,
  gravityAt,
  speedRange,
} from '../game/config';
import { freeFallOver, maxClimbOver } from '../game/corridor';
import { validateDesignContracts } from '../game/state';
import { verify } from './verify';

/**
 * Live tuning from the browser console.
 *
 * Game feel is not something you can reason your way to — you change a number,
 * play for ten seconds, and decide. That loop should take seconds, so this
 * mutates the config in place and the change applies to the very next flap.
 *
 * It also re-runs the design contracts and the full trial suite after every
 * change, because the feel knobs and the fairness constraints are the *same
 * numbers*. Making the flap snappier by shortening its rise distance quietly
 * steepens the fall, and a steeper fall is what makes a gap uncoastable. You
 * get told immediately instead of discovering it three runs later.
 *
 * Dev-only — the whole module is dropped from production builds.
 */

const TUNABLE = [
  'flapRise',
  'flapRiseDistance',
  'flapMinRiseTime',
  'flapMaxRiseTime',
  'terminalSlope',
  'boundaryBounceSlope',
  'deathPopSlope',
  'assumedTapRate',
  'tiltUp',
  'tiltDown',
] as const;

type Tunable = (typeof TUNABLE)[number];

export function tune(changes: Partial<Record<Tunable, number>>): void {
  // FLIGHT is `as const` for editing safety in source; at runtime it's a plain
  // object, and this is the one place allowed to write to it.
  const target = FLIGHT as unknown as Record<string, number>;

  for (const [key, value] of Object.entries(changes)) {
    if (!(TUNABLE as readonly string[]).includes(key)) {
      console.warn(`[tune] "${key}" isn't tunable. Options: ${TUNABLE.join(', ')}`);
      continue;
    }
    console.log(`[tune] ${key}: ${target[key]} -> ${value}`);
    target[key] = value as number;
  }

  const problems = validateDesignContracts();
  for (const problem of problems) console.error(`[tune] BROKE A DESIGN RULE: ${problem}`);

  const failures = verify().filter((r) => !r.pass);
  if (failures.length > 0) {
    console.error(
      `[tune] ${failures.length} fairness trials now fail:`,
      failures.map((f) => `${f.difficulty}/${f.trial}`).join(', '),
    );
  } else if (problems.length === 0) {
    console.log('[tune] all design contracts still hold');
  }

  showTuning();
}

/** Print the feel numbers, plus what they actually work out to in the air. */
export function showTuning(): void {
  console.log('--- feel ---');
  console.table(
    Object.fromEntries(
      TUNABLE.map((key) => [key, (FLIGHT as unknown as Record<string, number>)[key]!]),
    ),
  );

  // The derived values are what you experience. "flapRise 26" means nothing
  // next to "26px of lift against 54px of slack".
  console.log('--- what that means through a gap ---');
  console.table(
    Object.values(DIFFICULTIES).map((d) => {
      const { min, max } = speedRange(d);
      const freedom = d.gapHeight + 4 - 10;
      const dangerWindow = 26 + 22;
      return {
        mode: d.label,
        speed: `${Math.round(min)}→${Math.round(max)}`,
        'gap slack': `${freedom}px`,
        'flap lift': `${FLIGHT.flapRise}px`,
        'coast drop': `${freeFallOver(dangerWindow, min).toFixed(1)}px`,
        'rise time': `${(FLIGHT.flapRiseDistance / arcSpeedAt(min)).toFixed(2)}s`,
        'climb/100px @top': `${maxClimbOver(100, max).toFixed(1)}px`,
        'impulse @min': Math.round(flapVelocityAt(min)),
        'gravity @min': Math.round(gravityAt(min)),
      };
    }),
  );
  console.log(
    'Try: __game.tune({ flapRise: 30 })  — higher = floatier, lower = twitchier.\n' +
      '     __game.tune({ flapRiseDistance: 36 })  — lower = snappier, and steeper falls.',
  );
}
