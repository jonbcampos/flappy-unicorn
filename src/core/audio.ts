import { synth, type SfxKind } from './sfx';

/**
 * All the sound in the game: synthesised effects, plus optional recorded
 * voices and music (`npm run sound`, scripts/sound-manifest.mjs).
 *
 * The structure is slingshot's (its DECISIONS.md 16), which is this game's
 * original structure grown up:
 *
 *  - The AudioContext can't exist until a user gesture, so it's created lazily
 *    on the first input. A context can also be suspended by the browser when
 *    the app is backgrounded, so every play checks and resumes, and the page
 *    suspends it on purpose when hidden (see `setHidden`).
 *  - Everything goes through a compressor, with a shared short reverb send, so
 *    effects, voices and music sit in the same airy space instead of being
 *    pasted on top of one another.
 *  - Recorded files are optional exactly like the art: no index, or a file
 *    that fails, and the game plays with its synthesised effects alone.
 *  - Voices play one at a time and duck the music.
 *
 * Music and sound effects are muted SEPARATELY, and both settings persist. A
 * parent may well want the sounds and not the music, or vice versa.
 *
 * The palette rule has an audio counterpart: **rescues sound bright and
 * rising, hazards low and falling.**
 */

export type Sfx = 'flap' | 'magic' | 'pop' | 'save' | 'gate' | 'hit' | 'blast' | 'death' | 'sector' | 'select';

const SOUND_KEY = 'flappy-unicorn.muted';
const MUSIC_KEY = 'flappy-unicorn.music-muted';

/** Music sits well under everything else: the effects are the information. */
const MUSIC_LEVEL = 0.26;
const MUSIC_FADE = 1.6;
const LOOP_XFADE = 1.5;
const VARIANTS = 3;

/** Which synthesised buffer each effect plays, how loud, and how much reverb. */
const SYNTH_SFX: Record<Exclude<Sfx, 'gate' | 'select'>, { kind: SfxKind; gain: number; reverb: number }> = {
  flap: { kind: 'flap', gain: 0.28, reverb: 0.05 },
  magic: { kind: 'magic', gain: 0.32, reverb: 0.25 },
  pop: { kind: 'fizzle', gain: 0.6, reverb: 0.3 },
  save: { kind: 'save', gain: 0.5, reverb: 0.4 },
  hit: { kind: 'bonk', gain: 0.7, reverb: 0.15 },
  blast: { kind: 'poof', gain: 0.5, reverb: 0.2 },
  death: { kind: 'gameover', gain: 0.55, reverb: 0.3 },
  sector: { kind: 'sector', gain: 0.45, reverb: 0.45 },
};

