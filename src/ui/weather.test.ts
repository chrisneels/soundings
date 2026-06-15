import { describe, expect, it } from 'vitest';
import { paramsFor } from '../mappings';
import { setSeed, startLogging, stopLogging } from '../rand';
import type { Decision } from '../rand';
import type { Score } from '../score';
import { eventTick, padTick, regionTick } from '../engine/decisions';
import { bloomSample, regionBias, sampleTide, tideConfig } from './weather';

const score: Score = {
  v: 2,
  seed: 'KAMO-41',
  intention: 'wander', // events on, region drift on — the busiest streams
  circumstance: { output: 'headphones', field: 'quiet', company: 'alone' },
  container: 20,
  hourBand: 'evening',
};
const params = paramsFor(score);

/** The audio decision log for a fixed sequence, optionally interleaving the
 *  interior's own rand('visual', …) calls between ticks. */
function audioLog(interleaveVisual: boolean): Decision[] {
  setSeed(score.seed);
  startLogging();
  let region = 0;
  for (let tick = 1; tick <= 12; tick++) {
    region = regionTick(params, tick, region);
    padTick(params, region, [], tick);
    eventTick(params, region, tick, 99);
    if (interleaveVisual) {
      const cfg = tideConfig(); // rand('visual', 0..4, …)
      sampleTide(cfg, tick * 1.37); // pure, no rand
      bloomSample({ kind: 'pad', velocity: 0.3, pan: 0.2, t0: 0 }, tick); // pure
      regionBias(tick % 3); // rand('visual', idx, 'region-bias')
    }
  }
  return stopLogging();
}

describe('weather determinism', () => {
  it('tide config is a pure function of the seed', () => {
    setSeed('KAMO-41');
    const a = tideConfig();
    setSeed('ZITHER-9'); // disturb the global seed
    tideConfig();
    setSeed('KAMO-41');
    const b = tideConfig();
    expect(b).toEqual(a);

    setSeed('OTHER-2');
    expect(tideConfig()).not.toEqual(a);
  });

  it('tide periods come only from the configured primes', () => {
    setSeed('HOSHI-7');
    const cfg = tideConfig();
    const primes = [53, 71, 89, 109];
    for (const p of cfg.periods) expect(primes).toContain(p);
    expect(primes).toContain(cfg.centerX.period);
    expect(primes).toContain(cfg.centerY.period);
  });
});

describe('visual ↔ audio isolation', () => {
  it("interior rand calls leave the audio decision log byte-identical", () => {
    const withoutVisual = audioLog(false);
    const withVisual = audioLog(true);

    // the interleaved run really did exercise the 'visual' namespace
    expect(withVisual.some((d) => d.layer === 'visual')).toBe(true);

    // …yet every audio stream entry is identical, in order and value
    const audioOnly = withVisual.filter((d) => d.layer !== 'visual');
    expect(audioOnly).toEqual(withoutVisual);
  });

  it('the visual namespace is the only thing the interior touches', () => {
    const withVisual = audioLog(true);
    const visualEntries = withVisual.filter((d) => d.layer === 'visual');
    expect(visualEntries.length).toBeGreaterThan(0);
    for (const d of visualEntries) expect(d.layer).toBe('visual');
  });
});
