/**
 * All sound in the game, synthesized at runtime. No audio files.
 *
 * Every effect is a few oscillators and an envelope, which keeps the game a
 * single ~30 kB download and means sounds are tuned by editing numbers rather
 * than by opening an audio editor.
 *
 * Two mobile-specific rules drive the structure:
 *  - The AudioContext can't exist until a user gesture, so it's created lazily
 *    on the first input rather than at startup.
 *  - A context can get suspended when the app is backgrounded, so every sound
 *    checks and resumes rather than silently failing forever after.
 *
 * The palette rule has an audio counterpart: **rescues sound bright and rising,
 * hazards sound low and falling.** A child who can't yet read the sprites can
 * still hear whether the last thing they did was good.
 */

export type Sfx =
  | 'flap'
  | 'magic'
  | 'pop'
  | 'save'
  | 'gate'
  | 'hit'
  | 'death'
  | 'sector'
  | 'select';

const MUTE_KEY = 'flappy-unicorn.muted';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  muted: boolean;

  constructor() {
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.01);
    }
    return this.muted;
  }

  /** Call from a real user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoise(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(sfx: Sfx): void {
    if (this.muted || !this.ctx || !this.master) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const t = this.ctx.currentTime;

    switch (sfx) {
      case 'flap':
        // Soft rising whoosh. Quiet, because it fires several times a second
        // and anything percussive becomes a machine gun within ten seconds.
        this.tone('sine', 280, 480, t, 0.09, 0.13);
        this.noise(t, 0.05, 0.045, 900, 1800);
        break;
      case 'magic':
        // Bright upward sparkle. Magic, not a gun.
        this.tone('triangle', 700, 1250, t, 0.09, 0.14);
        this.noise(t, 0.04, 0.05, 3200);
        break;
      case 'pop':
        // A bomb going away: short, low thud with a bright transient.
        this.tone('square', 340, 90, t, 0.16, 0.22);
        this.noise(t, 0.14, 0.2, 1400, 400);
        break;
      case 'save':
        // Two rising notes — a small fanfare, unmistakably a reward.
        this.tone('triangle', 780, 780, t, 0.09, 0.18);
        this.tone('triangle', 1170, 1170, t + 0.08, 0.16, 0.18);
        break;
      case 'gate':
        // Tiny confirmation chime. Must not compete with 'save'.
        this.tone('sine', 900, 1100, t, 0.05, 0.07);
        break;
      case 'hit':
        // Low and ugly. Should feel like a mistake.
        this.tone('sawtooth', 220, 70, t, 0.28, 0.3);
        this.noise(t, 0.16, 0.22, 900);
        break;
      case 'death':
        // Long descending slide: the run is over, and it sounds final.
        this.tone('sawtooth', 420, 50, t, 0.7, 0.32);
        this.noise(t, 0.4, 0.18, 1200, 200);
        break;
      case 'sector':
        this.tone('triangle', 660, 660, t, 0.12, 0.2);
        this.tone('triangle', 880, 880, t + 0.12, 0.18, 0.2);
        break;
      case 'select':
        this.tone('square', 520, 700, t, 0.06, 0.16);
        break;
    }
  }

  /** Pitch-swept oscillator with a percussive envelope. */
  private tone(
    type: OscillatorType,
    fromHz: number,
    toHz: number,
    start: number,
    duration: number,
    peak: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, start);
    if (toHz !== fromHz) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), start + duration);
    }

    // Fast attack, exponential decay. A linear fade sounds like a synthesizer;
    // an exponential one sounds like something was struck.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /** Band-limited noise burst, optionally sweeping the filter. */
  private noise(
    start: number,
    duration: number,
    peak: number,
    filterFrom: number,
    filterTo?: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noiseBuffer) return;

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFrom, start);
    if (filterTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(1, filterTo), start + duration);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  /** One second of white noise, reused by every noise-based effect. */
  private createNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
