/**
 * Field.tsx — one full-viewport canvas behind every screen. Not an animation
 * you watch: lighting. A near-black room whose dark has weather — a flat base,
 * one soft pool of less-dark, and a static grain that makes the dark read as
 * material (and dithers the pool so it can't band).
 *
 * It persists across screen transitions (that continuity is the point), leans
 * toward the chosen intention's temperature during intake, recedes while
 * performing (the ring carries), and empties to true black with the ending.
 *
 * Timebase is performance.now() (wall clock), NOT Tone.Transport — the field
 * is ambient room-light, so it keeps breathing even when Transport is paused.
 * Every value is a pure function of `now`; eased transitions are pure
 * functions of (transition-start, now), so dropped frames never desync.
 */

import { useEffect, useRef } from 'react';
import { VISUALS } from '../mappings';
import { entropyUint32 } from '../rand';
import type { HourBand, Intention } from '../score';
import type { Performance } from '../engine/scheduler';
import {
  characterFor,
  clamp01,
  fieldConfig,
  fieldDrift,
  fieldTide,
  grainGlobalAlpha,
  grainSpecks,
  grainTileIndex,
  lerp,
  poolColor,
  smooth,
} from './field';
import type { FieldCharacter, RGB } from './field';

export type FieldPhase =
  | 'home'
  | 'intake'
  | 'threshold'
  | 'performing'
  | 'closing'
  | 'card'
  | 'scores'
  | 'about';

type Props = {
  phase: FieldPhase;
  intention: Intention | null;
  hourBand: HourBand;
  perf: Performance | null;
};

function parseColor(input: string): RGB {
  const s = input.trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/\d+/g);
  if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
  return [16, 16, 19]; // --bg fallback
}

