/**
 * lattice.ts — just intonation over a fixed tonic.
 *
 * All pitch in Soundings is a frequency ratio over the score's tonic.
 * There are no note names anywhere in the code. The tonic never moves
 * (drone practice — Young, Radigue, tanpura); what feels like harmonic
 * motion is REGION DRIFT: a reweighting of probabilities within a fixed
 * lattice, never modulation. That also sidesteps every JI comma problem.
 *
 * Timbre is co-designed with the tuning (the Sethares principle:
 * consonance is timbre-dependent). Sustained voices are additive — summed
 * harmonic partials — so ratio intervals lock beatlessly. No detuned or
 * "fat" oscillators anywhere: detuning manufactures beating, and the
 * entire payoff of just intonation is the beatless lock. Movement comes
 * from partial-amplitude drift, not detune.
 */

import type { Intention } from './score';

export type Ratio = { n: number; d: number };

/** Exact frequency of a ratio over a tonic. Never round — a rounded
 *  frequency is an inharmonic frequency, and inharmonic means beating. */
export function freqOf(ratio: Ratio, tonicHz: number): number {
  return (tonicHz * ratio.n) / ratio.d;
}

export function ratioName(r: Ratio): string {
  return `${r.n}/${r.d}`;
}

/** Absolute distance between two frequencies in cents. */
export function centsBetween(a: number, b: number): number {
  return Math.abs(1200 * Math.log2(a / b));
}

/* ------------------------------------------------------------------ *
 * Ratio pools per intention.
 * ------------------------------------------------------------------ */

const R = (n: number, d: number): Ratio => ({ n, d });

export const POOLS: Record<Intention, readonly Ratio[]> = {
  settle: [R(1, 1), R(9, 8), R(5, 4), R(3, 2), R(5, 3), R(15, 8)],
  focus: [R(1, 1), R(9, 8), R(5, 4), R(3, 2), R(5, 3)],
  rest: [R(1, 1), R(5, 4), R(3, 2)],
  tend: [R(1, 1), R(9, 8), R(6, 5), R(4, 3), R(3, 2)],
  // Wander's 7/4 is the harmonic seventh — a tone that exists on no piano.
  // It sounds plainly; it is the signature "this is not equal temperament"
  // moment of the instrument.
  wander: [R(1, 1), R(9, 8), R(5, 4), R(3, 2), R(27, 16), R(7, 4)],
  wait: [R(1, 1), R(9, 8), R(4, 3), R(3, 2)],
};

/* ------------------------------------------------------------------ *
 * Regions — probability weights over the pool, one array per region.
 * Region drift shifts WHICH weights are active; the lattice itself is
 * fixed. Each weight array must be the same length as the intention's
 * pool (a test asserts this).
 * ------------------------------------------------------------------ */

export const REGIONS: Record<Intention, readonly (readonly number[])[]> = {
  settle: [
    [1.0, 0.2, 1.0, 0.4, 0.7, 0.6], // 5/4-centered: thirds and sixths
    [1.0, 0.7, 0.25, 1.0, 0.5, 0.15], // 3/2-centered: open fifths
  ],
  focus: [
    [1.0, 0.3, 0.9, 0.6, 0.4],
    [1.0, 0.8, 0.3, 1.0, 0.5],
  ],
  rest: [
    [1.0, 0.8, 0.4],
    [1.0, 0.3, 0.9],
  ],
  tend: [
    [1.0, 0.25, 1.0, 0.5, 0.6], // 6/5-centered: the minor-third character
    [1.0, 0.6, 0.3, 1.0, 0.8], // 4/3-centered: plagal openness
  ],
  wander: [
    [1.0, 0.4, 1.0, 0.7, 0.3, 0.35], // 5/4-centered
    [1.0, 0.9, 0.3, 1.0, 0.9, 0.25], // 27/16-centered: Pythagorean bright
    [1.0, 0.3, 0.5, 0.8, 0.4, 1.0], // 7/4-centered: the septimal signature
  ],
  wait: [
    [1.0, 0.5, 0.9, 0.5],
    [1.0, 0.7, 0.4, 1.0],
  ],
};

/* ------------------------------------------------------------------ *
 * Octave placement & voice leading.
 * ------------------------------------------------------------------ */

/**
 * Place a pool ratio in an octave governed by the `register` scalar.
 * register 0 → centered one octave above the tonic; register 1 → centered
 * four octaves above. Placement keeps the exact ratio — only the octave
 * (a power of two) moves, so the lattice stays just.
 */
export function placeRatio(ratio: Ratio, tonicHz: number, register: number): number {
  const center = tonicHz * Math.pow(2, 1 + 3 * register);
  const raw = freqOf(ratio, tonicHz);
  const k = Math.round(Math.log2(center / raw));
  return raw * Math.pow(2, k);
}

/**
 * Nearest-neighbor voice leading in log-frequency (cents) from the
 * previous voicing: each target ratio considers its register home and the
 * octaves adjacent to it, and settles where it moves least relative to
 * the sounding voices — with a gentle pull toward home so a long
 * performance cannot wander out of register.
 */
export function leadVoices(
  prev: readonly number[],
  ratios: readonly Ratio[],
  tonicHz: number,
  register: number,
): number[] {
  return ratios.map((r) => {
    const home = placeRatio(r, tonicHz, register);
    if (prev.length === 0) return home;
    const candidates = [home / 2, home, home * 2];
    let best = home;
    let bestCost = Infinity;
    for (const c of candidates) {
      let nearest = Infinity;
      for (const p of prev) nearest = Math.min(nearest, centsBetween(c, p));
      const cost = nearest + centsBetween(c, home) * 0.25;
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    return best;
  });
}

/* ------------------------------------------------------------------ *
 * Timbre specs — shared by every sustained (additive) voice.
 * ------------------------------------------------------------------ */

export const PARTIAL_COUNT = 8;

/** Amplitude of harmonic partial n (1-indexed): 1/n^1.4. */
export function partialAmp(n: number): number {
  return 1 / Math.pow(n, 1.4);
}

/** Each partial's gain breathes on its own very slow LFO. */
export const PARTIAL_LFO_PERIOD_S: readonly [number, number] = [31, 127];

/** The drone holds exactly these two ratios, zero detune. Over a 65 Hz
 *  tonic the pair produces a difference tone near 32 Hz — present, mostly
 *  felt. If the drone ever beats, a frequency got rounded somewhere. */
export const DRONE_RATIOS: readonly Ratio[] = [R(1, 1), R(3, 2)];

/** Loop intervals available to layer instances, in seconds. Primes, so
 *  layer cycles never phase-lock into an audible grid. */
export const PRIME_INTERVALS: readonly number[] = [11, 13, 17, 19, 23, 29, 31];
