/**
 * interior.tsx — the weather inside the ring.
 *
 * A canvas clipped to a circle, rendering tide + blooms + a faint region
 * lean, composited in monochrome at very low alpha. It is weather, not a
 * visualiser: nothing here responds faster than the bloom attack (~1.5s),
 * and a watcher cannot read the music from it.
 *
 * The picture is a pure function of (score seed, Tone.Transport.seconds,
 * onsets so far) — the maths lives in weather.ts. This file only draws it
 * and owns the rAF loop, the canvas sizing, and the onset subscription.
 *
 * Clock discipline: t is always Tone.Transport.seconds — never the wall
 * clock, never the rAF timestamp. The rAF timestamp is used for nothing;
 * even the redraw throttle compares Transport time, so dropped or
 * background-throttled frames recompute the correct picture on resume.
 */

import { useEffect, useRef } from 'react';
import * as Tone from 'tone';
import { VISUALS } from '../mappings';
import { setSeed } from '../rand';
import type { Score } from '../score';
import type { Performance, VisualState } from '../engine/scheduler';
import {
  bloomDuration,
  bloomSample,
  clamp01,
  lerp,
  regionBias,
  sampleTide,
  smooth,
  tideConfig,
} from './weather';
import type { Bloom } from './weather';
import { characterFor } from './field';

type RGB = { r: number; g: number; b: number };

/** Parse a CSS colour token (#rgb, #rrggbb, or rgb(...)) to channels, so a
 *  palette swap in tokens.css follows automatically at render time. */
function parseColor(input: string): RGB {
  const s = input.trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const m = s.match(/\d+/g);
  if (m && m.length >= 3) return { r: +m[0], g: +m[1], b: +m[2] };
  return { r: 138, g: 147, b: 160 }; // --accent fallback (#8a93a0)
}

const TAU = Math.PI * 2;

export function Interior({
  score,
  perf,
}: {
  score: Score;
  perf: Performance | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The performance already set this; reassert it so the tide config and
    // region leans hash off the right seed even if mounted standalone.
    setSeed(score.seed);
    const cfg = tideConfig();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const blooms: Bloom[] = [];
    // eased region lean — pure given (from, to, changeT, t); no accumulator
    const region = { index: 0, fromBias: 0, toBias: 0, changeT: 0 };
    let cssSize = 0;

    const fallback: VisualState = {
      density: 0.3,
      brightness: 0.3,
      regionIndex: 0,
      ending: false,
      taper: 1,
    };

    // The ring shares the field's per-intention temperature lean (the shared
    // VISUALS character), so the two read as one light condensed into the
    // ring. A small lean on the glow colour — never a nameable hue.
    const temp = characterFor(score.intention).temp;
    const lean = (base: number, d: number) => Math.min(255, Math.max(0, base + d * 0.6));

    const draw = (t: number) => {
      const S = cssSize;
      if (S <= 0 || !ctx) return;
      const vs = perf?.visualState() ?? fallback;
      const a0 = parseColor(getComputedStyle(canvas).getPropertyValue('--accent'));
      const c = { r: lean(a0.r, temp[0]), g: lean(a0.g, temp[1]), b: lean(a0.b, temp[2]) };
      const rgba = (a: number) => `rgba(${c.r},${c.g},${c.b},${a})`;
      const R = S / 2;
      const innerR = R * 0.97;

      ctx.clearRect(0, 0, S, S);
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, innerR, 0, TAU);
      ctx.clip();

      // --- Tide: the continuous ground. Amplitude follows live density
      //     (Rest ≈ still), peak luminance follows live brightness. ---
      const tide = sampleTide(cfg, t);
      const ampl = smooth(
        (vs.density - VISUALS.tideStillDensity) /
          (VISUALS.tideAliveDensity - VISUALS.tideStillDensity),
      );
      const centered = 0.5 + (tide.level - 0.5) * ampl;
      const discR =
        innerR * lerp(VISUALS.tideRadius.min, VISUALS.tideRadius.max, centered);
      const offMax = VISUALS.tideCenterOffset * S * ampl;
      const cx = R + tide.cx * offMax;
      const cy = R + tide.cy * offMax;
      const bright = lerp(VISUALS.tideBrightnessFloor, 1, vs.brightness);
      const bias = reduce
        ? 0
        : lerp(
            region.fromBias,
            region.toBias,
            clamp01((t - region.changeT) / VISUALS.regionEaseS),
          );
      let peak = VISUALS.tidePeakAlpha * bright + bias;
      peak = Math.max(0, Math.min(peak, VISUALS.tidePeakAlpha + VISUALS.regionBias));

      ctx.globalCompositeOperation = 'source-over';
      const tg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(discR, 1));
      tg.addColorStop(0, rgba(peak));
      tg.addColorStop(1, rgba(0));
      ctx.fillStyle = tg;
      ctx.fillRect(0, 0, S, S);

      // --- Blooms: one soft additive circle per onset. ---
      if (!reduce) {
        ctx.globalCompositeOperation = 'lighter';
        for (const b of blooms) {
          const bs = bloomSample(b, t);
          if (!bs) continue;
          const bx = R + bs.panX * innerR;
          const br = Math.max(innerR * bs.radius, 1);
          const bg = ctx.createRadialGradient(bx, R, 0, bx, R, br);
          bg.addColorStop(0, rgba(bs.alpha));
          bg.addColorStop(1, rgba(0));
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, S, S);
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.restore();
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      cssSize = rect.width || canvas.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap for cheap fill
      canvas.width = Math.max(1, Math.round(cssSize * dpr));
      canvas.height = Math.max(1, Math.round(cssSize * dpr));
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // a resized backing store is blank — repaint immediately at the
      // current transport time (t=0 when reduced or not yet started)
      draw(reduce ? 0 : Tone.Transport.seconds);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Reduced motion: one static frame (t=0 tide, no blooms), ring frozen
    // by CSS. No loop, no subscription.
    if (reduce) {
      draw(0);
      return () => ro.disconnect();
    }

    const unsub =
      perf?.onSound((e) => {
        if (blooms.length >= VISUALS.bloom.maxConcurrent) blooms.shift(); // drop oldest
        blooms.push({ kind: e.kind, velocity: e.velocity, pan: e.pan, t0: Tone.Transport.seconds });
      }) ?? (() => undefined);

    // Frame-skip throttle: draw every Nth rAF for ~VISUALS.fps. The frame
    // counter only decides WHEN to draw; the picture's content is always a
    // function of Transport.seconds, so dropped or background-throttled
    // frames simply recompute the correct picture on resume.
    const skip = Math.max(1, Math.round(60 / VISUALS.fps));
    let frame = 0;
    let raf = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (frame++ % skip !== 0) return;
      const t = Tone.Transport.seconds;

      // region lean: re-aim toward the new region's bias when it changes
      const idx = perf?.visualState().regionIndex ?? 0;
      if (idx !== region.index) {
        region.fromBias = lerp(
          region.fromBias,
          region.toBias,
          clamp01((t - region.changeT) / VISUALS.regionEaseS),
        );
        region.toBias = regionBias(idx);
        region.changeT = t;
        region.index = idx;
      }

      // cull finished blooms
      for (let i = blooms.length - 1; i >= 0; i--) {
        if (t - blooms[i].t0 > bloomDuration(blooms[i])) blooms.splice(i, 1);
      }

      draw(t);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsub();
    };
  }, [score.seed, perf]);

  return <canvas ref={canvasRef} className="breath-interior" aria-hidden="true" />;
}
