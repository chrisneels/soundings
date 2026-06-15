import { describe, expect, it } from 'vitest';
import {
  DRONE_RATIOS,
  PARTIAL_COUNT,
  POOLS,
  REGIONS,
  centsBetween,
  freqOf,
  leadVoices,
  partialAmp,
  placeRatio,
} from './lattice';
import type { Intention } from './score';

const INTENTIONS: Intention[] = ['settle', 'focus', 'rest', 'tend', 'wander', 'wait'];

describe('lattice', () => {
  it('every region weight array matches its pool length', () => {
    for (const i of INTENTIONS) {
      expect(REGIONS[i].length).toBeGreaterThanOrEqual(2);
      expect(REGIONS[i].length).toBeLessThanOrEqual(3);
      for (const region of REGIONS[i]) {
        expect(region.length).toBe(POOLS[i].length);
      }
    }
  });

  it('every pool starts at 1/1; wander contains the harmonic seventh 7/4', () => {
    for (const i of INTENTIONS) {
      expect(POOLS[i][0]).toEqual({ n: 1, d: 1 });
    }
    expect(POOLS.wander.some((r) => r.n === 7 && r.d === 4)).toBe(true);
  });

  it('placeRatio preserves the exact ratio — only octaves move', () => {
    const tonic = 65.41;
    for (const i of INTENTIONS) {
      for (const r of POOLS[i]) {
        for (const register of [0, 0.25, 0.5, 0.75, 1]) {
          const f = placeRatio(r, tonic, register);
          const octaves = Math.log2(f / freqOf(r, tonic));
          // must be a whole number of octaves from the raw ratio
          expect(Math.abs(octaves - Math.round(octaves))).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('higher register places higher', () => {
    const r = { n: 3, d: 2 };
    const low = placeRatio(r, 65.41, 0.1);
    const high = placeRatio(r, 65.41, 0.9);
    expect(high).toBeGreaterThan(low);
  });

  it('leadVoices stays near the previous voicing and preserves ratios', () => {
    const tonic = 110;
    const ratios = [
      { n: 5, d: 4 },
      { n: 3, d: 2 },
    ];
    const first = leadVoices([], ratios, tonic, 0.4);
    expect(first.length).toBe(2);
    const second = leadVoices(first, ratios, tonic, 0.4);
    // identical targets, sounding voicing present → it should not leap
    for (let k = 0; k < 2; k++) {
      expect(centsBetween(second[k], first[k])).toBeLessThan(1);
    }
  });

  it('drone is exactly 1/1 and 3/2 — zero detune, beatless by construction', () => {
    expect(DRONE_RATIOS).toEqual([
      { n: 1, d: 1 },
      { n: 3, d: 2 },
    ]);
    // over a 65.41 Hz tonic the difference tone sits near 32 Hz
    const diff = freqOf(DRONE_RATIOS[1], 65.41) - freqOf(DRONE_RATIOS[0], 65.41);
    expect(diff).toBeCloseTo(32.705, 3);
  });

  it('partials follow 1/n^1.4 across all 8', () => {
    expect(PARTIAL_COUNT).toBe(8);
    expect(partialAmp(1)).toBe(1);
    for (let n = 2; n <= 8; n++) {
      expect(partialAmp(n)).toBeCloseTo(1 / Math.pow(n, 1.4), 12);
      expect(partialAmp(n)).toBeLessThan(partialAmp(n - 1));
    }
  });
});
