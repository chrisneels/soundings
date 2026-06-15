import { describe, expect, it } from 'vitest';
import { pick, pickWeighted, rand, randInt, randRange, setSeed } from './rand';

describe('rand', () => {
  it('is deterministic: same (seed, layer, tick, salt) → same value', () => {
    setSeed('KAMO-41');
    const a = rand('pad', 7, 'ratio');
    setSeed('OTHER-1');
    rand('pad', 7, 'ratio'); // disturb nothing — counter-based, no state
    setSeed('KAMO-41');
    const b = rand('pad', 7, 'ratio');
    expect(a).toBe(b);
  });

  it('is order-independent (counter-based): call order never matters', () => {
    setSeed('KAMO-41');
    const a1 = rand('drone', 3);
    const a2 = rand('pad', 9);
    setSeed('KAMO-41');
    const b2 = rand('pad', 9);
    const b1 = rand('drone', 3);
    expect(a1).toBe(b1);
    expect(a2).toBe(b2);
  });

  it('separates streams by seed, layer, tick, and salt', () => {
    setSeed('KAMO-41');
    const base = rand('pad', 7, 'x');
    expect(rand('pad', 8, 'x')).not.toBe(base);
    expect(rand('pads', 7, 'x')).not.toBe(base);
    expect(rand('pad', 7, 'y')).not.toBe(base);
    setSeed('KAMO-42');
    expect(rand('pad', 7, 'x')).not.toBe(base);
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    setSeed('SPREAD-9');
    let sum = 0;
    const buckets = new Array(10).fill(0);
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const v = rand('u', i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
      buckets[Math.floor(v * 10)]++;
    }
    expect(sum / n).toBeGreaterThan(0.47);
    expect(sum / n).toBeLessThan(0.53);
    for (const b of buckets) expect(b).toBeGreaterThan(n / 10 / 2);
  });

  it('helpers stay in range and deterministic', () => {
    setSeed('HELP-3');
    for (let i = 0; i < 200; i++) {
      const k = randInt('h', i, 7);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(7);
      const r = randRange('h', i, 11, 31, 'interval');
      expect(r).toBeGreaterThanOrEqual(11);
      expect(r).toBeLessThan(31);
    }
    expect(pick('h', 5, ['a', 'b', 'c'])).toBe(pick('h', 5, ['a', 'b', 'c']));
    const w = pickWeighted('h', 5, [0, 0, 1]);
    expect(w).toBe(2);
    expect(pickWeighted('h', 5, [0, 0, 0])).toBe(0);
  });
});
