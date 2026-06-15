/**
 * scheduler.ts — one Performance: a score, performed.
 *
 * Owns the master chain, the five layers, the drift walks, region drift,
 * the two controls (More space, Close), and the arc from threshold to
 * card. All timing lives on Tone.Transport (worker-clocked, reliable in
 * unfocused tabs); all choice lives in decisions.ts over rand().
 *
 * Audio exists only after begin(), which is only called from a user
 * gesture — no sound before consent.
 */

import * as Tone from 'tone';
import type { Params } from '../mappings';
import {
  DRIFT_CLAMP,
  DRIFTING_SCALARS,
  MORE_SPACE_FACTOR,
  MORE_SPACE_FLOOR,
  THRESHOLD_S,
  brightnessToHz,
  paramsFor,
} from '../mappings';
import type { DriftingScalar } from '../mappings';
import { setSeed } from '../rand';
import type { Score } from '../score';
import { driftInterval, driftStep, regionTick } from './decisions';
import { Drone, Events, PadCloud, Pulse, Texture } from './layers';
import type { LayerCtx, SoundEvent } from './layers';
import { Bell } from './voices';
import { FULL_ENDING, QUICK_ENDING, composeEnding } from './ending';
import type { EndingProfile } from './ending';

export type { SoundEvent } from './layers';

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export type PerformanceCallbacks = {
  /** The composed ending has begun (Close pressed, or the container's
   *  time arrived) — controls should withdraw. */
  onEnding?: () => void;
  /** The silence has completed; elapsedS is the full performed duration. */
  onClosed: (elapsedS: number) => void;
};

/** What the interior weather reads each frame — the live (drifted,
 *  tapered) scalars it responds to, plus the active region. `taper` is 1
 *  normally and eases to 0 across the ending (the app-wide field reads it
 *  to empty the room in step with the music). */
export type VisualState = {
  density: number;
  brightness: number;
  regionIndex: number;
  ending: boolean;
  taper: number;
};

export class Performance {
  private readonly base: Params;
  private spaceFactor = 1;
  private readonly driftOffsets = new Map<DriftingScalar, number>();
  private regionIndex = 0;
  private regionTickCount = 0;
  private endingAtS: number | null = null;
  private endingProfile: EndingProfile | null = null;
  private scheduledEndingId: number | null = null;
  private begun = false;
  private disposed = false;
  /** At most one interior listens at a time (one performance, one screen). */
  private soundListener: ((e: SoundEvent) => void) | null = null;

  // audio graph
  private bus!: Tone.Gain;
  private thresholdGain!: Tone.Gain;
  private reverb!: Tone.Reverb;
  private filter!: Tone.Filter;
  private masterTrim!: Tone.Gain;
  private limiter!: Tone.Limiter;
  private bellBus!: Tone.Gain;
  private bell!: Bell;
  private drone!: Drone;
  private pads!: PadCloud;
  private events!: Events;
  private texture!: Texture;
  private pulse: Pulse | null = null;

  constructor(
    readonly score: Score,
    private readonly callbacks: PerformanceCallbacks,
  ) {
    this.base = paramsFor(score);
    for (const s of DRIFTING_SCALARS) this.driftOffsets.set(s, 0);
  }

  /* ---------------------------------------------------------------- *
   * Live parameters: base + drift (clamped ±0.15 of base, then 0–1)
   * + More space + the ending taper. Pure read; layers call this every
   * tick.
   * ---------------------------------------------------------------- */

  private taper(): number {
    if (this.endingAtS === null || this.endingProfile === null) return 1;
    const into = Tone.Transport.seconds - this.endingAtS;
    return Math.max(0, 1 - into / this.endingProfile.taperS);
  }

