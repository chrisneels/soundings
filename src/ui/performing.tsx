/**
 * performing.tsx — the threshold screen and the performance itself.
 *
 * Threshold: the score sentence, read once. That single reading is the
 * rehearsal. Begin fades in beneath it over ~1.5 s.
 *
 * Performing: near-black. The intention line, one slowly breathing ring
 * (period per intention; static under prefers-reduced-motion) with weather
 * inside it, and exactly two controls.
 */

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { FOCUS_NOTE, VISUALS, intentionLineFor, scoreSentence } from '../mappings';
import type { Score } from '../score';
import type { Performance } from '../engine/scheduler';
import { Interior } from './interior';

/** A small, dim clock. While performing it counts down the container the
 *  listener set (m:ss; nothing for an open session). When Close is pressed
 *  it switches to a bare 5-4-3-2-1 over the brief composed ending, so the
 *  listener can see the piece closing. Reads the performance (Transport)
 *  clock four times a second. */
function SessionTimer({ perf }: { perf: Performance | null }) {
  const [, bump] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => bump((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);
  if (!perf) return null;

  const closing = perf.closeCountdownS();
  if (closing !== null) {
    return <div className="session-timer">{Math.max(1, Math.ceil(closing))}</div>;
  }

  const remaining = perf.remainingS();
  if (remaining === null) return null;
  const m = Math.floor(remaining / 60);
  const s = Math.floor(remaining % 60);
  return <div className="session-timer">{`${m}:${String(s).padStart(2, '0')}`}</div>;
}

export function ThresholdScreen(props: { score: Score; onBegin: () => void }) {
  const [starting, setStarting] = useState(false);
  return (
    <div className="screen">
      <p className="sentence">{scoreSentence(props.score)}</p>
      {props.score.intention === 'focus' && (
        <div className="small-note">{FOCUS_NOTE}</div>
      )}
      <button
        className="begin"
        disabled={starting}
        onClick={() => {
          setStarting(true);
          props.onBegin();
        }}
      >
        Begin
      </button>
    </div>
  );
}

export function PerformingScreen(props: {
  score: Score;
  perf: Performance | null;
  closing: boolean;
  onClose: () => void;
}) {
  // The breath period is behaviour (per intention) → CSS custom property;
  // the keyframes themselves stay in app.css.
  const breathStyle = {
    '--breath-period': `${VISUALS.breathPeriodS[props.score.intention]}s`,
  } as CSSProperties;
  return (
    <div className="screen performing">
      <SessionTimer perf={props.perf} />
      <div className="breath-wrap" aria-hidden="true" style={breathStyle}>
        <Interior score={props.score} perf={props.perf} />
        <div className="breath" />
      </div>
      <p className="intention-line">{intentionLineFor(props.score)}</p>
      <div className={`controls${props.closing ? ' hidden' : ''}`}>
        <button className="quiet-link" onClick={props.onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
