import { Audio } from './core/audio';
import { Input } from './core/input';
import { startLoop } from './core/loop';
import { Viewport } from './core/viewport';
import { PLAYER_X, type DifficultyId } from './game/config';
import { GameState, validateDesignContracts, type GameEvent } from './game/state';
import { Particles } from './render/particles';
import { onFlap, resetUnicornAnim, updateUnicornAnim } from './render/rainbow';
import { sceneRenderer } from './render/scene';
import { addPopup, drawHud, resetHud, updateHud } from './ui/hud';
import {
  gameOverMenu,
  hitTestBox,
  hitTestMenu,
  muteButton,
  setMutedDisplay,
  titleMenu,
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
setMutedDisplay(audio.muted);

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

  if (state.phase === 'title') {
    if (hitTestBox(muteButton(), tap.x, tap.y)) {
      setMutedDisplay(audio.toggleMute());
      if (!audio.muted) audio.play('select');
      return;
    }
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

function startRun(difficulty: DifficultyId): void {
  lastDifficulty = difficulty;
  localStorage.setItem(DIFFICULTY_KEY, difficulty);
  previousBest = state.best;
  // A fresh seed per run. Deterministic within a run (see Rng), random between.
  state.start(difficulty, (Math.random() * 0xffffffff) >>> 0);
  particles.reset();
  resetHud();
  resetUnicornAnim();
  // Drop anything buffered by the tap that started the run, so the first frame
  // of gameplay doesn't open with a phantom flap.
  input.clearBuffers();
}

/**
 * Turn one simulation event into sound, particles and popups.
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
      break;
    case 'magic':
      audio.play('magic');
      break;
    case 'gate':
      audio.play('gate');
      particles.gateShimmer(PLAYER_X, event.y, random);
      break;
    case 'shot-fizzle':
      particles.shotFizzle(event.x, event.y, random);
      break;
    case 'bomb-pop':
      audio.play('pop');
      particles.bombBlast(event.x, event.y, random);
      addPopup(event.x, event.y, event.value);
      break;
    case 'bomb-blast':
      particles.bombBlast(event.x, event.y, random);
      break;
    case 'fairy-saved':
    case 'fairy-hug':
      audio.play('save');
      particles.fairySave(event.x, event.y, random);
      addPopup(event.x, event.y, event.value);
      break;
    case 'fairy-missed':
      // Deliberately silent. Missing a rescue is not a mistake to punish, and a
      // sad noise every time one drifts past would teach exactly that.
      break;
    case 'hit':
      audio.play('hit');
      particles.playerHit(event.x, event.y, random);
      break;
    case 'death':
      audio.play('death');
      particles.playerHit(event.x, event.y, random);
      break;
    case 'sector':
      audio.play('sector');
      break;
  }
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
  void Promise.all([import('./dev/verify'), import('./dev/tune')]).then(([v, t]) => {
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
    };
  });
}

// Keyboard shortcut for desktop testing: Enter on a menu.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Enter') return;
  if (state.phase === 'title' || state.phase === 'gameover') startRun(lastDifficulty);
});
