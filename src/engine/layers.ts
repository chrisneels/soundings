/**
 * layers.ts — the five layers, rendering decisions from decisions.ts.
 *
 * Layers never decide anything themselves: they ask the pure decision
 * functions and render what comes back. Each layer loops on its own prime
 * interval (11–31 s) so cycles never phase-lock into a grid. All loops are
 * Tone.Transport callbacks with per-layer tick counters — never
 * setInterval — so an unfocused tab keeps performing.
 */

import * as Tone from 'tone';
import { DRONE_RATIOS, freqOf } from '../lattice';
import type { Params } from '../mappings';
import { THRESHOLD_S } from '../mappings';
import { eventTick, loopInterval, padTick, textureTick } from './decisions';
import { AdditiveVoice, Bell, MIN_RAMP_S } from './voices';

/** Relative level of each layer against the others — engine voicing, not
 *  score tuning, which is why it lives here and not in mappings.ts. */
const TRIM = { drone: 0.4, pad: 0.5, events: 0.55, texture: 0.13, pulse: 0.22 };

/** A sound the moment it happens — for the interior weather only. Fire-
 *  and-forget: emitted AFTER every musical decision is made, so it cannot
 *  perturb anything. `pan` is the un-capped −1..1 position; `velocity` the
 *  voice's level. */
export type SoundEvent = {
  kind: 'pad' | 'event' | 'bell';
  velocity: number;
  pan: number;
};

export type LayerCtx = {
  /** Live parameters: base + drift + More-space + ending taper. */
  live: () => Params;
  /** Active region index. */
  region: () => number;
  /** True once the composed ending has begun — layers stop arriving. */
  ending: () => boolean;
  /** Optional observer of onsets. Absent → layers behave identically (the
   *  call is `?.`-guarded), so headless/tested runs need not provide it. */
  onSound?: (e: SoundEvent) => void;
  bus: Tone.InputNode;
};

/* ------------------------------------------------------------------ *
 * 1 — Drone. Always present. Exactly 1/1 and 3/2, zero detune; over a
 * 65 Hz tonic the pair makes a difference tone near 32 Hz. If this layer
 * ever beats, a frequency got rounded somewhere — that is a bug.
 * ------------------------------------------------------------------ */

export class Drone {
  private readonly trim: Tone.Gain;
  private readonly root: AdditiveVoice;
  private readonly fifth: AdditiveVoice;

  constructor(ctx: LayerCtx) {
    this.trim = new Tone.Gain(TRIM.drone).connect(ctx.bus);
    this.root = new AdditiveVoice('drone', 0, this.trim);
    this.fifth = new AdditiveVoice('drone', 1, this.trim);
    const tonic = ctx.live().tonicHz;
    this.root.setFrequency(freqOf(DRONE_RATIOS[0], tonic));
    this.fifth.setFrequency(freqOf(DRONE_RATIOS[1], tonic));
  }

  /** Rise out of true silence across the threshold. */
  start(): void {
    this.root.start();
    this.fifth.start();
    this.root.enter(0.5, THRESHOLD_S);
    this.fifth.enter(0.32, THRESHOLD_S);
  }

  /** The ending resolves to 1/1 alone before the close. */
  releaseFifth(releaseS: number, when?: number): void {
    this.fifth.release(releaseS, when);
  }

  releaseRoot(releaseS: number, when?: number): void {
    this.root.release(releaseS, when);
  }

