/**
 * score.ts — the Score object and the score code.
 *
 * The score is the only thing that travels. The code on the card IS the
 * score — fully self-contained, no server, no lookup. Anyone can type it
 * into their own device and the same piece performs again.
 *
 * Code format (display form):  TEND-E20-C-KAMO-41X
 *   TEND   intention (4 letters)
 *   E20    hourBand letter + minutes (OP for open)
 *   C      one letter A–H encoding the three circumstance bits
 *   KAMO   entropy word (from the curated list below)
 *   41     entropy number 1–99
 *   X      Luhn mod-36 checksum character (catches every single-char typo)
 *
 * ≤ 24 characters, case-insensitive; dashes and spaces are decoration —
 * decode ignores them.
 */

import { entropyUint32 } from './rand';

export type Intention = 'settle' | 'focus' | 'rest' | 'tend' | 'wander' | 'wait';
export type Output = 'headphones' | 'speakers';
export type Field = 'quiet' | 'noise';
export type Company = 'alone' | 'others';
export type Container = 10 | 20 | 45 | 'open';
export type HourBand = 'morning' | 'day' | 'evening' | 'night';

export type Circumstance = {
  output: Output;
  field: Field;
  company: Company;
};

export type Score = {
  v: 2;
  seed: string; // entropy word + number, e.g. "KAMO-41"
  intention: Intention;
  circumstance: Circumstance;
  container: Container;
  /**
   * Captured INTO the score at creation, never read from the live clock
   * during performance — re-performing an evening piece at noon must not
   * change it.
   */
  hourBand: HourBand;
};

/* ------------------------------------------------------------------ *
 * Entropy words — 256 two-syllable words, pleasant to say aloud.
 * All A–Z, 3–6 letters, unique. A test asserts all of that.
 * ------------------------------------------------------------------ */

// prettier-ignore
export const SEED_WORDS: readonly string[] = [
  'ABBEY','ACORN','AGATE','ALDER','ALPINE','AMBER','AMBLE','ANTLER','APRIL','ARBOR','ARROW','ASHEN','ASPEN','ASTER','AUTUMN','AZURE',
  'BALLAD','BALSAM','BAMBOO','BANNER','BARLEY','BASIN','BECKON','BELFRY','BERRY','BILLOW','BISON','BOWER','BREEZY','BRIDLE','BURLAP','BURROW',
  'CANDLE','CANYON','CASTLE','CEDAR','CELLO','CHERRY','CINDER','CIRRUS','CITRUS','CLOVER','COBALT','COMET','COPPER','CORAL','COTTON','CRADLE',
  'DABBLE','DAISY','DAMSON','DAPPLE','DELTA','DENIM','DEWY','DIMPLE','DINGHY','DORY','DREAMY','DUSKY',
  'EAGLE','EASEL','ECHO','EDDY','EGRET','ELDER','EMBER','ERMINE',
  'FABLE','FALCON','FALLOW','FATHOM','FENNEL','FERRY','FIDDLE','FLAXEN','FLORA','FOSSIL','FROLIC','FURROW',
  'GABLE','GALLEY','GARNET','GENTLE','GINGER','GINKGO','GOLDEN','GROTTO','GUITAR','GULLY',
  'HALO','HAMLET','HARBOR','HAVEN','HAZEL','HENNA','HERON','HOLLOW','HOLLY','HONEY','HUMBLE','HUSKY',
  'INLET','IRIS','ISLAND','IVY',
  'JASPER','JETTY','JOLLY','JUNCO',
  'KERNEL','KINDLE',
  'LADLE','LAGOON','LAUREL','LEVEE','LICHEN','LILAC','LILY','LINDEN','LINEN','LOFTY','LUMEN','LUNAR',
  'MALLOW','MANTLE','MAPLE','MARBLE','MARLIN','MEADOW','MELLOW','MINNOW','MISTY','MOSSY','MUSLIN','MYRTLE',
  'NECTAR','NESTLE','NICKEL','NIMBUS','NOVEL','NUTMEG',
  'OAKEN','OCEAN','OLIVE','OPAL','OTTER','OXBOW',
  'PARLOR','PASTEL','PEBBLE','PETAL','PEWTER','PILLOW','PIPPIN','PLOVER','PONDER','POPLAR','PUDDLE','PUFFIN',
  'QUARRY','QUIVER',
  'RAFTER','RAMBLE','RAVINE','RIPPLE','RIVER','ROBIN','RONDO','ROWAN','RUSSET','RUSTIC',
  'SABLE','SADDLE','SALMON','SANDY','SHADOW','SILVER','SONNET','SORREL','STANZA','SUMMIT','SUNDEW','SUNLIT',
  'TABBY','TASSEL','TEAPOT','TEMPLE','TIDAL','TIMBER','TONIC','TOTEM','TULIP','TUNDRA',
  'UMBER','UPLAND',
  'VALLEY','VAPOR','VELLUM','VELVET','VESPER','VISTA',
  'WAFER','WALNUT','WARBLE','WICKER','WILLOW','WINTER','WONDER','WOOLEN',
  'YARROW','YONDER',
  'ZEPHYR','ZITHER',
  'KAMO','KIRI','HANA','SORA','NAMI','YAMA','KAWA','HOSHI','YUKI','KAZE','MORI','TANI','HAMA','SUNA','KUMO','NIWA',
  'MIZU','YORU','HARU','FUYU','SHIRO','KURO','MOMO','YUZU','SUZU','MATSU','TORI','KAGO','FUNE','SHIMA','TAKI','KANE',
  'KOTO','UME','NATSU','TSUKI','MICHI','TAMA','SATO','MURA','KUSA','HASU',
];

