/**
 * Sound effects, synthesised sample by sample.
 *
 * The first set was one oscillator and one burst of hiss per sound, which is
 * what made the game sound like 1985. These are built the way slingshot's are
 * (its DECISIONS.md 16): from how real sounds work, not from a single tone.
 *
 *  - **Struck, ringing things are modal**: several damped partials at the
 *    inharmonic ratios of a bell or a glass. That's the gate chime, the save
 *    sparkle and the magic.
 *  - **Air is shaped noise**: a wing-beat is noise swept through a moving
 *    band, fluttered by the feathers.
 *  - **A cartoon bonk is a woodblock and a spring**, never a crunch. Nobody is
 *    ever hurt in this game, and the hit sound has to say "oops", not "ow".
 *
 * Each function returns raw samples at a given sample rate and is pure apart
 * from `Math.random`, so the Audio class caches a few random variants of each.
 *
 * The palette rule has an audio counterpart, kept from the original set:
 * **rescues sound bright and rising, hazards low and falling.** A child who
 * can't yet read the sprites can still hear whether that was good.
 */

export type SfxKind = 'flap' | 'magic' | 'fizzle' | 'save' | 'chime' | 'bonk' | 'poof' | 'gameover' | 'sector';

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export function synth(kind: SfxKind, sr: number): Float32Array {
  switch (kind) {
    case 'flap':
      return wingbeat(sr);
    case 'magic':
      return magic(sr);
    case 'fizzle':
      return fizzle(sr);
    case 'save':
      return sparkle(sr);
    case 'chime':
      // One bell at a fixed pitch; the caller re-pitches it up the scale with
      // playbackRate, so a streak climbs without a buffer per note.
      return bell(sr, 1046.5, 0.9);
    case 'bonk':
      return bonk(sr);
    case 'poof':
      return poof(sr);
    case 'gameover':
      return wahWah(sr);
    case 'sector':
      return fanfare(sr);
  }
}

// --- Building blocks -------------------------------------------------------------

function buffer(sr: number, seconds: number): Float32Array {
  return new Float32Array(Math.floor(sr * seconds));
}

function normalise(out: Float32Array, peak = 0.9): Float32Array {
  let max = 1e-6;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]!));
  const k = peak / max;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * k;
  return out;
}

/** Add a struck bell into `out` at `at` seconds: inharmonic partials, each dying at its own rate. */
function addBell(out: Float32Array, sr: number, at: number, f: number, amp: number, length = 1): void {
  const ratios = [1, 2.76, 5.4, 8.93];
  const decays = [3.2, 6, 11, 18].map((d) => d / length);
  const amps = [1, 0.45, 0.22, 0.1];
  const start = Math.floor(at * sr);
  for (let i = start; i < out.length; i++) {
    const t = (i - start) / sr;
    let s = 0;
    for (let k = 0; k < ratios.length; k++) {
      s += amps[k]! * Math.exp(-decays[k]! * t) * Math.sin(2 * Math.PI * f * ratios[k]! * t);
    }
    // A 2 ms attack, so the strike is a ping and not a click.
    out[i] = out[i]! + s * amp * Math.min(1, t * 500);
  }
}

// --- The sounds ---------------------------------------------------------------------

function bell(sr: number, f: number, seconds: number): Float32Array {
  const out = buffer(sr, seconds);
  addBell(out, sr, 0, f, 1, 0.8);
  return normalise(out, 0.8);
}

/**
 * A wing-beat: a soft "fwup". Noise through a band that sweeps down then up,
 * fluttered at about 28 Hz by the feathers. Quiet and round, because it fires
 * several times a second and anything percussive becomes a machine gun.
 */
function wingbeat(sr: number): Float32Array {
  const seconds = 0.22;
  const out = buffer(sr, seconds);
  let lp = 0;
  let lp2 = 0;
  const flutter = rnd(24, 32);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const u = t / seconds;
    // The band: low push, then the lift.
    const fc = 300 + 1300 * Math.sin(Math.PI * u) ** 2;
    const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    lp += (Math.random() * 2 - 1 - lp) * a;
    lp2 += (lp - lp2) * 0.04; // a gentle high-pass by subtraction
    const env = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 1.5;
    const feathers = 0.75 + 0.25 * Math.sin(2 * Math.PI * flutter * t);
    out[i] = (lp - lp2) * env * feathers;
  }
  return normalise(out, 0.7);
}

/** The horn's magic: a bright upward glissando with a shimmer of tiny bells. */
function magic(sr: number): Float32Array {
  const seconds = 0.45;
  const out = buffer(sr, seconds);
  let phase = 0;
  let phase2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const f = 900 * Math.pow(2, Math.min(1, t / 0.12));
    phase += (2 * Math.PI * f) / sr;
    phase2 += (2 * Math.PI * f * 1.5) / sr;
    const env = Math.min(1, t * 300) * Math.exp(-t * 14);
    out[i] = (Math.sin(phase) * 0.6 + Math.sin(phase2) * 0.25) * env;
  }
  for (let k = 0; k < 4; k++) addBell(out, sr, 0.03 + k * 0.035, rnd(2400, 4200), 0.25, 0.25);
  return normalise(out, 0.75);
}

