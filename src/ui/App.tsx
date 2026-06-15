/**
 * App.tsx — the state machine:
 * entry → intake → threshold → performing → closing → closed
 * with two side doors from entry: About, and Scores (enter a code, or
 * re-perform a past one).
 *
 * A single <Field> sits behind every screen — app-wide background lighting
 * that persists across transitions (see ui/Field.tsx). It reads only the
 * phase, the chosen/leaning intention, and the hourBand.
 */

import { useCallback, useRef, useState } from 'react';
import { Performance } from '../engine/scheduler';
import type { Intention, Score } from '../score';
import { hourBandOf } from '../score';
import { CardScreen } from './Card';
import { AboutScreen, EntryScreen, IntakeScreen, ScoresScreen } from './screens';
import { PerformingScreen, ThresholdScreen } from './performing';
import { Field } from './FieldCanvas';
import type { FieldPhase } from './FieldCanvas';

type Phase =
  | { name: 'entry' }
  | { name: 'intake' }
  | { name: 'scores' }
  | { name: 'about' }
  | { name: 'threshold'; score: Score }
  | { name: 'performing'; score: Score }
  | { name: 'closing'; score: Score }
  | { name: 'closed'; score: Score; elapsedS: number };

const FIELD_PHASE: Record<Phase['name'], FieldPhase> = {
  entry: 'home',
  intake: 'intake',
  scores: 'scores',
  about: 'about',
  threshold: 'threshold',
  performing: 'performing',
  closing: 'closing',
  closed: 'card',
};

export default function App() {
  const [phase, setPhase] = useState<Phase>({ name: 'entry' });
  // The intention the field leans toward during intake, the instant it is
  // chosen (before the score exists). Cleared on return home.
  const [leanIntention, setLeanIntention] = useState<Intention | null>(null);
  const perfRef = useRef<Performance | null>(null);
  // The room's hourBand before a score exists — the live clock, captured once.
  const liveHourBand = useRef(hourBandOf(new Date())).current;

  const toEntry = useCallback(() => {
    perfRef.current?.dispose();
    perfRef.current = null;
    setLeanIntention(null);
    setPhase({ name: 'entry' });
  }, []);

  const toThreshold = useCallback((score: Score) => {
    setPhase({ name: 'threshold', score });
  }, []);

  const begin = useCallback(async (score: Score) => {
    const perf = new Performance(score, {
      onEnding: () => setPhase({ name: 'closing', score }),
      onClosed: (elapsedS) => setPhase({ name: 'closed', score, elapsedS }),
    });
    perfRef.current = perf;
    await perf.begin(); // inside the Begin gesture — no audio before consent
    setPhase({ name: 'performing', score });
  }, []);

  // The field reads ONLY intention + hourBand: from the score once it exists,
  // from the leaning choice during intake, neutral + live clock otherwise.
  let fieldIntention: Intention | null = null;
  let fieldHourBand = liveHourBand;
  if (
    phase.name === 'threshold' ||
    phase.name === 'performing' ||
    phase.name === 'closing' ||
    phase.name === 'closed'
  ) {
    fieldIntention = phase.score.intention;
    fieldHourBand = phase.score.hourBand;
  } else if (phase.name === 'intake') {
    fieldIntention = leanIntention;
  }

  const screen = (() => {
    switch (phase.name) {
      case 'entry':
        return (
          <EntryScreen
            onBegin={() => setPhase({ name: 'intake' })}
            onAbout={() => setPhase({ name: 'about' })}
            onScores={() => setPhase({ name: 'scores' })}
          />
        );
      case 'intake':
        return (
          <IntakeScreen
            onScore={toThreshold}
            onBack={toEntry}
            onIntention={setLeanIntention}
          />
        );
      case 'scores':
        return <ScoresScreen onScore={toThreshold} onBack={toEntry} />;
      case 'about':
        return <AboutScreen onBack={toEntry} />;
      case 'threshold':
        return <ThresholdScreen score={phase.score} onBegin={() => begin(phase.score)} />;
      case 'performing':
        return (
          <PerformingScreen
            score={phase.score}
            perf={perfRef.current}
            closing={false}
            onMoreSpace={() => perfRef.current?.moreSpace()}
            onClose={() => perfRef.current?.close()}
          />
        );
      case 'closing':
        return (
          <PerformingScreen
            score={phase.score}
            perf={perfRef.current}
            closing
            onMoreSpace={() => undefined}
            onClose={() => undefined}
          />
        );
      case 'closed':
        return (
          <CardScreen score={phase.score} elapsedS={phase.elapsedS} onDone={toEntry} />
        );
    }
  })();

  return (
    <>
      <Field
        phase={FIELD_PHASE[phase.name]}
        intention={fieldIntention}
        hourBand={fieldHourBand}
        perf={perfRef.current}
      />
      {screen}
    </>
  );
}
