/**
 * voices.ts — the two sound sources of the instrument.
 *
 * AdditiveVoice: explicitly summed harmonic partials (1–8, amplitude
 * 1/n^1.4), each partial's gain breathing on its own very slow seeded
 * LFO. No detuned oscillators anywhere in this file or any other — the
 * payoff of just intonation is the beatless lock, and detune would
 * manufacture beating.
 *
 * Bell: a single soft FM strike with a long release — the threshold and
 * the close. (An edition may replace it with a recorded bowl.)
 *
 * Every gain change everywhere ramps ≥ 0.1 s. Zero clicks.
 */

import * as Tone from 'tone';
import { PARTIAL_COUNT, partialAmp } from '../lattice';
import { partialLfo } from './decisions';

export const MIN_RAMP_S = 0.1;

export class AdditiveVoice {
  readonly out: Tone.Gain;
  private readonly env: Tone.Gain; // attack/release envelope, by ramps
  private readonly partials: { osc: Tone.Oscillator; gain: Tone.Gain; lfo: Tone.LFO }[] = [];
  private disposed = false;

  /**
   * `layer` and `voiceIndex` seed the per-partial LFOs so a voice's
   * breathing is part of the score, not of the runtime.
   */
  constructor(layer: string, voiceIndex: number, destination: Tone.InputNode) {
    this.out = new Tone.Gain(1).connect(destination);
    this.env = new Tone.Gain(0).connect(this.out);

    for (let n = 1; n <= PARTIAL_COUNT; n++) {
      const gain = new Tone.Gain(partialAmp(n)).connect(this.env);
      const osc = new Tone.Oscillator(0, 'sine').connect(gain);
      const { periodS, phase } = partialLfo(layer, voiceIndex, n);
      // The LFO drifts each partial between ~35% and 100% of its nominal
      // amplitude — movement without any frequency change.
      const lfo = new Tone.LFO({
        frequency: 1 / periodS,
        min: partialAmp(n) * 0.35,
        max: partialAmp(n),
        phase: (phase * 180) / Math.PI,
      }).connect(gain.gain);
      this.partials.push({ osc, gain, lfo });
    }
  }

  /** Set all partial frequencies as exact integer multiples — harmonic by
   *  construction. Never rounds. */
  setFrequency(hz: number, glideS = 0): void {
    const now = Tone.now();
    for (let i = 0; i < this.partials.length; i++) {
      const f = hz * (i + 1);
      const freq = this.partials[i].osc.frequency;
      if (glideS > 0) {
        freq.cancelScheduledValues(now);
        freq.setValueAtTime(freq.value || f, now);
        freq.exponentialRampToValueAtTime(f, now + Math.max(glideS, MIN_RAMP_S));
      } else {
        freq.value = f;
      }
    }
  }

  start(): void {
    for (const p of this.partials) {
      p.osc.start();
      p.lfo.start();
    }
  }

  /** Ramp in over attackS (clamped ≥ 0.1 s). */
  enter(velocity: number, attackS: number, when?: number): void {
    const t = when ?? Tone.now();
    const g = this.env.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(velocity, t + Math.max(attackS, MIN_RAMP_S));
  }

  /** Ramp out over releaseS (clamped ≥ 0.1 s). */
  release(releaseS: number, when?: number): void {
    const t = when ?? Tone.now();
    const g = this.env.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + Math.max(releaseS, MIN_RAMP_S));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.partials) {
      p.lfo.dispose();
      p.osc.dispose();
      p.gain.dispose();
    }
    this.env.dispose();
    this.out.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * Bell — one FM strike, long release. Used at the threshold and at the
 * resolve. Soft: low modulation index, gentle velocity.
 * ------------------------------------------------------------------ */

export class Bell {
  private readonly synth: Tone.FMSynth;

  constructor(destination: Tone.InputNode) {
    this.synth = new Tone.FMSynth({
      harmonicity: 2, // modulator at the octave — keeps the strike harmonic
      modulationIndex: 6,
      oscillator: { type: 'sine' },
      modulation: { type: 'sine' },
      envelope: { attack: 0.02, decay: 4, sustain: 0, release: 10 },
      modulationEnvelope: { attack: 0.01, decay: 1.2, sustain: 0, release: 4 },
    }).connect(destination);
    this.synth.volume.value = -10;
  }

  strike(hz: number, when?: number, velocity = 0.5): void {
    this.synth.triggerAttackRelease(hz, 6, when ?? Tone.now(), velocity);
  }

  dispose(): void {
    this.synth.dispose();
  }
}
