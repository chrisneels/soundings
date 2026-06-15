/**
 * Card.tsx — after the silence, the card: the score sentence, the
 * duration performed, the code that travels, and one optional prompt.
 * The one place in the interface where craft is spent — a small printed
 * object, not a share-sheet graphic.
 */

import { useEffect, useRef, useState } from 'react';
import { scoreSentence } from '../mappings';
import type { Score } from '../score';
import { encode } from '../score';
import { downloadBlob, renderCardPng } from './cardImage';
import { addEntry, setWord } from './journal';

function durationLine(elapsedS: number): string {
  const min = Math.round(elapsedS / 60);
  if (min < 1) return 'Less than a minute performed';
  if (min === 1) return 'One minute performed';
  return `${min} minutes performed`;
}

export function CardScreen(props: {
  score: Score;
  elapsedS: number;
  onDone: () => void;
}) {
  const code = encode(props.score);
  const sentence = scoreSentence(props.score);
  const [word, setWordState] = useState('');
  const [copied, setCopied] = useState(false);
  const journaled = useRef(false);

  // one plain journal entry per performance — no stats, no streaks
  useEffect(() => {
    if (journaled.current) return;
    journaled.current = true;
    addEntry({ date: new Date().toISOString(), code });
  }, [code]);

  const dateLine = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const save = async () => {
    const blob = await renderCardPng({
      sentence,
      code,
      durationLine: durationLine(props.elapsedS),
      dateLine,
      word: word.trim() || undefined,
    });
    downloadBlob(blob, `soundings-${code.replace(/[^A-Z0-9]/gi, '-')}.png`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // clipboard may be unavailable; the code is on screen to copy by hand
    }
  };

  return (
    <div className="screen">
      <div className="card">
        <p className="sentence">{sentence}</p>
        <div className="card-rule" aria-hidden="true" />
        <div className="card-code">{code}</div>
        <div className="card-meta">
          {durationLine(props.elapsedS)} · {dateLine}
        </div>
        <input
          className="card-word"
          value={word}
          placeholder="One word, if you want one."
          aria-label="One word, if you want one"
          onChange={(e) => setWordState(e.target.value)}
          onBlur={() => setWord(code, word.trim())}
        />
        <div className="card-actions">
          <button className="quiet-link" onClick={save}>
            Save card
          </button>
          <button className="quiet-link" onClick={copy}>
            {copied ? 'Copied' : 'Copy score'}
          </button>
        </div>
      </div>
      <button className="quiet-link" onClick={props.onDone}>
        Return
      </button>
    </div>
  );
}
