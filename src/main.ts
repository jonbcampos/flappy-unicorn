import { Audio } from './core/audio';
import { Input } from './core/input';
import { startLoop } from './core/loop';
import { Viewport } from './core/viewport';
import { FIXED_DT, PLAYER_X, biomeAt, type DifficultyId } from './game/config';
import type { FairyKind } from './game/fairies';
import { GameState, validateDesignContracts, type GameEvent } from './game/state';
import { Particles } from './render/particles';
import {
  bombFizzleFrames,
  onCheer,
  onFlap,
  onOops,
  onZap,
  rescueCheerFrame,
  resetUnicornAnim,
  updateUnicornAnim,
} from './render/rainbow';
import { sceneRenderer } from './render/scene';
import { loadSprites } from './render/sprites';
import { addPopup, drawHud, resetHud, updateHud } from './ui/hud';
import {
  flashScreen,
  gameOverMenu,
  hitTestMenu,
  musicButton,
  muteButton,
  setMutedDisplay,
  titleMenu,
  updateScreens,
} from './ui/screens';
import { validateTouchpadContracts } from './ui/touchpad';

const BEST_KEY = 'flappy-unicorn.best';
const DIFFICULTY_KEY = 'flappy-unicorn.difficulty';

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
if (!canvas) throw new Error('#game canvas missing');

const viewport = new Viewport(canvas);
const input = new Input(viewport);
const state = new GameState();
const particles = new Particles();
const audio = new Audio();
setMutedDisplay(audio.muted, audio.musicMuted);

// Generated art and recorded sound are both optional and load in the
// background: with neither, the game is exactly the procedural one.
loadSprites(import.meta.env.BASE_URL);
audio.loadRecorded(import.meta.env.BASE_URL);

// Suspend sound with the page, resume with it (and music picks up where it was).
document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden));

// Surface any broken design contract loudly. These are the fairness guarantees
// the whole game is tuned around, and they break silently otherwise.
for (const problem of [...validateDesignContracts(), ...validateTouchpadContracts()]) {
  console.error(`[design] ${problem}`);
}

state.best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;
let lastDifficulty = (localStorage.getItem(DIFFICULTY_KEY) as DifficultyId | null) ?? 'kid';
let previousBest = state.best;

/**
 * Menu input routing.
 *
 * Menus are polled here rather than inside the simulation because they aren't
 * part of it — GameState.update() early-returns unless the phase is 'playing',
 * so it stays purely about the run itself.
 */
function routeMenus(): void {
  const tap = input.consumeTap();
  if (!tap) return;

  if (state.phase === 'title' || state.phase === 'gameover') {
    if (hitTestToggle(tap.x, tap.y)) return;
  }

  if (state.phase === 'title') {
    const hit = hitTestMenu(titleMenu(), tap.x, tap.y);
    if (hit && hit.id !== 'restart' && hit.id !== 'menu') {
      audio.play('select');
      startRun(hit.id);
    }
    return;
  }

  if (state.phase === 'gameover') {
    const hit = hitTestMenu(gameOverMenu(), tap.x, tap.y);
    if (hit?.id === 'restart') {
      audio.play('select');
      startRun(lastDifficulty);
    } else if (hit?.id === 'menu') {
      audio.play('select');
      state.phase = 'title';
    }
  }
}

/** The two sound toggles. True if the tap was one of them. */
function hitTestToggle(x: number, y: number): boolean {
  // Tighter than hitTestBox's padding, because the two sit side by side.
  const inside = (b: { x: number; y: number; w: number; h: number }): boolean =>
    x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 8 && y <= b.y + b.h + 8;
  if (inside(muteButton())) {
    audio.toggleMute();
    if (!audio.muted) audio.play('select');
  } else if (inside(musicButton())) {
    audio.toggleMusic();
    audio.play('select');
  } else return false;
  setMutedDisplay(audio.muted, audio.musicMuted);
  return true;
}

