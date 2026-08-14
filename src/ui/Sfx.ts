// ─── Sfx ──────────────────────────────────────────────────────────────────────
// Sound effects synthesised at runtime with Web Audio — no audio files, for the
// same reason there are no image files: the repo carries no third-party assets
// and nothing to license.
//
// Lives in ui/ rather than utils/ because it touches `window`, and everything
// under utils/ has to keep running in plain Node for the unit tests.
//
// Browsers refuse to start an AudioContext before the first user gesture, so the
// context is created lazily on the first sound after a click and every call is
// wrapped: audio must never be able to break the game.

type Wave = OscillatorType;

interface Blip {
  freq: number;
  to?: number;        // sweep target, if any
  duration: number;   // seconds
  wave: Wave;
  gain: number;
}

const VOICES: Record<string, Blip[]> = {
  // A short noisy rattle, then the settle.
  dice:   [{ freq: 180, to: 90, duration: 0.09, wave: 'square', gain: 0.05 },
           { freq: 260, to: 140, duration: 0.07, wave: 'square', gain: 0.04 }],
  buy:    [{ freq: 520, to: 880, duration: 0.12, wave: 'triangle', gain: 0.07 }],
  cash:   [{ freq: 880, duration: 0.06, wave: 'sine', gain: 0.06 },
           { freq: 1320, duration: 0.09, wave: 'sine', gain: 0.05 }],
  spend:  [{ freq: 420, to: 180, duration: 0.16, wave: 'triangle', gain: 0.06 }],
  jail:   [{ freq: 200, to: 70, duration: 0.30, wave: 'sawtooth', gain: 0.06 }],
  hammer: [{ freq: 300, duration: 0.05, wave: 'square', gain: 0.07 },
           { freq: 150, duration: 0.14, wave: 'square', gain: 0.06 }],
  card:   [{ freq: 700, to: 1100, duration: 0.08, wave: 'sine', gain: 0.05 }],
};

export type SfxName = keyof typeof VOICES;

class Sfx {
  private context: AudioContext | null = null;
  /**
   * 0–1, and 0 *is* mute — one control rather than a level and a flag that can
   * disagree. Persisted, because a volume is a preference like the theme: it
   * belongs to the person, not to the game, so it is not in the snapshot.
   */
  private level = Sfx.read();

  get volume(): number { return this.level; }
  get muted(): boolean { return this.level <= 0; }

  setVolume(value: number): number {
    this.level = Math.max(0, Math.min(1, Math.round(value * 100) / 100));
    Sfx.write(this.level);
    return this.level;
  }

  /** Returns whether sound is now *on*, so a button can relabel itself. */
  toggleMute(): boolean {
    // Remember where it was, so unmuting does not silently jump to full.
    if (this.level > 0) {
      this.remembered = this.level;
      this.setVolume(0);
    } else {
      this.setVolume(this.remembered);
    }
    return !this.muted;
  }

  private remembered = 0.7;

  private static read(): number {
    try {
      const raw = localStorage.getItem(Sfx.KEY);
      const value = raw === null ? 0.7 : Number(raw);
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.7;
    } catch {
      return 0.7;   // A browser with no storage still gets sound.
    }
  }

  private static write(value: number): void {
    try { localStorage.setItem(Sfx.KEY, String(value)); } catch { /* not fatal */ }
  }

  private static readonly KEY = 'monopoly_forge_volume';

  play(name: SfxName): void {
    if (this.level <= 0) return;
    const voices = VOICES[name];
    if (!voices) return;

    try {
      const ctx = this.audio();
      if (!ctx) return;
      let at = ctx.currentTime;
      for (const blip of voices) {
        this.blip(ctx, blip, at);
        at += blip.duration * 0.7;   // overlap slightly, so it reads as one sound
      }
    } catch {
      // A browser that will not make noise is not a reason to stop the game.
      this.level = 0;
    }
  }

  private audio(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.context = new Ctor();
    return this.context;
  }

  private blip(ctx: AudioContext, blip: Blip, at: number): void {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = blip.wave;
    osc.frequency.setValueAtTime(blip.freq, at);
    if (blip.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, blip.to), at + blip.duration);
    }

    // A quick attack and an exponential tail — square-edged gain clicks.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, blip.gain * this.level), at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + blip.duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + blip.duration + 0.02);
  }
}

export const sfx = new Sfx();
