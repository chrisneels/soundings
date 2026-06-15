/**
 * screens.tsx — entry, the three intake questions, and Scores (your past
 * performances + a field to enter one you were given). Quiet typography,
 * one question per screen, unhurried.
 */

import { useEffect, useState } from 'react';
import type {
  Company,
  Container,
  Field,
  Intention,
  Output,
  Score,
} from '../score';
import { decode, hourBandOf, newSeed } from '../score';
import { INTENTION_SUBTITLES, scoreSentence } from '../mappings';
import { listEntries } from './journal';

/* ---- shared bits --------------------------------------------------- */

function OptionGroup<T extends string | number>(props: {
  label: string;
  options: { value: T; label: string; subtitle?: string }[];
  value: T | null;
  onChoose: (v: T) => void;
  row?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      className={props.row ? 'option-row' : 'options'}
    >
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={props.value === o.value}
          className={o.subtitle ? 'option option-with-sub' : 'option'}
          onClick={() => props.onChoose(o.value)}
        >
          <span className="option-main">{o.label}</span>
          {o.subtitle && <span className="option-subtitle">{o.subtitle}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---- entry ---------------------------------------------------------- */

export function EntryScreen(props: {
  onBegin: () => void;
  onAbout: () => void;
  onScores: () => void;
}) {
  // Begin is the one call to action — the eye should land there. About and
  // performing a previous score are quiet secondary links beneath it, set
  // apart so they don't compete.
  return (
    <div className="screen">
      <div className="wordmark">soundings</div>
      <button className="cta" onClick={props.onBegin}>
        Begin
      </button>
      <div className="entry-secondary">
        <button className="quiet-link" onClick={props.onAbout}>
          About
        </button>
        <button className="quiet-link" onClick={props.onScores}>
          Perform previous score
        </button>
      </div>
    </div>
  );
}

/* ---- about ---------------------------------------------------------- */

export function AboutScreen(props: { onBack: () => void }) {
  return (
    <div className="screen">
      <div className="wordmark">soundings</div>
      <p className="about-text">
        Soundings is a generative listening instrument. Nothing is
        pre-recorded. Each performance is composed as it plays — drawn from a
        small lattice of pure intervals, tuned to the intention you choose —
        so no two are ever fully alike. Every performance is bounded. It
        begins with a single bell, holds for the time you set, and decays into
        silence. The listener has the option to retain the score: a short code
        that they can keep, or hand to someone, so the performance can be heard
        again.
      </p>
      <button className="quiet-link" onClick={props.onBack}>
        Return
      </button>
    </div>
  );
}

/* ---- intake: three questions, one per screen ------------------------ */

export function IntakeScreen(props: {
  onScore: (score: Score) => void;
  onBack: () => void;
  /** Fires the instant an intention is chosen, so the field can lean before
   *  the score exists. */
  onIntention?: (intention: Intention) => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [output, setOutput] = useState<Output | null>(null);
  const [field, setField] = useState<Field | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [intention, setIntention] = useState<Intention | null>(null);

  const finish = (container: Container) => {
    if (!output || !field || !company || !intention) return;
    props.onScore({
      v: 2,
      seed: newSeed(),
      intention,
      circumstance: { output, field, company },
      container,
      hourBand: hourBandOf(new Date()), // captured into the score, once
    });
  };

  // Once all three are chosen, move on by itself — no redundant Continue.
  // A short beat lets the third selection register before the fade.
  useEffect(() => {
    if (step === 0 && output && field && company) {
      const id = window.setTimeout(() => setStep(1), 450);
      return () => window.clearTimeout(id);
    }
  }, [step, output, field, company]);

  if (step === 0) {
    return (
      <div className="screen" key="circumstance">
        <div className="question">Where does this find you?</div>
        <OptionGroup<Output>
          label="Listening through"
          row
          options={[
            { value: 'headphones', label: 'Headphones' },
            { value: 'speakers', label: 'Speakers' },
          ]}
          value={output}
          onChoose={setOutput}
        />
        <OptionGroup<Field>
          label="The field around you"
          row
          options={[
            { value: 'quiet', label: 'Quiet' },
            { value: 'noise', label: 'Noise' },
          ]}
          value={field}
          onChoose={setField}
        />
        <OptionGroup<Company>
          label="Company"
          row
          options={[
            { value: 'alone', label: 'Alone' },
            { value: 'others', label: 'Others nearby' },
          ]}
          value={company}
          onChoose={setCompany}
        />
        <button className="quiet-link" onClick={props.onBack}>
          Return
        </button>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="screen" key="intention">
        <div className="question">What is this time for?</div>
        <OptionGroup<Intention>
          label="Intention"
          options={[
            { value: 'settle', label: 'Settle', subtitle: INTENTION_SUBTITLES.settle },
            { value: 'focus', label: 'Focus', subtitle: INTENTION_SUBTITLES.focus },
            { value: 'rest', label: 'Rest', subtitle: INTENTION_SUBTITLES.rest },
            { value: 'tend', label: 'Tend', subtitle: INTENTION_SUBTITLES.tend },
            { value: 'wander', label: 'Wander', subtitle: INTENTION_SUBTITLES.wander },
            { value: 'wait', label: 'Wait', subtitle: INTENTION_SUBTITLES.wait },
          ]}
          value={intention}
          onChoose={(v) => {
            setIntention(v);
            props.onIntention?.(v);
            setStep(2);
          }}
        />
      </div>
    );
  }

  return (
    <div className="screen" key="container">
      <div className="question">How long can it hold you?</div>
      <OptionGroup<Container>
        label="Container"
        options={[
          { value: 10, label: 'Ten minutes' },
          { value: 20, label: 'Twenty minutes' },
          { value: 45, label: 'Forty-five minutes' },
          { value: 'open', label: 'Open' },
        ]}
        value={null}
        onChoose={finish}
      />
    </div>
  );
}

/* ---- scores: enter one you were given, or re-perform a past one ------ */

export function ScoresScreen(props: {
  onScore: (score: Score) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const entries = listEntries();

  const submit = () => {
    const result = decode(code);
    if (result.ok) {
      props.onScore(result.score);
      return;
    }
    setError(
      result.reason === 'checksum'
        ? 'That score didn’t survive the journey — check it against the card.'
        : 'That doesn’t read as a score yet — it looks like TEND-E20-C-KAMO-41X.',
    );
  };

  return (
    <div className="screen">
      <div className="wordmark">perform previous score</div>

      {/* Enter a score someone gave you — or one off a printed card. */}
      <div className="scores-entry">
        <input
          className="code-input"
          value={code}
          placeholder="Type a score"
          spellCheck={false}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && code.trim()) submit();
          }}
          aria-label="Score code"
        />
        {error && (
          <div className="small-note" role="alert">
            {error}
          </div>
        )}
        {code.trim() && (
          <button className="quiet-link" onClick={submit}>
            Read the score
          </button>
        )}
      </div>

      {/* Your past performances — each a score you can perform again. */}
      {entries.length > 0 && (
        <div className="journal">
          {entries.map((e, i) => {
            const decoded = decode(e.code);
            const date = new Date(e.date);
            return (
              <div className="journal-entry" key={`${e.date}-${i}`}>
                <div className="small-note">
                  {date.toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </div>
                <div className="journal-code">{e.code}</div>
                {decoded.ok && (
                  <div className="small-note">{scoreSentence(decoded.score)}</div>
                )}
                {e.word && <div className="journal-word">{e.word}</div>}
                {decoded.ok && (
                  <button
                    className="quiet-link"
                    onClick={() => props.onScore(decoded.score)}
                  >
                    Perform again
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button className="quiet-link" onClick={props.onBack}>
        Return
      </button>
    </div>
  );
}