function startRun(difficulty: DifficultyId): void {
  lastDifficulty = difficulty;
  localStorage.setItem(DIFFICULTY_KEY, difficulty);
  previousBest = state.best;
  // A fresh seed per run. Deterministic within a run (see Rng), random between.
  state.start(difficulty, (Math.random() * 0xffffffff) >>> 0);
  particles.reset();
  resetHud();
  resetUnicornAnim();
  streak = 0;
  chatter.reset();
  // Drop anything buffered by the tap that started the run, so the first frame
  // of gameplay doesn't open with a phantom flap.
  input.clearBuffers();
}

/**
 * Who says what, and how often.
 *
 * Slingshot's lesson (its DECISIONS.md 18): characters who talk too much stop
 * being funny within a minute. So one voice at a time, a quiet gap after any
 * optional line, and most lines are a chance rather than a certainty. The ones
 * that carry information (a bump, the end of the run) always play.
 */
class Chatter {
  private quietUntil = 0;
  private clock = 0;

  tick(dt: number): void {
    this.clock += dt;
  }

  reset(): void {
    this.quietUntil = 0;
  }

  /** An optional line: only if it's been quiet, and only `chance` of the time. */
  maybe(ids: readonly string[], chance: number, delay = 0): boolean {
    if (this.clock < this.quietUntil || Math.random() > chance) return false;
    if (!audio.say(ids, { delay })) return false;
    this.quietUntil = this.clock + 4.5;
    return true;
  }

  /** A line that matters: interrupts, and still starts the quiet gap. */
  always(ids: readonly string[]): void {
    if (audio.say(ids, { interrupt: true })) this.quietUntil = this.clock + 4.5;
  }
}

const chatter = new Chatter();
/** Gates in a row without a bump: the chime climbs a scale as it grows. */
let streak = 0;
/** Seconds until the next twinkle is shed behind the unicorn. */
let trailClock = 0;

/** Which kind of rescue just happened at (x, y)? Looked up, since events carry no kind. */
function rescueKindAt(x: number, y: number): FairyKind {
  let best: FairyKind = 'fairy';
  let bestD = Infinity;
  for (const f of state.fairies.items) {
    if (!f.active) continue;
    const d = Math.abs(f.x - x) + Math.abs(f.y - y);
    if (d < bestD) {
      bestD = d;
      best = f.kind;
    }
  }
  return best;
}

/**
 * Turn one simulation event into sound, particles, popups and poses.
 *
 * This lives here rather than in the game so that `src/game/` stays unaware of
 * both renderers and speakers — the same boundary that would keep a second skin
 * a drop-in rather than a rewrite.
 */
function presentEvent(event: GameEvent): void {
  const random = (): number => state.rng.next();
  switch (event.type) {
    case 'flap':
      audio.play('flap');
      onFlap();
      if (state.gatesPassed === 0 && state.elapsed < 0.05) chatter.always(['e.go']);
      break;
    case 'magic':
      audio.play('magic');
      onZap();
      break;
    case 'gate':
      audio.play('gate', streak);
      streak++;
      particles.gateShimmer(PLAYER_X, event.y, random);
      if (streak > 0 && streak % 8 === 0) chatter.maybe(['e.whee', 'e.yay'], 0.7);
      break;
    case 'shot-fizzle':
      particles.shotFizzle(event.x, event.y, random);
      break;
    case 'bomb-pop':
      audio.play('pop');
      particles.bombZap(event.x, event.y, random, bombFizzleFrames());
      addPopup(event.x, event.y, event.value);
      chatter.maybe(['e.gotit'], 0.3, 0.1);
      break;
    case 'bomb-blast':
      audio.play('blast');
      particles.bombBlast(event.x, event.y, random, bombFizzleFrames());
      break;
    case 'fairy-saved':
    case 'fairy-hug': {
      const kind = rescueKindAt(event.x, event.y);
      audio.play('save');
      onCheer();
      particles.fairySave(event.x, event.y, random, rescueCheerFrame(kind));
      addPopup(event.x, event.y, event.value);
      // The one you saved says thanks (squeaky), or now and then Ellie cheers.
      if (!chatter.maybe([kind === 'person' ? 'k.yippee' : 'f.thanks'], 0.6, 0.15)) {
        chatter.maybe(['e.yay'], 0.3, 0.2);
      }
      break;
    }
    case 'fairy-missed':
      // Deliberately silent. Missing a rescue is not a mistake to punish, and a
      // sad noise every time one drifts past would teach exactly that.
      break;
    case 'hit':
      audio.play('hit');
      onOops();
      streak = 0;
      flashScreen('#ff9ec7', 0.3);
      particles.playerHit(event.x, event.y, random);
      chatter.always(['e.uhoh']);
      break;
    case 'death':
      audio.play('hit');
      audio.play('death');
      onOops();
      streak = 0;
      flashScreen('#ff9ec7', 0.4);
      particles.playerHit(event.x, event.y, random);
      chatter.always(['e.ohno']);
      break;
    case 'sector':
      audio.play('sector');
      chatter.maybe(['e.whee'], 0.6, 0.3);
      break;
  }
}

