/**
 * mappings.ts — how answers become music. Pure data + pure functions.
 *
 * This file and lattice.ts are the only places tuning lives. If the
 * instrument needs a different character, edit here — never in the engine.
 *
 * Flow: intention → base parameters (the v2 table, verbatim below)
 *       → circumstance modifiers (additive nudges, then clamp 0–1)
 *       → hour-band modifiers (from the score's captured band, never the
 *         live clock).
 */

import type { Circumstance, HourBand, Intention, Score } from './score';
import type { Ratio } from './lattice';
import { POOLS, REGIONS } from './lattice';
import { hashUnit } from './rand';

export type Params = {
  /** Fixed for the whole performance. The tonic never moves. */
  tonicHz: number;
  pool: readonly Ratio[];
  regions: readonly (readonly number[])[];
  /** How often layers act when their loop comes around. 0–1. */
  density: number;
  /** Probability (per 31s check) that the active region changes. 0–1. */
  regionDrift: number;
  /** Octave placement of pool ratios. 0 low, 1 high. */
  register: number;
  /** Master lowpass position. 0 dark, 1 open. */
  brightness: number;
  /** Pink-noise texture layer gain. 0–1. */
  texture: number;
  /** Probability that a passed gate is spent on a composed silence. 0–1. */
  silence: number;
  /** Whether the sparse single-tone Events layer exists at all. */
  events: boolean;
  /** Sub-swell layer gain. 0 everywhere except Wander. */
  pulse: number;
  /** Seconds. Focus enforces 4s — after the threshold bell, a Focus
   *  performance contains zero perceptible onsets. */
  attackFloor: number;
  /** Stereo width ceiling. Speakers cap at 0.5 (the room adds the rest). */
  stereoWidthCap: number;
  /** Master trim in dB. Others nearby → −6 (and tonic up an octave, which
   *  moves difference tones out of the sub). */
  masterDb: number;
};

/* ------------------------------------------------------------------ *
 * The v2 base table — exactly as composed. Columns: tonic, density,
 * regionDrift, register, brightness, texture, silence, events, pulse.
 *
 * Why these tonics: low enough that the drone is a floor, not a note;
 * each intention sits on its own fundamental so switching intentions is
 * a different room, not a different song.
 * ------------------------------------------------------------------ */

type BaseRow = {
  tonicHz: number;
  density: number;
  regionDrift: number;
  register: number;
  brightness: number;
  texture: number;
  silence: number;
  events: boolean;
  pulse: number;
};

