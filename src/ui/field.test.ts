import { describe, expect, it } from 'vitest';
import { VISUALS } from '../mappings';
import {
  characterFor,
  fieldConfig,
  fieldTide,
  grainGlobalAlpha,
  grainSpecks,
  grainTileIndex,
  mulberry32,
  poolColor,
} from './field';
import type { RGB } from './field';

const BG: RGB = [16, 16, 19]; // #101013

describe('field — pure maths', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    // a different seed diverges
    expect(mulberry32(12346)()).not.toBe(mulberry32(12345)());
  });

  it('tide periods come only from the configured primes; tide stays in [-1,1]', () => {
    const cfg = fieldConfig(0xabcdef);
    for (const p of cfg.periods) expect(VISUALS.field.tidePeriodsS).toContain(p);
    for (let s = 0; s < 400; s += 7) {
      const v = fieldTide(cfg, s, 1);
      expect(v).toBeGreaterThanOrEqual(-1.0001);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
  });

  it('characterFor returns the table value, neutral when no intention', () => {
    expect(characterFor('wander').temp).toEqual([...VISUALS.field.character.wander.temp]);
    expect(characterFor(null)).toEqual(VISUALS.field.neutral);
    // returns a copy, not the shared object
    const original = VISUALS.field.character.settle.temp[0];
    const c = characterFor('settle');
    c.temp[0] = 999;
    expect(characterFor('settle').temp[0]).toBe(original);
  });

  it('poolColor only ever adds light, and never exceeds maxPixel', () => {
    const max = VISUALS.field.maxPixel;
    for (const intention of ['settle', 'rest', 'wander', 'tend'] as const) {
      const ch = characterFor(intention);
      for (const tide of [-1, 0, 1]) {
        for (const ceiling of [0, 0.4, 1]) {
          const c = poolColor(BG, ch, tide, ceiling);
          for (let i = 0; i < 3; i++) {
            expect(c[i]).toBeGreaterThanOrEqual(BG[i]); // never darker than bg
            expect(c[i]).toBeLessThanOrEqual(max[i]); // never past the ceiling
          }
        }
      }
    }
  });

  it('ceiling 0 yields pure bg; at full lift the delta is temp×lift', () => {
    const settle = characterFor('settle');
    expect(poolColor(BG, settle, 0, 0)).toEqual(BG);
    // tide 0 → liftFactor 1, ceiling 1: delta should equal temp×lift
    // (settle sits under maxPixel, so no clamping eats the assertion)
    const lit = poolColor(BG, settle, 0, 1);
    for (let i = 0; i < 3; i++) {
      expect(lit[i] - BG[i]).toBeCloseTo(settle.temp[i] * settle.lift, 5);
    }
  });

  it('temperature is a lean, not a hue — wander reads cool (b>r), tend warm (r>b)', () => {
    const wander = poolColor(BG, characterFor('wander'), 0, 1);
    const tend = poolColor(BG, characterFor('tend'), 0, 1);
    expect(wander[2] - BG[2]).toBeGreaterThan(wander[0] - BG[0]); // bluer
    expect(tend[0] - BG[0]).toBeGreaterThan(tend[2] - BG[2]); // warmer
  });

  it('grain alpha scales with ceiling and the tide, and vanishes at the ending', () => {
    expect(grainGlobalAlpha(0, 0.3, 0)).toBe(0); // ceiling 0 → grain gone
    const a = grainGlobalAlpha(0, 0.3, 1);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(1);
    expect(grainGlobalAlpha(0, 0.3, 0.5)).toBeCloseTo(a * 0.5, 6); // linear in ceiling
    expect(grainGlobalAlpha(1, 0.3, 1)).toBeGreaterThan(grainGlobalAlpha(-1, 0.3, 1)); // rides tide
  });

  it('grain specks are deterministic and fit the tile', () => {
    const a = grainSpecks(777);
    const b = grainSpecks(777);
    expect(a).toEqual(b);
    expect(a.length).toBe(
      Math.floor(VISUALS.field.grainTileSize ** 2 * VISUALS.field.grainDensity),
    );
    for (const s of a) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(VISUALS.field.grainTileSize);
      expect(s.a).toBeGreaterThanOrEqual(VISUALS.field.grainAlpha.min);
      expect(s.a).toBeLessThanOrEqual(VISUALS.field.grainAlpha.max);
    }
  });

  it('grain tiles differ per index (so the cycle shimmers, not pulses)', () => {
    expect(grainSpecks(777, 0)).not.toEqual(grainSpecks(777, 1));
    expect(grainSpecks(777, 2)).toEqual(grainSpecks(777, 2)); // still deterministic
  });

  it('grainTileIndex cycles through the tiles over time', () => {
    const count = 16;
    const hz = 14;
    expect(grainTileIndex(0, hz, count)).toBe(0);
    expect(grainTileIndex(1 / hz, hz, count)).toBe(1); // one tile per 1/hz
    expect(grainTileIndex(100, hz, count)).toBeGreaterThanOrEqual(0);
    expect(grainTileIndex(100, hz, count)).toBeLessThan(count);
    expect(grainTileIndex(5, hz, 1)).toBe(0); // a single tile never indexes out
  });
});