/* ------------------------------------------------------------------ *
 * Field codings.
 * ------------------------------------------------------------------ */

const INTENTION_CODE: Record<Intention, string> = {
  settle: 'SETT',
  focus: 'FOCU',
  rest: 'REST',
  tend: 'TEND',
  wander: 'WAND',
  wait: 'WAIT',
};

const CODE_INTENTION: Record<string, Intention> = Object.fromEntries(
  Object.entries(INTENTION_CODE).map(([k, v]) => [v, k as Intention]),
);

const BAND_CODE: Record<HourBand, string> = {
  morning: 'M',
  day: 'D',
  evening: 'E',
  night: 'N',
};

const CODE_BAND: Record<string, HourBand> = Object.fromEntries(
  Object.entries(BAND_CODE).map(([k, v]) => [v, k as HourBand]),
);

function containerCode(c: Container): string {
  return c === 'open' ? 'OP' : String(c);
}

function codeContainer(s: string): Container | null {
  if (s === 'OP') return 'open';
  if (s === '10') return 10;
  if (s === '20') return 20;
  if (s === '45') return 45;
  return null;
}

/** Three circumstance bits → one letter A–H. */
function circumstanceLetter(c: Circumstance): string {
  const bits =
    (c.output === 'speakers' ? 4 : 0) +
    (c.field === 'noise' ? 2 : 0) +
    (c.company === 'others' ? 1 : 0);
  return String.fromCharCode(65 + bits); // A–H
}

function letterCircumstance(letter: string): Circumstance | null {
  const bits = letter.charCodeAt(0) - 65;
  if (bits < 0 || bits > 7) return null;
  return {
    output: bits & 4 ? 'speakers' : 'headphones',
    field: bits & 2 ? 'noise' : 'quiet',
    company: bits & 1 ? 'others' : 'alone',
  };
}

/* ------------------------------------------------------------------ *
 * Checksum — Luhn mod 36 over A–Z0–9. Catches every single-character
 * substitution and nearly all adjacent transpositions, so a typo fails
 * gracefully instead of performing the wrong piece.
 * ------------------------------------------------------------------ */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const N = 36;

function charValue(ch: string): number {
  const v = ALPHABET.indexOf(ch);
  if (v === -1) throw new Error(`invalid character: ${ch}`);
  return v;
}