/** Which music fits what's on screen: the title, or the biome under the unicorn. */
function musicFor(): string {
  if (state.phase === 'title' || state.phase === 'gameover') return 'music.title';
  return biomeAt(state.distance + PLAYER_X) === 'town' ? 'music.town' : 'music.meadow';
}

/** One simulation step: menus, then the run itself, then presentation. */
function step(dt: number): void {
  // Any touch at all is a valid gesture to start audio with; browsers refuse
  // to create an AudioContext before one.
  if (input.consumeAnyPress()) audio.unlock();

  routeMenus();
  state.update(dt, input);
  state.drainEvents(presentEvent);

  const scroll = state.phase === 'playing' && state.hitstop <= 0 ? state.scrollSpeed : 0;
  particles.update(dt, scroll);
  updateHud(dt, scroll);
  updateUnicornAnim(dt);
  updateScreens(dt, state.phase);
  chatter.tick(dt);

  // Twinkles streaming from the unicorn while it flies.
  if (state.phase === 'playing' && !state.player.dead) {
    trailClock -= dt;
    if (trailClock <= 0) {
      trailClock = 0.05;
      particles.trail(PLAYER_X - 14, state.player.y + 2, Math.random);
    }
  }

  audio.setMusic(musicFor());
  audio.updateMusic();

  if (state.best > previousBest) {
    previousBest = state.best;
    localStorage.setItem(BEST_KEY, String(state.best));
  }
}

startLoop({
  update: step,
  render(alpha) {
    sceneRenderer.draw(viewport.ctx, state, input, alpha, particles);
  },
});

/**
 * Register the service worker in production only.
 *
 * Deliberately not in dev: a caching worker sitting in front of the Vite dev
 * server intercepts module requests and serves stale code, which produces
 * "I changed the file and nothing happened" bugs that cost far more time than
 * the worker saves.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // BASE_URL keeps this correct whether the game is served from the domain
    // root or from a GitHub Pages subpath.
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch((error) => console.warn('[sw] registration failed', error));
  });
}

// Dev-only handle for poking at a live run from the console.
if (import.meta.env.DEV) {
  void Promise.all([import('./dev/verify'), import('./dev/tune'), import('./dev/art')]).then(([v, t, a]) => {
    (window as unknown as Record<string, unknown>).__game = {
      state,
      input,
      viewport,
      audio,
      particles,
      startRun,
      verify: v.verify,
      tune: t.tune,
      showTuning: t.showTuning,
      // Lets a test drive the real loop body when rAF is unavailable — e.g. a
      // backgrounded tab, where the browser suspends animation frames entirely.
      step,
      drawHud,
      checkArt: a.checkArt,
      /**
       * Advance the real loop body by `seconds` and draw the result, for
       * screenshots from a tab whose animation frames are throttled.
       */
      advance(seconds: number) {
        for (let t = 0; t < seconds; t += FIXED_DT) step(FIXED_DT);
        sceneRenderer.draw(viewport.ctx, state, input, 1, particles);
      },
    };
  });
}

// Keyboard shortcut for desktop testing: Enter on a menu.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Enter') return;
  if (state.phase === 'title' || state.phase === 'gameover') startRun(lastDifficulty);
});
