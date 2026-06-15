/**
 * rand.ts — the single source of randomness in Soundings.
 *
 * The performance is a pure function of the score. Every stochastic decision
 * the engine makes flows through here, and every value is a hash of
 * (score.seed, layer, tick, salt). This is a COUNTER-BASED generator: there
 * is no internal sequence position, so each layer's choice for tick n depends
 * only on its own stream and index — never on the order in which the audio
 * scheduler happened to fire callbacks.
 *
 * Same score code → identical decision sequence, on any device, any day.
 *
 * Math.random() is forbidden across the codebase (enforced by ESLint).
 */

let currentSeed = '';

/** Set once when a performance begins. Tests may set it directly. */
export function setSeed(seed: string): void {
  currentSeed = seed;
}

export function getSeed(): string {
  return currentSeed;
}

/* ------------------------------------------------------------------ *
 * Hashing: xmur3 (string → 32-bit state) composed with a splitmix32
 * finalizer. No dependencies; integer math only, so the result is
 * bit-identical across JS engines.
 * ------------------------------------------------------------------ */

function xmur3(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function splitmix32(a: number): number {
  a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15);
  t = Math.imul(t, 0x735a2d97);
  t = t ^ (t >>> 15);
  return t >>> 0;
}

/**
 * Deterministic [0, 1) from an arbitrary string — no global seed, no
 * decision logging. For seed-derived choices that live OUTSIDE the audio
 * decision streams (e.g. which attention line a score shows). Pure, so it
 * cannot perturb any audio decision.
 */
export function hashUnit(key: string): number {
  return splitmix32(xmur3(key)) / 4294967296;
}

/* ------------------------------------------------------------------ *
 * Decision log — used by the determinism test and by nothing else.
 * When enabled, every rand() call is recorded.
 * ------------------------------------------------------------------ */

export type Decision = {
  layer: string;
  tick: number;
  salt: string;
  value: number;
};

let logging = false;
let decisionLog: Decision[] = [];

export function startLogging(): void {
  logging = true;
  decisionLog = [];
}

export function stopLogging(): Decision[] {
  logging = false;
  const log = decisionLog;
  decisionLog = [];
  return log;
}

/* ------------------------------------------------------------------ *
 * The generator.
 * ------------------------------------------------------------------ */

/**
 * Deterministic uniform value in [0, 1) for (seed, layer, tick, salt).
 * Counter-based and order-independent: calling rand('pad', 7) before or
 * after rand('drone', 3) changes nothing.
 */
export function rand(layer: string, tick: number, salt = ''): number {
  const key = `${currentSeed}${layer}${tick}${salt}`;
  const value = hashUnit(key);
  if (logging) decisionLog.push({ layer, tick, salt, value });
  return value;
}

/** Deterministic integer in [0, n). */
export function randInt(layer: string, tick: number, n: number, salt = ''): number {
  return Math.floor(rand(layer, tick, salt) * n);
}

/** Deterministic value in [lo, hi). */
export function randRange(
  layer: string,
  tick: number,
  lo: number,
  hi: number,
  salt = '',
): number {
  return lo + rand(layer, tick, salt) * (hi - lo);
}

/** Deterministic pick from a non-empty array. */
export function pick<T>(layer: string, tick: number, items: readonly T[], salt = ''): T {
  return items[randInt(layer, tick, items.length, salt)];
}

/**
 * Deterministic weighted pick: returns an index into `weights`.
 * Zero/negative total falls back to index 0 (a silent score is still a score).
 */
export function pickWeighted(
  layer: string,
  tick: number,
  weights: readonly number[],
  salt = '',
): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return 0;
  let r = rand(layer, tick, salt) * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Entropy for CREATING a new score seed — the one moment randomness is
 * allowed to be non-deterministic, because no score exists yet. Uses the
 * Web Crypto API in the browser and a hashed timestamp fallback elsewhere.
 * Never used during a performance.
 */
export function entropyUint32(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  }
  return splitmix32(xmur3(String(Date.now())));
}