/** A major pentatonic, in semitones: a streak of gates climbs it. */
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicMute: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private readonly sfx = new Map<SfxKind, AudioBuffer[]>();

  /** Sound effects and voices off. */
  muted: boolean;
  /** Music off. */
  musicMuted: boolean;

  private hidden = false;

  constructor() {
    this.muted = readFlag(SOUND_KEY);
    this.musicMuted = readFlag(MUSIC_KEY);
  }

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    writeFlag(SOUND_KEY, this.muted);
    if (this.sfxBus && this.ctx) this.sfxBus.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  toggleMusic(): boolean {
    this.musicMuted = !this.musicMuted;
    writeFlag(MUSIC_KEY, this.musicMuted);
    if (this.musicMute && this.ctx) {
      this.musicMute.gain.setTargetAtTime(this.musicMuted ? 0 : 1, this.ctx.currentTime, 0.15);
    }
    return this.musicMuted;
  }

  /**
   * The page went to the background, or came back. Suspending on purpose
   * rather than waiting for the browser to do it means music doesn't keep
   * playing from a phone in a pocket, and resuming is immediate on return.
   */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /** Call from a real user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;

      // A compressor on everything: a save sparkle on top of a gate chime on
      // top of a voice stays clear instead of clipping.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      this.master.connect(comp);
      comp.connect(ctx.destination);

      // An airy outdoor reverb, a little longer than slingshot's: this game is
      // set up in the sky.
      const reverb = ctx.createConvolver();
      reverb.buffer = this.makeReverb(ctx);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.9;
      this.reverbSend.connect(reverb);
      reverb.connect(this.master);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.muted ? 0 : 1;
      this.sfxBus.connect(this.master);

      this.musicMute = ctx.createGain();
      this.musicMute.gain.value = this.musicMuted ? 0 : 1;
      this.musicMute.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = MUSIC_LEVEL;
      this.musicBus.connect(this.musicMute);

      this.decodeAll();
      // Build each effect's first variant now, a few milliseconds apart, so the
      // first flap doesn't hitch while it's being synthesised.
      Object.values(SYNTH_SFX)
        .map((v) => v.kind)
        .concat('chime')
        .forEach((kind, i) => setTimeout(() => this.variant(kind), 30 * (i + 1)));
    }
    if (this.ctx.state === 'suspended' && !this.hidden) void this.ctx.resume();
  }

  // --- Recorded sound: voices and music ------------------------------------------

  private readonly raw = new Map<string, ArrayBuffer>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly rates = new Map<string, number>();
  private voiceUntil = 0;
  private music: { id: string; gain: GainNode; sources: AudioBufferSourceNode[]; nextAt: number } | null = null;
  private wantMusic = '';
  private readonly loops = new Map<string, { start: number; end: number }>();

  /** Fetch the recorded sounds. Never throws; anything missing just stays silent. */
  loadRecorded(baseUrl: string): void {
    void (async () => {
      let index: { ext?: string; voices?: string[]; music?: string[]; rates?: Record<string, number> };
      try {
        const r = await fetch(`${baseUrl}sounds/index.json`, { cache: 'no-cache' });
        if (!r.ok) return;
        index = await r.json();
      } catch {
        return;
      }
      const ext = index.ext ?? 'm4a';
      for (const [id, rate] of Object.entries(index.rates ?? {})) this.rates.set(id, rate);
      // Voices first: they're small and used from the first second. Then the
      // title music, because that's what plays first.
      const music = [...(index.music ?? [])].sort((a, b) => (a === 'music.title' ? -1 : b === 'music.title' ? 1 : 0));
      for (const id of [...(index.voices ?? []), ...music]) {
        try {
          const r = await fetch(`${baseUrl}sounds/${id}.${ext}`);
          if (r.ok) this.raw.set(id, await r.arrayBuffer());
        } catch {
          // One missing file loses one sound.
        }
        if (this.ctx) this.decodeAll();
      }
    })();
  }

  private decodeAll(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const [id, bytes] of this.raw) {
      this.raw.delete(id);
      void ctx.decodeAudioData(bytes).then(
        (buffer) => this.buffers.set(id, buffer),
        () => {},
      );
    }
  }

  /** True if this recorded sound is ready to play. */
  has(id: string): boolean {
    return this.buffers.has(id);
  }

  /** True while a voice line is still being spoken. */
  get talking(): boolean {
    return this.ctx !== null && this.ctx.currentTime < this.voiceUntil;
  }

  /**
   * Say one of `ids`, at random. Returns false if none is loaded (or sound is
   * off), so the caller knows nothing was said.
   *
   * One voice at a time: a line that would start while another is still
   * talking is dropped, unless `interrupt`.
   */
  say(ids: readonly string[], opts: { delay?: number; gain?: number; interrupt?: boolean } = {}): boolean {
    if (this.muted || !this.ctx || !this.sfxBus) return false;
    const ready = ids.filter((id) => this.buffers.has(id));
    if (ready.length === 0) return false;
    const ctx = this.ctx;
    const at = ctx.currentTime + (opts.delay ?? 0);
    if (at < this.voiceUntil && !opts.interrupt) return false;
    const id = ready[Math.floor(Math.random() * ready.length)]!;
    const buffer = this.buffers.get(id)!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const rate = (this.rates.get(id) ?? 1) * (0.97 + Math.random() * 0.06);
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = opts.gain ?? 0.95;
    source.connect(gain);
    gain.connect(this.sfxBus);
    const send = ctx.createGain();
    send.gain.value = 0.12;
    gain.connect(send);
    if (this.reverbSend) send.connect(this.reverbSend);
    source.start(at);
    this.voiceUntil = at + buffer.duration / rate;
    this.duck(0.45, buffer.duration / rate, at);
    return true;
  }

  /** Ask for a music track. Crossfades if it's different; `''` fades music out. */
  setMusic(id: string): void {
    this.wantMusic = id;
  }

  /**
   * Keep the music going. Call every frame: it starts, crossfades and loops
   * tracks by scheduling the next segment a little ahead of time. A biome
   * change is just a different `setMusic`, so meadow and town crossfade.
   */
  updateMusic(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus || this.hidden) return;
    const want = this.wantMusic && this.buffers.has(this.wantMusic) ? this.wantMusic : '';
    const now = ctx.currentTime;

    if (this.music && this.music.id !== want) {
      const old = this.music;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0.0001, now + MUSIC_FADE);
      for (const src of old.sources) src.stop(now + MUSIC_FADE + 0.05);
      this.music = null;
    }
    if (!want) return;
    if (!this.music) {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(1, now + MUSIC_FADE);
      gain.connect(bus);
      this.music = { id: want, gain, sources: [], nextAt: now };
    }
    const m = this.music;
    if (m.nextAt - now > 2) return;
    const buffer = this.buffers.get(m.id)!;
    const loop = this.loopOf(m.id, buffer);
    const length = loop.end - loop.start;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const seg = ctx.createGain();
    const t0 = Math.max(now, m.nextAt);
    seg.gain.setValueAtTime(0.0001, t0);
    seg.gain.linearRampToValueAtTime(1, t0 + LOOP_XFADE);
    seg.gain.setValueAtTime(1, t0 + length - LOOP_XFADE);
    seg.gain.linearRampToValueAtTime(0.0001, t0 + length);
    source.connect(seg);
    seg.connect(m.gain);
    source.start(t0, loop.start, length);
    m.sources = [...m.sources.slice(-2), source];
    m.nextAt = t0 + length - LOOP_XFADE;
  }

  /**
   * The steady part of a track: from where it reaches full volume to where it
   * starts to fade. Lyria clips are about thirty seconds and often fade out at
   * the end; looping the whole thing would dip to silence every lap.
   */
  private loopOf(id: string, buffer: AudioBuffer): { start: number; end: number } {
    const cached = this.loops.get(id);
    if (cached) return cached;
    const data = buffer.getChannelData(0);
    const win = Math.floor(buffer.sampleRate * 0.1);
    const rms: number[] = [];
    for (let i = 0; i + win <= data.length; i += win) {
      let sum = 0;
      for (let j = i; j < i + win; j++) sum += data[j]! * data[j]!;
      rms.push(Math.sqrt(sum / win));
    }
    const sorted = [...rms].sort((a, b) => a - b);
    const level = (sorted[sorted.length >> 1] ?? 0) * 0.6;
    let first = rms.findIndex((v) => v >= level);
    let last = rms.length - 1 - [...rms].reverse().findIndex((v) => v >= level);
    if (first < 0 || last <= first) {
      first = 0;
      last = rms.length - 1;
    }
    let start = Math.min(first * 0.1, 4);
    let end = (last + 1) * 0.1;
    if (end - start < 8) {
      start = 0;
      end = buffer.duration;
    }
    const loop = { start, end };
    this.loops.set(id, loop);
    return loop;
  }

  /** Dip the music for a voice line, then bring it back. */
  duck(to: number, seconds: number, at?: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    const t = at ?? ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setTargetAtTime(MUSIC_LEVEL * to, t, 0.05);
    bus.gain.setTargetAtTime(MUSIC_LEVEL, t + seconds, 0.4);
  }

  // --- Effects ---------------------------------------------------------------------------

  /** One of a few cached random variants of a synthesised effect. */
  private variant(kind: SfxKind): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    let variants = this.sfx.get(kind);
    if (!variants) {
      variants = [];
      this.sfx.set(kind, variants);
    }
    if (variants.length < VARIANTS) {
      const data = synth(kind, ctx.sampleRate);
      const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buffer.getChannelData(0).set(data);
      variants.push(buffer);
      return buffer;
    }
    return variants[Math.floor(Math.random() * variants.length)]!;
  }

  private playSynth(kind: SfxKind, gain: number, reverb: number, rate: number): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    const buffer = this.variant(kind);
    if (!ctx || !bus || !buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    source.connect(g);
    g.connect(bus);
    if (this.reverbSend && reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      g.connect(send);
      send.connect(this.reverbSend);
    }
    source.start();
  }

  /**
   * Play an effect. `step` is only read by 'gate': how many gates in a row
   * without a bump, which climbs the chime up a pentatonic scale, so a streak
   * sounds like a tune building.
   */
  play(sfx: Sfx, step = 0): void {
    if (this.muted || !this.ctx || !this.sfxBus) return;
    if (this.ctx.state === 'suspended' && !this.hidden) void this.ctx.resume();
    if (sfx === 'gate') {
      const semis = PENTATONIC[Math.min(step, PENTATONIC.length - 1)]!;
      this.playSynth('chime', 0.26, 0.35, Math.pow(2, (semis - 12) / 12));
      return;
    }
    if (sfx === 'select') {
      this.tone('triangle', 660, 990, this.ctx.currentTime, 0.08, 0.16);
      return;
    }
    const spec = SYNTH_SFX[sfx];
    this.playSynth(spec.kind, spec.gain, spec.reverb, 0.95 + Math.random() * 0.1);
  }

  private tone(type: OscillatorType, fromHz: number, toHz: number, start: number, duration: number, peak: number): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, start);
    if (toHz !== fromHz) osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /** A short stereo reverb: decaying noise, darkening as it fades. */
  private makeReverb(ctx: AudioContext): AudioBuffer {
    const seconds = 1.6;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buffer.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const a = 0.55 * (1 - t) + 0.04;
        lp += (Math.random() * 2 - 1 - lp) * a;
        d[i] = lp * Math.pow(1 - t, 3) * 0.45;
      }
    }
    return buffer;
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Private mode: the setting lasts for this visit only.
  }
}
