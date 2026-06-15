/**
 * decisions.ts — every musical choice, as pure functions of (params, tick).
 *
 * No Tone.js here, no audio, no time. The layers in layers.ts call these
 * and merely render what comes back; the determinism test drives the same
 * functions headlessly. All randomness is rand() — counter-based on the
 * score seed — so a layer's decision at tick n is the same on every
 * device, every day, regardless of scheduler race order.
 */

import { PARTIAL_LFO_PERIOD_S, PRIME_INTERVALS, leadVoices, placeRatio } from '../lattice';
import type { Ratio } from '../lattice';
import type { Params } from '../mappings';
import { DRIFT_STEP } from '../mappings';
import { pick, pickWeighted, rand, randInt, randRange } from '../rand';

/* ------------------------------------------------------------------ *
 * Init-time draws (tick 0 of each stream).
 * ------------------------------------------------------------------ */

/** Each layer instance loops on its own prime interval — cycles never
 *  phase-lock into an audible grid. */
export function loopInterval(layer: string): number {
  return pick(layer, 0, PRIME_INTERVALS, 'interval');
}

/** Per-partial LFO period (31–127 s) and starting phase for an additive
 *  voice. `voice` distinguishes voices within a layer. */
export function partialLfo(
  layer: string,
  voice: number,
  partial: number,
): { periodS: number; phase: number } {
  const [lo, hi] = PARTIAL_LFO_PERIOD_S;
  return {
    periodS: randRange(layer, voice, lo, hi, `lfoP${partial}`),
    phase: rand(layer, voice, `lfoPh${partial}`) * Math.PI * 2,
  };
}

/* ------------------------------------------------------------------ *
 * Pad cloud — 2–4 additive voices from the active region.
 * ------------------------------------------------------------------ */

export type PadDecision = {
  freqs: number[];
  ratios: Ratio[];
  /** Per-voice pan position, −1..1 before the stereo width cap. */
  pans: number[];
  attackS: number;
  /** Seconds at full level between the attack and the release. */
  holdS: number;
  releaseS: number;
  velocity: number;
};

export function padTick(
  params: Params,
  regionIndex: number,
  prevVoicing: readonly number[],
  tick: number,
): PadDecision | 'silence' | null {
  // Gate one: does the layer act this cycle at all?
  if (rand('pad', tick, 'gate') >= params.density) return null;
  // Gate two: a passed gate may be spent on a composed silence — a
  // deliberate pass, not an absence.
  if (rand('pad', tick, 'silence') < params.silence) return 'silence';

  const weights = params.regions[regionIndex];
  const count = 2 + randInt('pad', tick, 3, 'count'); // 2–4 voices
  const chosen: number[] = [];
  for (let v = 0; v < count; v++) {
    // weighted draw without replacement: zero out already-chosen indices
    const w = weights.map((x, i) => (chosen.includes(i) ? 0 : x));
    chosen.push(pickWeighted('pad', tick, w, `ratio${v}`));
  }
  const ratios = chosen.map((i) => params.pool[i]);
  const freqs = leadVoices(prevVoicing, ratios, params.tonicHz, params.register);
  const pans = ratios.map((_, v) => rand('pad', tick, `pan${v}`) * 2 - 1);

  return {
    freqs,
    ratios,
    pans,
    attackS: Math.max(params.attackFloor, randRange('pad', tick, 4, 8, 'attack')),
    holdS: randRange('pad', tick, 6, 14, 'hold'),
    releaseS: randRange('pad', tick, 8, 14, 'release'),
    velocity: randRange('pad', tick, 0.2, 0.4, 'velocity'),
  };
}

/* ------------------------------------------------------------------ *
 * Events — sparse single tones. Disabled entirely for Focus and Rest
 * (params.events === false): discrete onsets are changing-state tokens,
 * and those two intentions protect working memory and sleep-adjacency.
 * ------------------------------------------------------------------ */

export type EventDecision = {
  freq: number;
  ratio: Ratio;
  bell: boolean; // soft FM bell vs additive swell
  pan: number; // −1..1 before the stereo width cap
  velocity: number;
};

export function eventTick(
  params: Params,
  regionIndex: number,
  tick: number,
  secondsSinceLast: number,
): EventDecision | 'silence' | null {
  if (!params.events) return null;
  if (secondsSinceLast < 5) return null; // refractory
  if (rand('events', tick, 'gate') >= params.density * 0.5) return null;
  if (rand('events', tick, 'silence') < params.silence) return 'silence';

  const weights = params.regions[regionIndex];
  const idx = pickWeighted('events', tick, weights, 'ratio');
  const ratio = params.pool[idx];
  // events sit a touch above the pad register so they read as arrivals
  const freq = placeRatio(ratio, params.tonicHz, Math.min(1, params.register + 0.15));

  return {
    freq,
    ratio,
    bell: rand('events', tick, 'timbre') < 0.5,
    pan: rand('events', tick, 'pan') * 2 - 1,
    velocity: randRange('events', tick, 0.15, 0.3, 'velocity'),
  };
}

/* ------------------------------------------------------------------ *
 * Region drift — every 31 s, with probability regionDrift, the active
 * weights shift to a different region. Reweighting within a fixed
 * lattice; never modulation.
 * ------------------------------------------------------------------ */

export function regionTick(params: Params, tick: number, current: number): number {
  if (params.regions.length < 2) return current;
  if (rand('region', tick, 'gate') >= params.regionDrift) return current;
  const step = 1 + randInt('region', tick, params.regions.length - 1, 'which');
  return (current + step) % params.regions.length;
}

/* ------------------------------------------------------------------ *
 * Scalar drift — each scalar random-walks ±DRIFT_STEP on its own clock
 * (interval drawn once from 20–40 s). Clamping to ±0.15 of base happens
 * at the accumulation site, which knows the base.
 * ------------------------------------------------------------------ */

export function driftInterval(scalar: string): number {
  return randRange(`drift:${scalar}`, 0, 20, 40, 'interval');
}

export function driftStep(scalar: string, tick: number): number {
  return (rand(`drift:${scalar}`, tick, 'walk') * 2 - 1) * DRIFT_STEP;
}

/* ------------------------------------------------------------------ *
 * Texture — the bandpass center wanders between sweeps.
 * ------------------------------------------------------------------ */

export type TextureDecision = { centerHz: number; glideS: number };

export function textureTick(params: Params, tick: number): TextureDecision {
  // 2–6 octaves above the tonic, weighted toward the middle of the band
  const octave = 2 + randRange('texture', tick, 0, 4, 'center');
  return {
    centerHz: params.tonicHz * Math.pow(2, octave),
    glideS: randRange('texture', tick, 8, 20, 'glide'),
  };
}
