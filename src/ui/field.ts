/**
 * field.ts — the pure maths of the app-wide background "field". No canvas,
 * no DOM, no Tone, no React.
 *
 * The field is ambient room-light, deliberately ephemeral: it does NOT
 * reproduce from a card code (the reproducible visual is the ring interior).
 * So it touches neither rand() nor Math.random — its only nondeterministic
 * input is ONE entropyUint32() draw at app load, fed in here as `entropy`,
 * from which tide periods/phases and the grain tile derive by plain
 * arithmetic (mulberry32). Because it never calls rand(), it cannot appear in
 * decision logs and cannot affect the audio determinism tests.
 *
 * All motion is a pure function of wall-clock seconds — no frame-delta
 * accumulators — so dropped or paused frames never desync.
 */

import { VISUALS } from '../mappings';
import type { Intention } from '../score';

const TAU = Math.PI * 2;

export const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));
export const clamp01 = (x: number): number => clamp(x, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (x: number): number => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

export type RGB = [number, number, number];
export type FieldCharacter = {
  temp: RGB;
  lift: number;
  speed: number;
  /** How much static this room carries, 0–1. */
  grain: number;
};

/**
 * mulberry32 — a tiny deterministic PRNG from one integer seed. Plain
 * integer arithmetic; NOT Math.random and NOT rand(). Used only to spread
 * the field's single entropy draw into tide periods/phases and grain specks.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FieldConfig = {
  periods: [number, number, number];
  phases: [number, number, number];
  drift: { px: number; ph: number; py: number; ph2: number };
};

/** Tide periods/phases for this app load, from the one entropy draw. */
export function fieldConfig(entropy: number): FieldConfig {
  const r = mulberry32(entropy);
  const P = VISUALS.field.tidePeriodsS;
  const pick = () => P[Math.floor(r() * P.length)];
  return {
    periods: [pick(), pick(), pick()],
    phases: [r() * TAU, r() * TAU, r() * TAU],
    drift: { px: pick(), ph: r() * TAU, py: pick(), ph2: r() * TAU },
  };
}

/** The character a screen leans toward — the chosen intention's, or the
 *  neutral room before a choice is made. Returns a fresh mutable copy. */
export function characterFor(intention: Intention | null): FieldCharacter {
  const c = intention ? VISUALS.field.character[intention] : VISUALS.field.neutral;
  return { temp: [c.temp[0], c.temp[1], c.temp[2]], lift: c.lift, speed: c.speed, grain: c.grain };
}

/** Tide signal in [-1, 1] at wall-clock seconds `nowS`, speed-scaled. */
export function fieldTide(cfg: FieldConfig, nowS: number, speed: number): number {
  const t = nowS * speed;
  return (
    (Math.sin((TAU * t) / cfg.periods[0] + cfg.phases[0]) +
      Math.sin((TAU * t) / cfg.periods[1] + cfg.phases[1]) +
      Math.sin((TAU * t) / cfg.periods[2] + cfg.phases[2])) /
    3
  );
}

/** Slow centre wander, each component in [-1, 1]. */
export function fieldDrift(
  cfg: FieldConfig,
  nowS: number,
  speed: number,
): { x: number; y: number } {
  const t = nowS * speed;
  return {
    x: Math.sin((TAU * t) / cfg.drift.px + cfg.drift.ph),
    y: Math.sin((TAU * t) / cfg.drift.py + cfg.drift.ph2),
  };
}

/**
 * The pool's centre colour: --bg + temperature × lift × tide-lift × ceiling,
 * clamped to the hard maxPixel and never below --bg (the field only ever adds
 * a little light). Deltas are tiny by design — a temperature lean, not a hue.
 */
export function poolColor(
  bg: RGB,
  char: FieldCharacter,
  tide: number,
  ceiling: number,
): RGB {
  const liftFactor = 1 + tide * VISUALS.field.tideLiftRange;
  const k = char.lift * liftFactor * ceiling;
  const max = VISUALS.field.maxPixel;
  return [0, 1, 2].map((i) => clamp(bg[i] + char.temp[i] * k, bg[i], max[i])) as RGB;
}

/** Global alpha for the grain pass: base × tide(0.6–1.0) × the intention's
 *  texture × the phase ceiling (so it fades out at the ending, dims on the
 *  card). */
/** Global alpha for the grain pass: base × tide(0.6–1.0) × the room's grain
 *  amount × the phase ceiling (so it fades out at the ending, dims on the
 *  card). */
export function grainGlobalAlpha(tide: number, grain: number, ceiling: number): number {
  const g = VISUALS.field.grainTideRange;
  const tideF = lerp(g.min, g.max, tide * 0.5 + 0.5);
  return clamp01(VISUALS.field.grainBaseAlpha * tideF * grain * ceiling);
}

/** Which noise tile to show at wall-clock `now` — cycling the prebuilt tiles
 *  produces the static shimmer. Pure of `now`; speed scales the rate. */
export function grainTileIndex(now: number, shimmerHz: number, count: number): number {
  if (count <= 1) return 0;
  return Math.floor(now * shimmerHz) % count;
}

export type Speck = { x: number; y: number; a: number };

/** One noise tile's specks. `tile` selects an independent PRNG stream so the
 *  cycled tiles don't correlate (otherwise the shimmer would pulse). */
export function grainSpecks(entropy: number, tile = 0): Speck[] {
  const f = VISUALS.field;
  const r = mulberry32((entropy ^ (0x9e3779b9 + tile * 0x85ebca6b)) >>> 0);
  const n = Math.floor(f.grainTileSize * f.grainTileSize * f.grainDensity);
  const specks: Speck[] = [];
  for (let i = 0; i < n; i++) {
    specks.push({
      x: Math.floor(r() * f.grainTileSize),
      y: Math.floor(r() * f.grainTileSize),
      a: lerp(f.grainAlpha.min, f.grainAlpha.max, r()),
    });
  }
  return specks;
}