/**
 * A zapped bomb fizzling into confetti: a soft "pfoomp", a fizz that hisses
 * away, and a sprinkle of tinkles as the confetti flies. Deliberately not an
 * explosion: nothing in this game blows up at anybody.
 */
function fizzle(sr: number): Float32Array {
  const seconds = 0.8;
  const out = buffer(sr, seconds);
  let phase = 0;
  let hp = 0;
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    // Pfoomp: a round low thump sliding down.
    const f = 70 + 160 * Math.exp(-t * 30);
    phase += (2 * Math.PI * f) / sr;
    const thump = Math.sin(phase) * Math.exp(-t * 16);
    // Fizz: bright noise with a slow random sputter.
    const n = Math.random() * 2 - 1;
    lp += (n - lp) * 0.5;
    hp += (lp - hp) * 0.08;
    const sputter = 0.6 + 0.4 * Math.sin(2 * Math.PI * 37 * t + Math.sin(2 * Math.PI * 7 * t) * 3);
    const fizz = (lp - hp) * Math.min(1, t * 60) * Math.exp(-t * 5) * sputter * 0.55;
    out[i] = thump * 1.1 + fizz;
  }
  for (let k = 0; k < 6; k++) addBell(out, sr, rnd(0.06, 0.35), rnd(1800, 4200), rnd(0.15, 0.3), 0.3);
  return normalise(out, 0.85);
}

/** A rescue: four bells climbing a major arpeggio, with a glittering tail. */
function sparkle(sr: number): Float32Array {
  const out = buffer(sr, 1.1);
  const notes = [784, 988, 1175, 1568];
  notes.forEach((f, k) => addBell(out, sr, k * 0.065, f, 0.7 + k * 0.1, 0.9));
  for (let k = 0; k < 8; k++) addBell(out, sr, 0.25 + Math.random() * 0.4, rnd(2600, 5200), 0.12, 0.25);
  return normalise(out, 0.85);
}

/**
 * A cartoon bonk: a woodblock knock and a wobbling spring sliding down. "Oops!",
 * not "ow". The falling pitch is the hazard half of the palette rule.
 */
function bonk(sr: number): Float32Array {
  const seconds = 0.55;
  const out = buffer(sr, seconds);
  const knock = rnd(560, 640);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const wood =
      Math.sin(2 * Math.PI * knock * t) * Math.exp(-t * 45) +
      0.5 * Math.sin(2 * Math.PI * knock * 2.3 * t) * Math.exp(-t * 70);
    const f = 420 * Math.exp(-t * 2.2) * (1 + 0.22 * Math.sin(2 * Math.PI * 15 * t) * Math.exp(-t * 2));
    phase += (2 * Math.PI * f) / sr;
    const spring = Math.sin(phase) * Math.min(1, t * 60) * Math.exp(-t * 5) * 0.7;
    out[i] = wood + spring;
  }
  return normalise(out, 0.85);
}

/** A bomb you flew into: a soft puff of smoke, the companion of the bonk. */
function poof(sr: number): Float32Array {
  const seconds = 0.5;
  const out = buffer(sr, seconds);
  let lp = 0;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const fc = 2400 * Math.exp(-t * 7) + 150;
    const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    lp += (Math.random() * 2 - 1 - lp) * a;
    phase += (2 * Math.PI * (55 + 90 * Math.exp(-t * 20))) / sr;
    out[i] = lp * Math.min(1, t * 200) * Math.exp(-t * 6) * 1.3 + Math.sin(phase) * Math.exp(-t * 12) * 0.8;
  }
  return normalise(out, 0.8);
}

/**
 * Game over: a gentle three-step "wah, wah, waaah" on a soft square-ish tone
 * with vibrato on the last note. A friendly "try again", never a failure klaxon.
 */
function wahWah(sr: number): Float32Array {
  const out = buffer(sr, 1.6);
  const notes: [number, number, number][] = [
    [392, 0, 0.26],
    [370, 0.3, 0.26],
    [349, 0.6, 0.9],
  ];
  for (const [f, at, len] of notes) {
    const start = Math.floor(at * sr);
    let phase = 0;
    for (let i = start; i < Math.min(out.length, start + Math.floor(len * sr)); i++) {
      const t = (i - start) / sr;
      const vib = len > 0.5 ? 1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t * 3) : 1;
      const bend = len > 0.5 ? 1 - 0.06 * Math.max(0, t - 0.4) : 1;
      phase += (2 * Math.PI * f * vib * bend) / sr;
      // A "wah": the brightness opens then closes, like a muted trumpet.
      const open = Math.sin(Math.PI * Math.min(1, t / len));
      const s = Math.sin(phase) + 0.35 * open * Math.sin(2 * phase) + 0.18 * open * Math.sin(3 * phase);
      const env = Math.min(1, t * 40) * Math.min(1, (len - t) * 12);
      out[i] = out[i]! + s * env * 0.6;
    }
  }
  return normalise(out, 0.7);
}

/** A new sector: a quick twinkling run up, like a harp glissando. */
function fanfare(sr: number): Float32Array {
  const out = buffer(sr, 1.0);
  const scale = [523, 587, 659, 784, 880, 1047, 1175, 1319];
  scale.forEach((f, k) => addBell(out, sr, k * 0.04, f, 0.5, 0.6));
  addBell(out, sr, 0.36, 1568, 0.8, 1);
  return normalise(out, 0.8);
}