/** Compute the check character for a payload (payload excludes it). */
export function checksumChar(payload: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = payload.length - 1; i >= 0; i--) {
    const addend = factor * charValue(payload[i]);
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / N) + (addend % N);
  }
  return ALPHABET[(N - (sum % N)) % N];
}

/** Validate a full string (payload + trailing check character). */
export function checksumValid(full: string): boolean {
  let factor = 1;
  let sum = 0;
  for (let i = full.length - 1; i >= 0; i--) {
    const v = ALPHABET.indexOf(full[i]);
    if (v === -1) return false;
    const addend = factor * v;
    factor = factor === 1 ? 2 : 1;
    sum += Math.floor(addend / N) + (addend % N);
  }
  return sum % N === 0;
}

/* ------------------------------------------------------------------ *
 * Encode / decode.
 * ------------------------------------------------------------------ */

/** Strip decoration: uppercase, remove dashes/spaces. */
function normalize(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

export function encode(score: Score): string {
  const [word, num] = splitSeed(score.seed);
  const payload =
    INTENTION_CODE[score.intention] +
    BAND_CODE[score.hourBand] +
    containerCode(score.container) +
    circumstanceLetter(score.circumstance) +
    word +
    String(num);
  const check = checksumChar(payload);
  // Display form, dashed for readability; decode accepts either.
  return [
    INTENTION_CODE[score.intention],
    BAND_CODE[score.hourBand] + containerCode(score.container),
    circumstanceLetter(score.circumstance),
    word,
    String(num) + check,
  ].join('-');
}

export type DecodeResult =
  | { ok: true; score: Score }
  | { ok: false; reason: 'malformed' | 'checksum' };

export function decode(code: string): DecodeResult {
  const s = normalize(code);
  // Minimum: 4 intention + 1 band + 2 minutes + 1 circ + 3 word + 1 num + 1 check
  if (s.length < 13 || s.length > 24) return { ok: false, reason: 'malformed' };
  if (!/^[A-Z0-9]+$/.test(s)) return { ok: false, reason: 'malformed' };
  if (!checksumValid(s)) return { ok: false, reason: 'checksum' };

  const intention = CODE_INTENTION[s.slice(0, 4)];
  const hourBand = CODE_BAND[s[4]];
  const container = codeContainer(s.slice(5, 7));
  const circumstance = letterCircumstance(s[7]);
  const tail = s.slice(8, -1); // word + number, checksum removed
  const m = /^([A-Z]+)([0-9]{1,2})$/.exec(tail);

  if (!intention || !hourBand || container === null || !circumstance || !m) {
    return { ok: false, reason: 'malformed' };
  }
  const word = m[1];
  const num = parseInt(m[2], 10);
  if (!SEED_WORDS.includes(word) || num < 1 || num > 99) {
    return { ok: false, reason: 'malformed' };
  }

  return {
    ok: true,
    score: {
      v: 2,
      seed: `${word}-${num}`,
      intention,
      circumstance,
      container,
      hourBand,
    },
  };
}

function splitSeed(seed: string): [string, number] {
  const m = /^([A-Z]+)-([0-9]{1,2})$/.exec(seed);
  if (!m) throw new Error(`invalid seed: ${seed}`);
  return [m[1], parseInt(m[2], 10)];
}

/* ------------------------------------------------------------------ *
 * Creation.
 * ------------------------------------------------------------------ */

/**
 * Fresh entropy for a NEW score — the only non-deterministic moment in the
 * system. Once the seed exists, everything downstream is a pure function
 * of it.
 */
export function newSeed(): string {
  const word = SEED_WORDS[entropyUint32() % SEED_WORDS.length];
  const num = (entropyUint32() % 99) + 1;
  return `${word}-${num}`;
}

/** Hour band from a creation-time Date. Captured once, never re-read. */
export function hourBandOf(date: Date): HourBand {
  const h = date.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'day';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}
