/**
 * weather.ts — the pure maths of the interior. No canvas, no DOM, no Tone.
 *
 * Everything here is a function of (score seed via rand, Transport time t,
 * the onsets captured so far). No frame-delta accumulators — every value
 * is recomputed from t, so a dropped frame can never desync the picture.
 *
 * All randomness goes through rand() under the 'visual' layer namespace.
 * Because rand() is counter-based (a hash of seed/layer/tick/salt, no
 * shared mutable position), these calls cannot perturb any audio decision —
 * the audio streams ('pad', 'events', 'region', 'drift:*') are untouched.
 * The interior is therefore deterministic per score and inert to the music
 * engine, both of which the tests assert.
 */

import { pick, rand } from '../rand';
import { VISUALS } from '../mappings';

const TAU = Math.PI * 2;

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Smoothstep — eased 0..1, zero velocity at both ends. */
export const smooth = (x: number): number => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/* ------------------------------------------------------------------ *
 * Tide — drawn once per performance, then sampled by time.
 * ------------------------------------------------------------------ */

export type TideConfig = {
  periods: [number, number, number];
  phases: [number, number, number];
  centerX: { period: number; phase: number };
  centerY: { period: number; phase: number };
};

/** Reads the current seed (set by the Performance at begin). Five sinusoids:
 *  three for the luminance tide, two more for the slow centre wander. */
export function tideConfig(): TideConfig {
  const P = VISUALS.tidePrimesS;
  return {
    periods: [
      pick('visual', 0, P, 'tide-period'),
      pick('visual', 1, P, 'tide-period'),
      pick('visual', 2, P, 'tide-period'),
    ],
    phases: [
      rand('visual', 0, 'tide-phase') * TAU,
      rand('visual', 1, 'tide-phase') * TAU,
      rand('visual', 2, 'tide-phase') * TAU,
    ],
    centerX: {
      period: pick('visual', 3, P, 'tide-period'),
      phase: rand('visual', 3, 'tide-phase') * TAU,
    },
    centerY: {
      period: pick('visual', 4, P, 'tide-period'),
      phase: rand('visual', 4, 'tide-phase') * TAU,
    },
  };
}

export type TideSample = {
  /** 0..1 luminance level (the sum of three sinusoids, normalised). */
  level: number;
  /** −1..1 centre offsets. */
  cx: number;
  cy: number;
};

export function sampleTide(cfg: TideConfig, t: number): TideSample {
  const s =
    Math.sin((TAU * t) / cfg.periods[0] + cfg.phases[0]) +
    Math.sin((TAU * t) / cfg.periods[1] + cfg.phases[1]) +
    Math.sin((TAU * t) / cfg.periods[2] + cfg.phases[2]);
  return {
    level: (s / 3 + 1) / 2,
    cx: Math.sin((TAU * t) / cfg.centerX.period + cfg.centerX.phase),
    cy: Math.sin((TAU * t) / cfg.centerY.period + cfg.centerY.phase),
  };
}

/* ------------------------------------------------------------------ *
 * Blooms — one per onset, sampled by age.
 * ------------------------------------------------------------------ */

export type Bloom = {
  kind: 'pad' | 'event' | 'bell';
  velocity: number;
  pan: number;
  /** Transport seconds at which the onset fired. */
  t0: number;
};

/** A bloom's full lifespan in seconds (so the renderer can cull it). */
export function bloomDuration(b: Bloom): number {
  const { min, max } = VISUALS.bloom.durationS;
  const norm = clamp01(b.velocity / VISUALS.bloom.velocityRef);
  const d = lerp(min, max, norm);
  return b.kind === 'bell' ? d * VISUALS.bloom.bell.durationScale : d;
}

export type BloomSample = {
  /** Current alpha (0 at birth and death, peaking after the attack). */
  alpha: number;
  /** Current radius as a fraction of interior radius. */
  radius: number;
  /** Horizontal offset as a fraction of interior radius. */
  panX: number;
};

/** Sample a bloom at transport time t, or null if it has not begun / is done. */
export function bloomSample(b: Bloom, t: number): BloomSample | null {
  const dur = bloomDuration(b);
  const age = t - b.t0;
  if (age < 0 || age > dur) return null;

  // rise over the attack, fall to zero by the end — never faster than attackS
  const attack = Math.min(VISUALS.bloom.attackS, dur * 0.4);
  const env =
    age < attack ? smooth(age / attack) : 1 - smooth((age - attack) / (dur - attack));

  const rMin = VISUALS.bloom.radius.min;
  let rMax: number = VISUALS.bloom.radius.max;
  if (b.kind === 'bell') {
    rMax = Math.min(VISUALS.bloom.bell.radiusCap, rMax * VISUALS.bloom.bell.radiusScale);
  }
  const radius = lerp(rMin, rMax, smooth(age / dur));
  const peak = VISUALS.bloom.peakAlpha * clamp01(b.velocity / VISUALS.bloom.velocityRef);

  return { alpha: peak * env, radius, panX: b.pan * VISUALS.bloom.panSpread };
}

/* ------------------------------------------------------------------ *
 * Region shift — a faint, eased luminance lean per active region.
 * ------------------------------------------------------------------ */

/** Target luminance lean for a region index. Region 0 is the neutral home
 *  (the opening), the others lean ± a touch — a brightness change only. */
export function regionBias(index: number): number {
  if (index === 0) return 0;
  return (rand('visual', index, 'region-bias') * 2 - 1) * VISUALS.regionBias;
}