  private live(): Params {
    const p: Params = { ...this.base };
    for (const s of DRIFTING_SCALARS) {
      p[s] = clamp01(this.base[s] + (this.driftOffsets.get(s) ?? 0));
    }
    p.density = Math.max(
      MORE_SPACE_FLOOR,
      p.density * this.spaceFactor * this.taper(),
    );
    return p;
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle.
   * ---------------------------------------------------------------- */

  async begin(): Promise<void> {
    if (this.begun) return;
    this.begun = true;

    setSeed(this.score.seed);
    await Tone.start();

    // Master chain: layers → threshold fade → Reverb(10 s, wet .45)
    // → lowpass (brightness) → trim (others-nearby −6 dB) → Limiter(−1).
    this.bus = new Tone.Gain(1);
    this.thresholdGain = new Tone.Gain(0);
    this.reverb = new Tone.Reverb({ decay: 10, wet: 0.45 });
    this.filter = new Tone.Filter({
      type: 'lowpass',
      frequency: brightnessToHz(this.base.brightness),
    });
    this.masterTrim = new Tone.Gain(Tone.dbToGain(this.base.masterDb));
    this.limiter = new Tone.Limiter(-1);
    this.bus.chain(
      this.thresholdGain,
      this.reverb,
      this.filter,
      this.masterTrim,
      this.limiter,
    );
    this.limiter.toDestination();
    await this.reverb.ready;

    // The threshold bell bypasses the 30 s fade (it IS the beginning),
    // but still passes through reverb, filter, trim, limiter.
    this.bellBus = new Tone.Gain(0.9).connect(this.reverb);
    this.bell = new Bell(this.bellBus);

    const ctx: LayerCtx = {
      live: () => this.live(),
      region: () => this.regionIndex,
      ending: () => this.endingAtS !== null,
      onSound: (e) => this.soundListener?.(e),
      bus: this.bus,
    };

    this.drone = new Drone(ctx);
    this.pads = new PadCloud(ctx);
    this.events = new Events(ctx);
    this.texture = new Texture(ctx);
    this.pulse = this.base.pulse > 0 ? new Pulse(ctx) : null;

    Tone.Transport.start();
    const now = Tone.now();

    // Threshold: fade from true silence; one bell at the start.
    this.drone.start();
    this.texture.start();
    this.pulse?.start();
    this.thresholdGain.gain.setValueAtTime(0, now);
    this.thresholdGain.gain.linearRampToValueAtTime(1, now + THRESHOLD_S);
    this.bell.strike(this.base.tonicHz * 2, now + 0.4, 0.4);
    // Bloom the opening bell — scheduled on the transport so it lands ~when
    // the bell sounds AND after the interior has mounted and subscribed
    // (begin() resolves, the screen renders, then this fires at +0.4s).
    Tone.Transport.scheduleOnce(() => {
      this.soundListener?.({ kind: 'bell', velocity: 0.4, pan: 0 });
    }, 0.4);

    // Layers arrive inside the fade, offset so first events land late in it.
    this.pads.start(10);
    this.events.start(17);

    // Region drift: every 31 s, with probability regionDrift, the active
    // weights shift. Stops once the ending begins.
    Tone.Transport.scheduleRepeat(() => {
      this.regionTickCount += 1;
      if (this.endingAtS !== null) return;
      this.regionIndex = regionTick(this.live(), this.regionTickCount, this.regionIndex);
    }, 31, '+31');

    // Scalar drift: each scalar walks ±0.05 on its own seeded clock
    // (20–40 s), clamped to ±0.15 of base.
    for (const scalar of DRIFTING_SCALARS) {
      const interval = driftInterval(scalar);
      let tick = 0;
      Tone.Transport.scheduleRepeat(
        (time) => {
          tick += 1;
          if (this.endingAtS !== null) return;
          const prev = this.driftOffsets.get(scalar) ?? 0;
          const next = Math.max(
            -DRIFT_CLAMP,
            Math.min(DRIFT_CLAMP, prev + driftStep(scalar, tick)),
          );
          this.driftOffsets.set(scalar, next);
          if (scalar === 'brightness') {
            const hz = brightnessToHz(this.live().brightness);
            const f = this.filter.frequency;
            f.cancelScheduledValues(time);
            f.setValueAtTime(Math.max(f.value as number, 1), time);
            f.exponentialRampToValueAtTime(hz, time + 5);
          }
        },
        interval,
        `+${interval}`,
      );
    }

    // Bounded sessions end themselves with the full composed ending;
    // open sessions end on Close.
    if (this.score.container !== 'open') {
      const startAt = this.score.container * 60 - FULL_ENDING.totalS;
      this.scheduledEndingId = Tone.Transport.scheduleOnce(() => {
        this.startEnding(FULL_ENDING);
      }, Math.max(startAt, THRESHOLD_S));
    }
  }

  /** Density −15% per press, floored — never to zero: the floor keeps a
   *  trickle of arrivals so More space stays "more", not "off". */
  moreSpace(): void {
    this.spaceFactor *= MORE_SPACE_FACTOR;
  }

  /** Register the interior's onset listener. Returns an unsubscribe. The
   *  engine runs identically whether or not anyone listens. */
  onSound(listener: (e: SoundEvent) => void): () => void {
    this.soundListener = listener;
    return () => {
      if (this.soundListener === listener) this.soundListener = null;
    };
  }

  /** Seconds left in the container the listener set, or null for an open
   *  session (no clock). Counts toward the whole experience — the composed
   *  ending is the last 90s of it, the card lands at zero. */
  remainingS(): number | null {
    if (this.score.container === 'open') return null;
    return Math.max(0, this.score.container * 60 - Tone.Transport.seconds);
  }

  /** Seconds left in a manual Close's brief composed ending, for the
   *  5-4-3-2-1 countdown — null unless a Close is underway (the full,
   *  automatic end keeps the container clock instead). */
  closeCountdownS(): number | null {
    if (this.endingAtS === null || this.endingProfile !== QUICK_ENDING) return null;
    return Math.max(0, this.endingProfile.totalS - (Tone.Transport.seconds - this.endingAtS));
  }

  /** The live scalars the interior weather reads each frame. Pure read. */
  visualState(): VisualState {
    const p = this.live();
    return {
      density: p.density,
      brightness: p.brightness,
      regionIndex: this.regionIndex,
      ending: this.endingAtS !== null,
      taper: this.taper(),
    };
  }

  /** Close: begin the brief composed ending now (open sessions always end
   *  this way; bounded sessions may be closed early). The quick profile
   *  keeps Close responsive — composed and resolved, never cut. */
  close(): void {
    if (this.endingAtS !== null) return;
    if (this.scheduledEndingId !== null) {
      Tone.Transport.clear(this.scheduledEndingId);
      this.scheduledEndingId = null;
    }
    this.startEnding(QUICK_ENDING);
  }

  private startEnding(profile: EndingProfile): void {
    if (this.endingAtS !== null) return;
    const atS = Tone.Transport.seconds;
    this.endingAtS = atS;
    this.endingProfile = profile;
    this.callbacks.onEnding?.();
    composeEnding(
      {
        drone: this.drone,
        texture: this.texture,
        pulse: this.pulse,
        bell: this.bell,
        tonicHz: this.base.tonicHz,
        onClosed: () => {
          const elapsed = Tone.Transport.seconds;
          this.callbacks.onClosed(elapsed);
        },
      },
      atS,
      profile,
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    Tone.Transport.stop();
    Tone.Transport.cancel(0);
    this.pads?.dispose();
    this.events?.dispose();
    this.texture?.dispose();
    this.pulse?.dispose();
    this.drone?.dispose();
    this.bell?.dispose();
    this.bellBus?.dispose();
    this.limiter?.dispose();
    this.masterTrim?.dispose();
    this.filter?.dispose();
    this.reverb?.dispose();
    this.thresholdGain?.dispose();
    this.bus?.dispose();
  }
}
