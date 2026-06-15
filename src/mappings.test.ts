import { describe, expect, it } from 'vitest';
import {
  INTENTION_LINE_SETS,
  brightnessToHz,
  intentionLineFor,
  paramsFor,
  scoreSentence,
} from './mappings';
import type { Intention, Score } from './score';

const ALL_INTENTIONS: Intention[] = [
  'settle',
  'focus',
  'rest',
  'tend',
  'wander',
  'wait',
];

function score(partial: Partial<Score>): Score {
  return {
    v: 2,
    seed: 'KAMO-41',
    intention: 'settle',
    // "plain" circumstance: no modifiers fire
    circumstance: { output: 'headphones', field: 'quiet', company: 'alone' },
    container: 20,
    hourBand: 'day',
    ...partial,
  };
}

describe('paramsFor', () => {
  it('reproduces the base table exactly when no modifiers apply', () => {
    const p = paramsFor(score({ intention: 'settle' }));
    expect(p.tonicHz).toBe(65.41);
    expect(p.density).toBe(0.3);
    expect(p.regionDrift).toBe(0.2);
    expect(p.register).toBe(0.35);
    expect(p.brightness).toBe(0.3);
    expect(p.texture).toBe(0.25);
    expect(p.silence).toBe(0.4);
    expect(p.events).toBe(true);
    expect(p.pulse).toBe(0);

    const w = paramsFor(score({ intention: 'wander' }));
    expect(w.tonicHz).toBe(98.0);
    expect(w.density).toBe(0.55);
    expect(w.pulse).toBe(0.15);
  });

  it('events are off for focus and rest; focus gets the 4s attack floor', () => {
    expect(paramsFor(score({ intention: 'focus' })).events).toBe(false);
    expect(paramsFor(score({ intention: 'rest' })).events).toBe(false);
    expect(paramsFor(score({ intention: 'focus' })).attackFloor).toBe(4);
    expect(paramsFor(score({ intention: 'settle' })).attackFloor).toBe(0);
    expect(paramsFor(score({ intention: 'wander' })).events).toBe(true);
  });

  it('noise: silence −.20, density +.10, register +.10', () => {
    const p = paramsFor(
      score({ circumstance: { output: 'headphones', field: 'noise', company: 'alone' } }),
    );
    expect(p.silence).toBeCloseTo(0.2, 10);
    expect(p.density).toBeCloseTo(0.4, 10);
    expect(p.register).toBeCloseTo(0.45, 10);
  });

  it('speakers cap stereo width at 0.5', () => {
    const p = paramsFor(
      score({ circumstance: { output: 'speakers', field: 'quiet', company: 'alone' } }),
    );
    expect(p.stereoWidthCap).toBe(0.5);
    expect(paramsFor(score({})).stereoWidthCap).toBe(1);
  });

  it('others nearby: −6 dB and tonic up an octave', () => {
    const p = paramsFor(
      score({ circumstance: { output: 'headphones', field: 'quiet', company: 'others' } }),
    );
    expect(p.masterDb).toBe(-6);
    expect(p.tonicHz).toBe(130.82);
  });

  it('night dims and lowers; morning brightens slightly; clamps hold', () => {
    const night = paramsFor(score({ intention: 'rest', hourBand: 'night' }));
    expect(night.brightness).toBeCloseTo(0, 10); // 0.15 − 0.15 → clamped at 0
    expect(night.register).toBeCloseTo(0.1, 10);
    const morning = paramsFor(score({ hourBand: 'morning' }));
    expect(morning.brightness).toBeCloseTo(0.35, 10);
  });

  it('hourBand comes from the score, never the clock', () => {
    // same score decoded at any time of day must give identical params
    const a = paramsFor(score({ hourBand: 'evening' }));
    const b = paramsFor(score({ hourBand: 'evening' }));
    expect(a).toEqual(b);
  });
});

describe('brightnessToHz', () => {
  it('spans 800–6000 Hz exponentially', () => {
    expect(brightnessToHz(0)).toBeCloseTo(800, 6);
    expect(brightnessToHz(1)).toBeCloseTo(6000, 6);
    expect(brightnessToHz(0.5)).toBeCloseTo(Math.sqrt(800 * 6000), 6);
  });
});

describe('intention lines', () => {
  it('has 10 distinct lines per intention', () => {
    for (const i of ALL_INTENTIONS) {
      expect(INTENTION_LINE_SETS[i].length).toBe(10);
      expect(new Set(INTENTION_LINE_SETS[i]).size).toBe(10);
    }
  });

  it('picks one line per score, deterministically from the seed', () => {
    const s = score({ intention: 'settle', seed: 'KAMO-41' });
    const line = intentionLineFor(s);
    expect(INTENTION_LINE_SETS.settle).toContain(line);
    expect(intentionLineFor(s)).toBe(line); // stable across calls
    // re-decoding the same seed reproduces the same line
    expect(intentionLineFor(score({ intention: 'settle', seed: 'KAMO-41' }))).toBe(line);
  });

  it('varies the line across different seeds (dynamism)', () => {
    const seeds = ['KAMO-41', 'HOSHI-7', 'ABBEY-1', 'ZITHER-50', 'EDDY-9', 'TSUKI-88'];
    const lines = new Set(
      seeds.map((seed) => intentionLineFor(score({ intention: 'wander', seed }))),
    );
    expect(lines.size).toBeGreaterThan(1);
  });
});

describe('scoreSentence', () => {
  it('composes the prefix, then a line from the intention set', () => {
    const s = score({
      intention: 'settle',
      hourBand: 'evening',
      container: 20,
      circumstance: { output: 'headphones', field: 'noise', company: 'alone' },
    });
    const prefix = 'Evening. Noise around me. Twenty minutes. ';
    const sentence = scoreSentence(s);
    expect(sentence.startsWith(prefix)).toBe(true);
    expect(sentence.slice(prefix.length)).toBe(intentionLineFor(s));
    expect(INTENTION_LINE_SETS.settle).toContain(sentence.slice(prefix.length));
  });

  it('handles open containers and quiet fields', () => {
    const s = score({ intention: 'wait', hourBand: 'night', container: 'open' });
    const prefix = 'Night. Quiet around me. Open time. ';
    expect(scoreSentence(s).startsWith(prefix)).toBe(true);
    expect(INTENTION_LINE_SETS.wait).toContain(scoreSentence(s).slice(prefix.length));
  });
});
