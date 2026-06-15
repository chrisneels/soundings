/**
 * ending.ts — the composed close. Never a fade-out.
 *
 * Two profiles, same shape at different durations:
 *
 *   FULL  — a session that runs its whole container, or any session at the
 *           90 s mark. Region drift stops, density tapers, texture thins
 *           over 45 s, the 3/2 releases at +50 s so the piece resolves to
 *           1/1 alone, a bell at +74 s, then ten seconds of true silence.
 *
 *   QUICK — the listener presses Close. The same composition, compressed
 *           to ~20 s: a real taper and resolve and bell, a short true
 *           silence — never an abrupt cut, never a fade — so Close feels
 *           responsive without breaking the "composed, not faded" rule.
 *
 * Either way the card appears only after the silence. Everything is
 * scheduled on Tone.Transport (worker-clocked) so the ending completes
 * reliably in an unfocused tab.
 */

import * as Tone from 'tone';
import type { Drone, Pulse, Texture } from './layers';
import type { Bell } from './voices';

export type EndingProfile = {
  /** Total seconds from the start of the ending to the card. */
  totalS: number;
  /** Seconds over which density tapers to nothing. */
  taperS: number;
  /** When the 3/2 releases (the resolve to 1/1 alone), and how slowly. */
  fifthAtS: number;
  fifthReleaseS: number;
  /** When the closing bell speaks, and how slowly the 1/1 then releases.
   *  True silence = totalS − bellAtS − rootReleaseS. */
  bellAtS: number;
  rootReleaseS: number;
  textureFadeS: number;
  pulseFadeS: number;
};

// silence = 90 − 74 − 6 = 10 s
export const FULL_ENDING: EndingProfile = {
  totalS: 90,
  taperS: 40,
  fifthAtS: 50,
  fifthReleaseS: 12,
  bellAtS: 74,
  rootReleaseS: 6,
  textureFadeS: 45,
  pulseFadeS: 30,
};

// A brisk 5 s close on Close — composed, not faded: a quick taper, the
// fifth lets go, a bell, the root resolves, a held breath of silence. The
// performing-screen timer counts it down 5-4-3-2-1. silence ≈ 5 − 0.6 − 3.2.
export const QUICK_ENDING: EndingProfile = {
  totalS: 5,
  taperS: 2,
  fifthAtS: 0.3,
  fifthReleaseS: 2.2,
  bellAtS: 0.6,
  rootReleaseS: 3.2,
  textureFadeS: 2,
  pulseFadeS: 1.5,
};

export type EndingParts = {
  drone: Drone;
  texture: Texture;
  pulse: Pulse | null;
  bell: Bell;
  tonicHz: number;
  /** Fires when the silence completes — the performance is over. */
  onClosed: () => void;
};

export function composeEnding(
  parts: EndingParts,
  atS: number,
  p: EndingProfile,
): void {
  const T = Tone.Transport;

  T.scheduleOnce((time) => {
    parts.texture.ramp(0, p.textureFadeS, time);
    parts.pulse?.fadeOut(p.pulseFadeS, time);
  }, atS);

  T.scheduleOnce((time) => {
    parts.drone.releaseFifth(p.fifthReleaseS, time);
  }, atS + p.fifthAtS);

  T.scheduleOnce((time) => {
    // the bell speaks over the bare tonic as it lets go
    parts.bell.strike(parts.tonicHz * 2, time, 0.4);
    parts.drone.releaseRoot(p.rootReleaseS, time);
  }, atS + p.bellAtS);

  T.scheduleOnce(() => {
    parts.onClosed();
  }, atS + p.totalS);
}
