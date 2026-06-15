import { describe, expect, it } from 'vitest';
import type { Circumstance, Container, HourBand, Intention, Score } from './score';
import { SEED_WORDS, checksumValid, decode, encode, hourBandOf } from './score';

const INTENTIONS: Intention[] = ['settle', 'focus', 'rest', 'tend', 'wander', 'wait'];
const CONTAINERS: Container[] = [10, 20, 45, 'open'];
const BANDS: HourBand[] = ['morning', 'day', 'evening', 'night'];
const CIRCS: Circumstance[] = [];
for (const output of ['headphones', 'speakers'] as const)
  for (const field of ['quiet', 'noise'] as const)
    for (const company of ['alone', 'others'] as const)
      CIRCS.push({ output, field, company });

function score(partial: Partial<Score>): Score {
  return {
    v: 2,
    seed: 'KAMO-41',
    intention: 'tend',
    circumstance: { output: 'headphones', field: 'noise', company: 'alone' },
    container: 20,
    hourBand: 'evening',
    ...partial,
  };
}

describe('seed words', () => {
  it('has exactly 256 unique words, A–Z only, 3–6 letters', () => {
    expect(SEED_WORDS.length).toBe(256);
    expect(new Set(SEED_WORDS).size).toBe(256);
    for (const w of SEED_WORDS) {
      expect(w).toMatch(/^[A-Z]{3,6}$/);
    }
  });
});

describe('score code', () => {
  it('round-trips every field combination', () => {
    const seeds = ['KAMO-41', 'ABBEY-1', 'HOSHI-99', 'IVY-7', 'ZITHER-50'];
    for (const intention of INTENTIONS)
      for (const container of CONTAINERS)
        for (const hourBand of BANDS)
          for (const circumstance of CIRCS)
            for (const seed of seeds) {
              const s = score({ intention, container, hourBand, circumstance, seed });
              const code = encode(s);
              expect(code.length).toBeLessThanOrEqual(24);
              const back = decode(code);
              expect(back.ok).toBe(true);
              if (back.ok) expect(back.score).toEqual(s);
            }
  });

  it('is case-insensitive and ignores dashes and spaces', () => {
    const s = score({});
    const code = encode(s);
    const sloppy = code.toLowerCase().replace(/-/g, ' ');
    const back = decode(sloppy);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.score).toEqual(s);
    const undashes = decode(code.replace(/-/g, ''));
    expect(undashes.ok).toBe(true);
  });

  it('checksum catches every single-character substitution', () => {
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (const seed of ['KAMO-41', 'EDDY-9', 'TSUKI-88']) {
      const normalized = encode(score({ seed })).replace(/-/g, '');
      expect(checksumValid(normalized)).toBe(true);
      for (let i = 0; i < normalized.length; i++) {
        for (const ch of ALPHABET) {
          if (ch === normalized[i]) continue;
          const mutated = normalized.slice(0, i) + ch + normalized.slice(i + 1);
          // Every mutation must fail — by checksum or by field validation.
          expect(decode(mutated).ok).toBe(false);
        }
      }
    }
  });

  it('rejects garbage kindly (structured reasons)', () => {
    expect(decode('').ok).toBe(false);
    expect(decode('HELLO').ok).toBe(false);
    expect(decode('TEND-E20-C-KAMO-41??')).toEqual({ ok: false, reason: 'malformed' });
    const good = encode(score({}));
    const flipped = good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A');
    expect(decode(flipped)).toEqual({ ok: false, reason: 'checksum' });
  });

  it('matches the documented shape, e.g. TEND-E20-C-KAMO-41<check>', () => {
    const code = encode(score({}));
    expect(code).toMatch(/^TEND-E20-C-KAMO-41[A-Z0-9]$/);
  });
});

describe('a score performed in the wild', () => {
  // First card ever produced by v2 (2026-06-11). If this ever breaks,
  // existing printed cards stop re-performing — do not "fix" the test.
  it('WAND-D10-D-LEVEE-68P decodes to the same piece, forever', () => {
    const back = decode('WAND-D10-D-LEVEE-68P');
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.score).toEqual({
      v: 2,
      seed: 'LEVEE-68',
      intention: 'wander',
      circumstance: { output: 'headphones', field: 'noise', company: 'others' },
      container: 10,
      hourBand: 'day',
    });
  });
});

describe('hourBandOf', () => {
  it('maps hours to bands', () => {
    expect(hourBandOf(new Date(2026, 5, 11, 7))).toBe('morning');
    expect(hourBandOf(new Date(2026, 5, 11, 12))).toBe('day');
    expect(hourBandOf(new Date(2026, 5, 11, 19))).toBe('evening');
    expect(hourBandOf(new Date(2026, 5, 11, 23))).toBe('night');
    expect(hourBandOf(new Date(2026, 5, 11, 3))).toBe('night');
  });
});