export function Field(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  // reduced-motion only: the grain-aware static draw, shared with the
  // re-tint effect below so a character change repaints (still with grain)
  const drawStaticRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const f = VISUALS.field;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // The one nondeterministic input — spread into tide + grain by plain math.
    const entropy = entropyUint32();
    const cfg = fieldConfig(entropy);

    // Several noise tiles, built once and cycled each frame so the grain
    // shimmers like film/TV static. Painted via ImageData (fast) — each tile
    // is an independent PRNG stream so the cycle doesn't pulse.
    const [tr, tg, tb] = f.grainTint;
    const size = f.grainTileSize;
    const patterns: (CanvasPattern | null)[] = [];
    for (let t = 0; t < f.grainTileCount; t++) {
      const tile = document.createElement('canvas');
      tile.width = size;
      tile.height = size;
      const tctx = tile.getContext('2d');
      if (tctx) {
        const img = tctx.createImageData(size, size);
        for (const s of grainSpecks(entropy, t)) {
          const o = (s.y * size + s.x) * 4;
          img.data[o] = tr;
          img.data[o + 1] = tg;
          img.data[o + 2] = tb;
          img.data[o + 3] = Math.round(s.a * 255);
        }
        tctx.putImageData(img, 0, 0);
      }
      patterns.push(ctx.createPattern(tile, 'repeat'));
    }

    let W = 0;
    let H = 0;
    const mountNow = performance.now() / 1000;

    // Eased transitions — each re-aimed when its target changes, then read as
    // a pure function of (start, now). No per-frame accumulation.
    const phaseCeiling = (phase: FieldPhase, band: HourBand): number =>
      (f.ceiling[phase] ?? 1) * (f.hourBandCeiling[band] ?? 1);

    let charFrom = characterFor(props.intention);
    let charTo = charFrom;
    let charStart = mountNow;
    let ceilFrom = 0; // app opens from black
    let ceilTo = phaseCeiling(props.phase, props.hourBand);
    let ceilStart = mountNow;
    let ceilTau: number = f.fadeUpS;
    let condFrom = props.phase === 'performing' || props.phase === 'closing' ? 1 : 0;
    let condTo = condFrom;
    let condStart = mountNow;
    let lastIntention: Intention | null = props.intention;
    let lastPhase: FieldPhase = props.phase;

    const lerpChar = (a: FieldCharacter, b: FieldCharacter, t: number): FieldCharacter => ({
      temp: [
        lerp(a.temp[0], b.temp[0], t),
        lerp(a.temp[1], b.temp[1], t),
        lerp(a.temp[2], b.temp[2], t),
      ],
      lift: lerp(a.lift, b.lift, t),
      speed: lerp(a.speed, b.speed, t),
      grain: lerp(a.grain, b.grain, t),
    });
    const curChar = (now: number): FieldCharacter =>
      lerpChar(charFrom, charTo, smooth(clamp01((now - charStart) / f.easeTauS)));
    const curCeil = (now: number): number =>
      lerp(ceilFrom, ceilTo, smooth(clamp01((now - ceilStart) / ceilTau)));
    const curCond = (now: number): number =>
      lerp(condFrom, condTo, smooth(clamp01((now - condStart) / f.easeTauS)));

    /** Paint one frame from already-resolved values. */
    const drawWith = (
      char: FieldCharacter,
      ceiling: number,
      cond: number,
      tide: number,
      drift: { x: number; y: number },
      now: number,
    ) => {
      if (!ctx || W <= 0) return;
      const bg = parseColor(getComputedStyle(canvas).getPropertyValue('--bg'));

      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
      ctx.fillRect(0, 0, W, H);

      // the pool — a soft radial of less-dark, no traceable edge
      const col = poolColor(bg, char, tide, ceiling);
      const maxDim = Math.max(W, H);
      const radiusFrac =
        lerp(f.poolRadiusFrac, f.performRadiusFrac, cond) + tide * f.poolRadiusTide * ceiling;
      const radius = Math.max(1, radiusFrac * maxDim);
      const driftScale = ceiling * (1 - cond * 0.8); // condenses + stills as it recedes
      const cx = (0.5 + drift.x * f.poolDriftFrac.x * driftScale) * W;
      const cy = (lerp(f.poolCenterY, f.performCenterY, cond) + drift.y * f.poolDriftFrac.y * driftScale) * H;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgb(${col[0]},${col[1]},${col[2]})`);
      grad.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // the grain — shimmering static; tile cycles by time × the room's
      // speed, amount set by the room's grain. Material + dither + motion.
      const pattern = patterns[grainTileIndex(now, f.grainShimmerHz * char.speed, patterns.length)];
      if (pattern) {
        ctx.globalAlpha = grainGlobalAlpha(tide, char.grain, ceiling);
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    };

    /** Reduced motion: one static frame at targets, mid-tide, no drift. */
    const drawStatic = () => {
      const p = propsRef.current;
      const char = characterFor(p.intention);
      let ceiling = phaseCeiling(p.phase, p.hourBand);
      if (p.phase === 'closing' && p.perf) ceiling *= clamp01(p.perf.visualState().taper);
      const cond = p.phase === 'performing' || p.phase === 'closing' ? 1 : 0;
      drawWith(char, ceiling, cond, 0, { x: 0, y: 0 }, 0);
    };

    /** One animated frame: re-aim transitions from the latest props, then
     *  draw at wall-clock `now`. Shared by the rAF loop and resize() so the
     *  field paints immediately on size changes, not only on the next tick. */
    const step = (now: number) => {
      const p = propsRef.current;
      if (p.intention !== lastIntention) {
        charFrom = curChar(now);
        charTo = characterFor(p.intention);
        charStart = now;
        lastIntention = p.intention;
      }
      if (p.phase !== lastPhase) {
        ceilFrom = curCeil(now);
        ceilTo = phaseCeiling(p.phase, p.hourBand);
        ceilStart = now;
        ceilTau = p.phase === 'home' ? f.homeReturnTauS : f.easeTauS;
        condFrom = curCond(now);
        condTo = p.phase === 'performing' || p.phase === 'closing' ? 1 : 0;
        condStart = now;
        lastPhase = p.phase;
      }
      const char = curChar(now);
      // the initial ceiling transition (from 0 over fadeUpS) is the app-open
      // fade from black; later transitions use the phase taus
      let ceiling = curCeil(now);
      // ending: empty the room in step with the live density taper
      if (p.phase === 'closing' && p.perf) ceiling *= clamp01(p.perf.visualState().taper);
      drawWith(char, ceiling, curCond(now), fieldTide(cfg, now, char.speed), fieldDrift(cfg, now, char.speed), now);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce) drawStatic();
      else step(performance.now() / 1000);
    };

    resize();
    window.addEventListener('resize', resize);

    if (reduce) {
      // no drift; the prop-change effect below repaints this static frame
      drawStaticRef.current = drawStatic;
      return () => {
        window.removeEventListener('resize', resize);
        drawStaticRef.current = null;
      };
    }

    const skip = Math.max(1, Math.round(60 / f.fps));
    let frame = 0;
    let raf = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return; // pause entirely when the tab is hidden
      if (frame++ % skip !== 0) return;
      step(performance.now() / 1000);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
    // run once: the rAF loop reads the latest props through propsRef
  }, []);

  // Reduced motion: a fast quiet re-tint when the room's character changes
  // (reuses the grain-aware static draw). A no-op when motion is allowed.
  useEffect(() => {
    drawStaticRef.current?.();
  }, [props.phase, props.intention, props.hourBand, props.perf]);

  return <canvas ref={canvasRef} className="field" aria-hidden="true" />;
}