  dispose(): void {
    this.root.dispose();
    this.fifth.dispose();
    this.trim.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * 2 — Pad cloud. 2–4 additive voices from the active region, attack
 * 4–8 s (Focus floors this at 4 s anyway), release 8–14 s.
 * ------------------------------------------------------------------ */

export class PadCloud {
  private readonly trim: Tone.Gain;
  private readonly intervalS: number;
  private tick = 0;
  private voicing: readonly number[] = [];
  private loopId: number | null = null;
  private readonly alive = new Set<{ voice: AdditiveVoice; pan: Tone.Panner }>();

  constructor(private readonly ctx: LayerCtx) {
    this.trim = new Tone.Gain(TRIM.pad).connect(ctx.bus);
    this.intervalS = loopInterval('pad');
  }

  start(startOffsetS: number): void {
    this.loopId = Tone.Transport.scheduleRepeat(
      (time) => this.onTick(time),
      this.intervalS,
      `+${startOffsetS}`,
    );
  }

  private onTick(time: number): void {
    this.tick += 1;
    if (this.ctx.ending()) return;
    const params = this.ctx.live();
    const decision = padTick(params, this.ctx.region(), this.voicing, this.tick);
    if (decision === null || decision === 'silence') return; // a pass is composed too
    this.voicing = decision.freqs;

    // one bloom per cloud arrival (not per voice) — a cloud is one gesture
    const meanPan =
      decision.pans.reduce((a, b) => a + b, 0) / decision.pans.length;
    this.ctx.onSound?.({ kind: 'pad', velocity: decision.velocity, pan: meanPan });

    decision.freqs.forEach((hz, v) => {
      const pan = new Tone.Panner(
        decision.pans[v] * params.stereoWidthCap * 0.7,
      ).connect(this.trim);
      const voice = new AdditiveVoice('pad', this.tick * 4 + v, pan);
      voice.setFrequency(hz);
      voice.start();
      // chords share one envelope shape; quieter when more voices stack
      const level = decision.velocity / Math.sqrt(decision.freqs.length);
      voice.enter(level, decision.attackS, time);
      const releaseAt = time + decision.attackS + decision.holdS;
      voice.release(decision.releaseS, releaseAt);
      const entry = { voice, pan };
      this.alive.add(entry);
      // dispose on the context clock (worker-driven, unfocused-safe) once
      // the release has fully landed — never on the transport clock, which
      // runs on a different zero
      Tone.getContext().setTimeout(() => {
        voice.dispose();
        pan.dispose();
        this.alive.delete(entry);
      }, decision.attackS + decision.holdS + decision.releaseS + 2);
    });
  }

  dispose(): void {
    if (this.loopId !== null) Tone.Transport.clear(this.loopId);
    for (const { voice, pan } of this.alive) {
      voice.dispose();
      pan.dispose();
    }
    this.alive.clear();
    this.trim.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * 3 — Events. Sparse single tones; probability density × 0.5 with a ≥5 s
 * refractory. Decision layer disables them entirely for Focus and Rest.
 * ------------------------------------------------------------------ */

export class Events {
  private readonly trim: Tone.Gain;
  private readonly bell: Bell;
  private readonly intervalS: number;
  private tick = 0;
  private lastAt = -Infinity;
  private loopId: number | null = null;
  private readonly alive = new Set<{ voice: AdditiveVoice; pan: Tone.Panner }>();

  constructor(private readonly ctx: LayerCtx) {
    this.trim = new Tone.Gain(TRIM.events).connect(ctx.bus);
    this.bell = new Bell(this.trim);
    this.intervalS = loopInterval('events');
  }

  start(startOffsetS: number): void {
    this.loopId = Tone.Transport.scheduleRepeat(
      (time) => this.onTick(time),
      this.intervalS,
      `+${startOffsetS}`,
    );
  }

  private onTick(time: number): void {
    this.tick += 1;
    if (this.ctx.ending()) return;
    const params = this.ctx.live();
    const sinceLast = time - this.lastAt;
    const decision = eventTick(params, this.ctx.region(), this.tick, sinceLast);
    if (decision === null || decision === 'silence') return;
    this.lastAt = time;

    // every event onset blooms once — whether it renders as bell or swell,
    // it is the Events layer arriving, so kind 'event'
    this.ctx.onSound?.({ kind: 'event', velocity: decision.velocity, pan: decision.pan });

    if (decision.bell) {
      this.bell.strike(decision.freq, time, decision.velocity);
      return;
    }
    // soft additive swell — a tone that arrives and is not followed
    const pan = new Tone.Panner(
      decision.pan * params.stereoWidthCap * 0.7,
    ).connect(this.trim);
    const voice = new AdditiveVoice('events', this.tick, pan);
    voice.setFrequency(decision.freq);
    voice.start();
    const attack = Math.max(1.5, params.attackFloor);
    voice.enter(decision.velocity, attack, time);
    voice.release(6, time + attack + 1.5);
    const entry = { voice, pan };
    this.alive.add(entry);
    Tone.getContext().setTimeout(() => {
      voice.dispose();
      pan.dispose();
      this.alive.delete(entry);
    }, attack + 1.5 + 6 + 2);
  }

  dispose(): void {
    if (this.loopId !== null) Tone.Transport.clear(this.loopId);
    for (const { voice, pan } of this.alive) {
      voice.dispose();
      pan.dispose();
    }
    this.alive.clear();
    this.bell.dispose();
    this.trim.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * 4 — Texture. Pink noise through a slowly sweeping bandpass. Continuous
 * (no onsets); gain follows the live `texture` scalar. An edition
 * replaces this with a granular field recording.
 * ------------------------------------------------------------------ */

export class Texture {
  private readonly gain: Tone.Gain;
  private readonly filter: Tone.Filter;
  private readonly noise: Tone.Noise;
  private readonly intervalS: number;
  private tick = 0;
  private loopId: number | null = null;

  constructor(private readonly ctx: LayerCtx) {
    this.gain = new Tone.Gain(0).connect(ctx.bus);
    this.filter = new Tone.Filter({
      type: 'bandpass',
      frequency: ctx.live().tonicHz * 8,
      Q: 2.2,
    }).connect(this.gain);
    this.noise = new Tone.Noise('pink').connect(this.filter);
    this.intervalS = loopInterval('texture');
  }

  start(): void {
    this.noise.start();
    // rises with the threshold, to its live level
    this.ramp(this.ctx.live().texture * TRIM.texture, THRESHOLD_S);
    this.loopId = Tone.Transport.scheduleRepeat(
      (time) => this.onTick(time),
      this.intervalS,
      `+${this.intervalS}`,
    );
  }

  private onTick(time: number): void {
    this.tick += 1;
    const params = this.ctx.live();
    const d = textureTick(params, this.tick);
    const f = this.filter.frequency;
    f.cancelScheduledValues(time);
    f.setValueAtTime(Math.max(f.value as number, 1), time);
    f.exponentialRampToValueAtTime(d.centerHz, time + d.glideS);
    if (!this.ctx.ending()) this.ramp(params.texture * TRIM.texture, 3, time);
  }

  /** Used by the ending to thin the layer to nothing. */
  ramp(level: number, overS: number, when?: number): void {
    const t = when ?? Tone.now();
    const g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + Math.max(overS, MIN_RAMP_S));
  }

  dispose(): void {
    if (this.loopId !== null) Tone.Transport.clear(this.loopId);
    this.noise.dispose();
    this.filter.dispose();
    this.gain.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * 5 — Pulse. A soft sub-swell at a ~64 BPM equivalent, only where
 * pulse > 0 (Wander alone). Never percussive: a sine an octave under the
 * tonic, breathing on a smooth LFO.
 * ------------------------------------------------------------------ */

export class Pulse {
  private readonly gain: Tone.Gain;
  private readonly swell: Tone.LFO;
  private readonly osc: Tone.Oscillator;

  constructor(ctx: LayerCtx) {
    const params = ctx.live();
    this.gain = new Tone.Gain(0).connect(ctx.bus);
    this.osc = new Tone.Oscillator(params.tonicHz / 2, 'sine').connect(this.gain);
    this.swell = new Tone.LFO({
      frequency: 64 / 60, // ~64 BPM equivalent
      min: 0,
      max: params.pulse * TRIM.pulse,
      type: 'sine',
    }).connect(this.gain.gain);
  }

  start(): void {
    this.osc.start();
    this.swell.start();
  }

  /** Used by the ending. */
  fadeOut(overS: number, when?: number): void {
    const t = when ?? Tone.now();
    this.swell.stop(t);
    const g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + Math.max(overS, MIN_RAMP_S));
  }

  dispose(): void {
    this.swell.dispose();
    this.osc.dispose();
    this.gain.dispose();
  }
}