const BASE: Record<Intention, BaseRow> = {
  // Settle: middling density, real silence — arrivals you can return to.
  settle: { tonicHz: 65.41, density: 0.3, regionDrift: 0.2, register: 0.35, brightness: 0.3, texture: 0.25, silence: 0.4, events: true, pulse: 0 },
  // Focus: events OFF — discrete onsets are changing-state tokens, and
  // focus exists to protect working memory. Steady, slightly brighter bed.
  focus: { tonicHz: 73.42, density: 0.4, regionDrift: 0.05, register: 0.5, brightness: 0.4, texture: 0.3, silence: 0.25, events: false, pulse: 0 },
  // Rest: events OFF (sleep-adjacency), the smallest pool, the lowest
  // tonic, the dimmest light. Three ratios are enough to lie down in.
  rest: { tonicHz: 55.0, density: 0.2, regionDrift: 0.05, register: 0.2, brightness: 0.15, texture: 0.35, silence: 0.5, events: false, pulse: 0 },
  // Tend: the 6/5 minor third plus the highest silence ratio — single
  // tones that arrive and are not followed. Room to stay with something.
  tend: { tonicHz: 110.0, density: 0.25, regionDrift: 0.15, register: 0.4, brightness: 0.25, texture: 0.2, silence: 0.55, events: true, pulse: 0 },
  // Wander: the biggest pool (with the septimal 7/4), the most drift, the
  // only pulse. The one intention that moves toward you.
  wander: { tonicHz: 98.0, density: 0.55, regionDrift: 0.35, register: 0.6, brightness: 0.55, texture: 0.45, silence: 0.25, events: true, pulse: 0.15 },
  // Wait: sparse and patient. Each sound that arrives is enough.
  wait: { tonicHz: 82.41, density: 0.18, regionDrift: 0.08, register: 0.45, brightness: 0.3, texture: 0.25, silence: 0.6, events: true, pulse: 0 },
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/* ------------------------------------------------------------------ *
 * Modifiers — applied after the base, then clamped 0–1.
 * ------------------------------------------------------------------ */

export function paramsFor(score: Score): Params {
  const base = BASE[score.intention];
  const c: Circumstance = score.circumstance;

  let density = base.density;
  let register = base.register;
  let brightness = base.brightness;
  let silence = base.silence;
  let tonicHz = base.tonicHz;
  let masterDb = 0;
  let stereoWidthCap = 1;

  // Noise around you: the piece leans in — fewer composed silences (they
  // would read as dropouts against traffic), a little more activity, and
  // a slightly higher register to clear the noise floor.
  if (c.field === 'noise') {
    silence -= 0.2;
    density += 0.1;
    register += 0.1;
  }

  // Speakers: the room provides its own width; hard panning collapses
  // unpredictably across rooms, so cap the field at half.
  if (c.output === 'speakers') {
    stereoWidthCap = 0.5;
  }

  // Others nearby: quieter overall, and the tonic rises one octave so the
  // difference tones leave the sub — felt bass is intimate, and intimacy
  // is not yours to impose on a shared room.
  if (c.company === 'others') {
    masterDb = -6;
    tonicHz *= 2;
  }

  // Hour band — from the score, captured at creation. Never the live
  // clock: re-performing an evening piece at noon must not change it.
  const band: HourBand = score.hourBand;
  if (band === 'night') {
    brightness -= 0.15;
    register -= 0.1;
  } else if (band === 'morning') {
    brightness += 0.05;
  }

  return {
    tonicHz,
    pool: POOLS[score.intention],
    regions: REGIONS[score.intention],
    density: clamp01(density),
    regionDrift: clamp01(base.regionDrift),
    register: clamp01(register),
    brightness: clamp01(brightness),
    texture: clamp01(base.texture),
    silence: clamp01(silence),
    events: base.events,
    pulse: clamp01(base.pulse),
    attackFloor: score.intention === 'focus' ? 4 : 0,
    stereoWidthCap,
    masterDb,
  };
}

/** Master lowpass cutoff from brightness — exponential, 800 Hz to 6 kHz,
 *  so equal brightness steps feel equal. */
export function brightnessToHz(brightness: number): number {
  return 800 * Math.pow(6000 / 800, clamp01(brightness));
}

/** The texture (pink-noise) level a chosen intention runs at — reused by the
 *  app-wide field's grain so the dark visually rhymes with the audio. Neutral
 *  default before an intention is chosen. */
export function textureFor(intention: Intention | null): number {
  return intention ? BASE[intention].texture : 0.3;
}

/* ------------------------------------------------------------------ *
 * Drift — the slow random walk each scalar takes during a performance.
 * ------------------------------------------------------------------ */

export const DRIFT_STEP = 0.05; // per walk, ± this
export const DRIFT_CLAMP = 0.15; // never more than this from base
export const DRIFT_INTERVAL_S: readonly [number, number] = [20, 40];

/** Scalars that walk. Everything else holds still. */
export const DRIFTING_SCALARS = [
  'density',
  'register',
  'brightness',
  'texture',
  'silence',
] as const;
export type DriftingScalar = (typeof DRIFTING_SCALARS)[number];

/* ------------------------------------------------------------------ *
 * Threshold copy — final, verbatim. Each line binds attention to a
 * musical element, if–then shaped. The single reading is the rehearsal.
 * ------------------------------------------------------------------ */

// Ten per intention, same voice — if–then shaped, each binding attention
// to a musical element (the lowest tone, the longest sound, the silence,
// a sound that arrives or goes). The first of each is the original. One is
// chosen per score, seeded (see intentionLineFor), so a new score feels
// fresh while re-performing a code shows the same line.
export const INTENTION_LINE_SETS: Record<Intention, readonly string[]> = {
  settle: [
    'When I notice I have drifted, I return to the lowest tone.',
    'However far I wander, the lowest tone is the way back.',
    'Each time I catch myself thinking, I settle onto the deepest sound.',
    'When the mind rises, I let the low tone draw it down again.',
    'I keep returning, without hurry, to the tone beneath everything.',
    'The ground note holds; I come back to it as often as I leave.',
    'When I drift, I find the drone again and rest there.',
    'I let the lowest sound be the floor I keep returning to.',
    'Whenever I notice I have left, I lower my attention to the deepest tone.',
    'I rise, I notice, I return to the tone that stays.',
  ],
  focus: [
    'When the sound surfaces again, I let it pass and continue.',
    'I let each tone rise and fall without following it.',
    'When the music draws my attention, I notice, and return to my work.',
    'The sound is company, not a summons; I let it be.',
    'When I drift toward listening, I set it down and go on.',
    'Each sound passes through; I stay with what I am doing.',
    'I let the sound keep to the background, and keep to my task.',
    'When I find myself listening, I gently look away and continue.',
    'The tones come and go; my attention stays where I put it.',
    'I work alongside the sound, and let it ask nothing of me.',
  ],
  rest: [
    'When a thought arrives, I let the longest sound carry it off.',
    'I lay each thought on a fading tone and let it drift away.',
    'As a sound decays, I let a thought decay with it.',
    'When the mind stirs, I rest it on the nearest fading sound.',
    'I let the slow sounds carry me toward sleep.',
    'Every long tone is somewhere to set a thought down.',
    'I follow each decay until the sound, and the thought, let go.',
    'Nothing to keep tonight; I let each tone carry it off.',
    'I let the longest sounds do the holding now.',
    'When I notice thinking, I release it into the longest note.',
  ],
  tend: [
    'I stay with what arrives, and let the silences hold it.',
    'I mend nothing; I let the silence make room.',
    'Whatever surfaces, I let it stay as long as it needs.',
    'When something heavy arrives, I let a long silence carry its weight.',
    'I keep company with what is here, and the quiet keeps it with me.',
    'I let each sound be met, and each silence be enough.',
    'I let what is difficult rest in the space between the sounds.',
    'Nothing needs fixing; I stay, and the silence holds.',
    'I stay with the tone, and stay through the silence after it.',
    'What arrives is allowed to arrive; the silence will hold it.',
  ],
  wander: [
    'When something catches my ear, I follow it until it goes.',
    'I let my attention wander to whatever sound calls it.',
    'When a tone interests me, I go with it as far as it leads.',
    'I follow one sound, then let the next take me elsewhere.',
    'Wherever a sound goes, I am free to follow.',
    'When something new arrives, I turn toward it until it fades.',
    'I drift with the sounds, keeping to no particular path.',
    'Each sound is a turn I may take, or may let pass.',
    'I follow what shimmers, and let it lead me out and back.',
    'I let curiosity choose, and follow the brightest thread.',
  ],
  wait: [
    'Each sound that arrives is enough.',
    'I wait, and what comes is enough.',
    'I expect nothing; each tone is the whole of it.',
    'When a sound arrives, I let it be all there is.',
    'There is nothing to wait for; the sound is already here.',
    'I let the gaps be as full as the sounds.',
    'Whatever arrives, and whenever, is enough.',
    'I rest in the waiting; the next sound will come when it comes.',
    'Each tone is complete; I need no more than this one.',
    'I let time pass at the pace the sounds set.',
  ],
};

/** The one attention line a given score shows — chosen deterministically
 *  from its seed (pure hash, never Math.random), so the threshold, the
 *  performance, and the card all agree, and re-performing a code is
 *  consistent, while a freshly-seeded score varies. */
export function intentionLineFor(score: Score): string {
  const set = INTENTION_LINE_SETS[score.intention];
  const i = Math.floor(hashUnit(`${score.seed}:line:${score.intention}`) * set.length);
  return set[i];
}

/** Focus carries one extra small line on the threshold screen. */
export const FOCUS_NOTE = 'No beat, on purpose.';

/** A small line under each intention on the "what is this time for?"
 *  screen — the occasion the intention is for, not a description of the
 *  sound. */
export const INTENTION_SUBTITLES: Record<Intention, string> = {
  settle: 'arriving, coming down, transitions',
  focus: 'working alongside the sound',
  rest: 'lying down, sleep-adjacent',
  tend: 'grief, heaviness, being with what’s difficult',
  wander: 'walking, transit, open attention',
  wait: 'queues, delays, rooms you didn’t choose',
};

const BAND_WORD: Record<HourBand, string> = {
  morning: 'Morning',
  day: 'Day',
  evening: 'Evening',
  night: 'Night',
};

const CONTAINER_WORD: Record<string, string> = {
  '10': 'Ten minutes',
  '20': 'Twenty minutes',
  '45': 'Forty-five minutes',
  open: 'Open time',
};

/** The score sentence: [HourBand]. [Field]. [Container]. [Intention line.] */
export function scoreSentence(score: Score): string {
  const field = score.circumstance.field === 'noise' ? 'Noise around me' : 'Quiet around me';
  return [
    `${BAND_WORD[score.hourBand]}.`,
    `${field}.`,
    `${CONTAINER_WORD[String(score.container)]}.`,
    intentionLineFor(score),
  ].join(' ');
}

/* ------------------------------------------------------------------ *
 * Performance arc constants.
 * ------------------------------------------------------------------ */

export const THRESHOLD_S = 30; // fade in from true silence
export const ENDING_S = 90; // composed ending, including…
export const ENDING_SILENCE_S = 10; // …10 seconds of true silence
export const MORE_SPACE_FACTOR = 0.85; // density × this per press
export const MORE_SPACE_FLOOR = 0.05;

/* ------------------------------------------------------------------ *
 * VISUALS — the breathing ring and the weather inside it.
 *
 * This is the ONLY place the interior is tuned. One number changed here
 * must visibly change the ring or its weather; the canvas reads nothing
 * else. Style (colours, the ring's size) lives in tokens.css — these are
 * the *behavioural* numbers: pace, amplitude, envelopes, ceilings.
 *
 * Two hard rules the defaults must honour (see the brief): the interior
 * is weather, not a visualiser — nothing responds faster than ~1.5s, and
 * total interior luminance stays a hair above the background. A watcher
 * should be unable to predict the music from it.
 * ------------------------------------------------------------------ */

export const VISUALS = {
  /** The ring's breathing period, seconds — per intention, so the pace
   *  matches the room: wander a touch quicker, rest/wait slower. Default 8
   *  (v1's value). Drives a CSS custom property; the keyframes stay in CSS. */
  breathPeriodS: {
    settle: 8,
    focus: 8,
    rest: 11,
    tend: 9,
    wander: 6.5,
    wait: 10,
  } as Record<Intention, number>,

  /** TIDE — the continuous ground, always present. Three incommensurate
   *  sinusoids whose periods are drawn once per performance from these
   *  primes (seconds); two more drive the slow centre wander. */
  tidePrimesS: [53, 71, 89, 109] as const,
  /** Inner luminous disc radius, as a fraction of the interior radius. */
  tideRadius: { min: 0.28, max: 0.55 },
  /** Slow wander of the disc centre, as a fraction of the diameter (≤). */
  tideCenterOffset: 0.025,
  /** Peak tide alpha at full brightness — kept low: this is the brightest
   *  thing in the interior and it must stay barely-there. */
  tidePeakAlpha: 0.12,
  /** At or below this live density the tide is essentially still
   *  (Rest sits here); it grows visibly alive toward `tideAliveDensity`. */
  tideStillDensity: 0.12,
  tideAliveDensity: 0.5,
  /** Brightness scales tide luminance between this floor and full. */
  tideBrightnessFloor: 0.55,

  /** BLOOMS — one soft circle per onset (pad cloud, event, opening bell). */
  bloom: {
    maxConcurrent: 3, // oldest dropped past this
    durationS: { min: 8, max: 16 }, // ≥1.5s attack inside this
    attackS: 1.5,
    radius: { min: 0.1, max: 0.55 }, // fraction of interior radius
    panSpread: 0.2, // pan ±1 → ± this fraction horizontally
    peakAlpha: 0.06, // velocity (normalised) → initial opacity
    /** Velocity is normalised against this nominal max before scaling. */
    velocityRef: 0.4,
    bell: { radiusScale: 1.5, durationScale: 1.6, radiusCap: 0.7 },
  },

  /** REGION SHIFT — harmonic motion made faintly visible. When the active
   *  region changes, the tide's luminance leans, eased over this many
   *  seconds (mirrors the root's glide). A brightness lean only. */
  regionEaseS: 8,
  regionBias: 0.05, // max ± lean added to the tide peak alpha

  /** The ceiling the interior never crosses — total added luminance stays
   *  within ~this fraction above the background. "Felt before noticed." */
  luminanceCeiling: 0.08,

  /** Redraw target. rAF, throttled by Transport time to ~this fps. */
  fps: 22,

  /** THE FIELD — the app-wide background "lighting" behind every screen.
   *  Ambient and ephemeral: wall-clock timed, never reproduced from a code,
   *  never reacts to individual notes (onset blooms stay inside the ring).
   *  See ui/field.ts (pure maths) and ui/Field.tsx (the canvas). */
  field: {
    /** Per-intention character: an RGB *temperature* delta added to --bg at
     *  full lift+tide (tiny — ≈+3–6% luminance), plus lift and speed scalars.
     *  Temperature leans only, never a nameable hue. Shared with the ring
     *  interior so the two read as one light. */
    character: {
      // temp: RGB lean. lift: pool brightness. speed: drift + grain-shimmer
      // rate. grain: how much static (0–1). Six rooms, six kinds of weather.
      settle: { temp: [18, 14, 6], lift: 1.0, speed: 1.0, grain: 0.6 },
      focus: { temp: [9, 13, 22], lift: 1.05, speed: 1.3, grain: 0.72 },
      rest: { temp: [6, 6, 16], lift: 0.5, speed: 0.4, grain: 0.18 },
      tend: { temp: [22, 11, 4], lift: 0.95, speed: 0.7, grain: 0.45 },
      wander: { temp: [13, 20, 30], lift: 1.4, speed: 2.2, grain: 1.0 },
      wait: { temp: [9, 9, 22], lift: 0.7, speed: 0.55, grain: 0.3 },
    } as Record<
      Intention,
      { temp: readonly [number, number, number]; lift: number; speed: number; grain: number }
    >,
    /** Before an intention is chosen (home, intake start): a neutral room. */
    neutral: { temp: [13, 13, 16], lift: 1.0, speed: 1.0, grain: 0.5 } as {
      temp: readonly [number, number, number];
      lift: number;
      speed: number;
      grain: number;
    },

    /** Tide — three incommensurate sinusoids, periods drawn once at load
     *  from these primes; nothing perceptible changes inside ~15s. */
    tidePeriodsS: [53, 71, 89, 109, 127] as readonly number[],
    tideLiftRange: 0.45, // pool lift varies ±this fraction of the mean

    /** Pool — one soft radial region of less-dark; no traceable edge. */
    poolRadiusFrac: 0.66, // × max(viewport dim), mean
    poolRadiusTide: 0.115, // ± radius on the tide
    poolCenterY: 0.42, // intake/home: slightly above middle (behind the text)
    poolDriftFrac: { x: 0.1, y: 0.08 }, // wander on the tide (× ceiling)
    /** While performing the pool condenses toward the ring (screen centre). */
    performRadiusFrac: 0.34,
    performCenterY: 0.48,

    /** Grain — 1px speckle, load-bearing: makes the dark read as material
     *  and dithers the pool so it can't band. Several noise tiles are built
     *  at load and cycled, so it SHIMMERS like film/TV static — this one
     *  layer is deliberately allowed to move fast (the pool/lighting still
     *  obeys the slow ~15s tide; only the grain twinkles). Amount + shimmer
     *  rate vary per intention (character.grain / .speed). */
    grainTileSize: 256,
    grainTileCount: 24, // distinct noise tiles, cycled for the shimmer
    grainShimmerHz: 14, // base tile-swap rate (× the room's speed)
    grainDensity: 0.13, // fraction of tile pixels populated — pronounced static
    grainAlpha: { min: 0.09, max: 0.22 }, // per-speck
    grainTint: [206, 206, 218] as readonly number[], // toward ink
    grainBaseAlpha: 1.0,
    grainTideRange: { min: 0.6, max: 1.0 }, // global alpha rides the tide

    /** Phase ceilings — one multiplier per screen, eased. closing reuses
     *  performing's, then gets multiplied by the live density taper so it
     *  empties to black through the silence. */
    ceiling: {
      home: 1.0,
      intake: 1.0,
      threshold: 1.0,
      performing: 0.6, // recedes, but stays present enough to read as distinct
      closing: 0.6, // × the live density taper → empties to black
      card: 0.25,
      scores: 0.25,
      about: 0.6,
    } as Record<string, number>,
    /** hourBand reductions (multiplier on the phase ceiling). */
    hourBandCeiling: {
      morning: 1.0,
      day: 1.0,
      evening: 0.85,
      night: 0.7,
    } as Record<HourBand, number>,

    easeTauS: 10, // phase + character leans
    homeReturnTauS: 4, // easing back to neutral on return home
    fadeUpS: 2, // app open: fade from black
    /** Hard contrast ceiling — no field pixel brighter than this (#28282f),
     *  still far below --ink-dim (#6e6d68); text contrast is never in play.
     *  Raised from #1a1a1e, which read as flat black on normal displays. */
    maxPixel: [40, 40, 48] as readonly number[],
    fps: 30, // high enough that the busy rooms read as fast static, not strobe
  },
} as const;
