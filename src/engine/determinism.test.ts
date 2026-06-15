import { describe, expect, it } from 'vitest';
import { paramsFor } from '../mappings';
import { setSeed, startLogging, stopLogging } from '../rand';
import type { Decision } from '../rand';
import { decode } from '../score';
import {
  driftInterval,
  driftStep,
  eventTick,
  loopInterval,
  padTick,
  partialLfo,
  regionTick,
  textureTick,
} from './decisions';

/**
 * THE acceptance test: the performance is a pure function of the score.
 * For a fixed score code, the first 50 decisions must be identical across
 * two completely separate runs — same values, same streams, same ticks.
 */

const FIXED_CODE = 'TEND-E20-C-KAMO-41';

function performRun(code: string): { log: Decision[]; outputs: unknown[] } {
  const decoded = decode(code);
  if (!decoded.ok) throw new Error('fixture code failed to decode');
  const params = paramsFor(decoded.score);
  setSeed(decoded.score.seed);
  startLogging();

  const outputs: unknown[] = [];

  // Init draws — what the engine does when a performance starts.
  for (const layer of ['pad', 'events', 'texture']) outputs.push(loopInterval(layer));
  for (const scalar of ['density', 'register', 'brightness']) {
    outputs.push(driftInterval(scalar));
  }
  for (let p = 1; p <= 8; p++) outputs.push(partialLfo('drone', 0, p));

  // The running loops, interleaved the way Transport would fire them.
  let region = 0;
  let voicing: readonly number[] = [];
  let sinceEvent = 99;
  for (let tick = 1; tick <= 12; tick++) {
    region = regionTick(params, tick, region);
    outputs.push(region);
    const pad = padTick(params, region, voicing, tick);
    outputs.push(pad);
    if (pad !== null && pad !== 'silence') voicing = pad.freqs;
    const ev = eventTick(params, region, tick, sinceEvent);
    outputs.push(ev);
    sinceEvent = ev !== null && ev !== 'silence' ? 0 : sinceEvent + 17;
    outputs.push(textureTick(params, tick));
    for (const scalar of ['density', 'register', 'brightness']) {
      outputs.push(driftStep(scalar, tick));
    }
  }

  return { log: stopLogging(), outputs };
}

describe('determinism', () => {
  it('fixed code → identical first-50-decision log across two runs', () => {
    // append the real checksum so the fixture exercises decode() fully
    const decoded = decode(FIXED_CODE + checksumFor(FIXED_CODE));
    expect(decoded.ok).toBe(true);

    const runA = performRun(FIXED_CODE + checksumFor(FIXED_CODE));
    const runB = performRun(FIXED_CODE + checksumFor(FIXED_CODE));

    expect(runA.log.length).toBeGreaterThanOrEqual(50);
    expect(runA.log.slice(0, 50)).toEqual(runB.log.slice(0, 50));
    // and not just the raw draws — every derived musical decision too
    expect(runA.outputs).toEqual(runB.outputs);
    // the whole log, while we are here
    expect(runA.log).toEqual(runB.log);
  });

  it('a different seed diverges immediately', () => {
    const a = performRun(withSeed('KAMO-41'));
    const b = performRun(withSeed('KAMO-42'));
    expect(a.log.slice(0, 50)).not.toEqual(b.log.slice(0, 50));
  });

  it('decisions are order-independent: pad tick 5 is pad tick 5 regardless of when asked', () => {
    const decoded = decode(withSeed('HOSHI-7'));
    if (!decoded.ok) throw new Error('bad fixture');
    const params = paramsFor(decoded.score);
    setSeed(decoded.score.seed);
    const early = padTick(params, 0, [], 5);
    setSeed(decoded.score.seed);
    for (let t = 1; t < 5; t++) padTick(params, 0, [], t); // burn other ticks first
    const late = padTick(params, 0, [], 5);
    expect(late).toEqual(early);
  });
});

/* helpers — build a valid full code for arbitrary seeds */
import { checksumChar } from '../score';

function checksumFor(dashed: string): string {
  return checksumChar(dashed.toUpperCase().replace(/[\s-]/g, ''));
}

function withSeed(seed: string): string {
  const [word, num] = seed.split('-');
  const body = `TEND-E20-C-${word}-${num}`;
  return body + checksumFor(body);
}
