# Soundings v2 — The Threshold Instrument

Score in, bounded performance, score out.

Before listening you answer three questions — circumstance, intention,
container. The answers compose a short text score you read once; the
session is a performance of that score, with a composed beginning and a
composed end; the close produces a card carrying a compact score code.
Anyone can type that code into their own device and the same piece
performs again. Nothing is ever recorded. Scores travel; performances
don't.

## The one inviolable principle

**The performance is a pure function of the score.** Every stochastic
decision derives deterministically from the score's seed through one
counter-based generator ([src/rand.ts](src/rand.ts)). Same code →
identical decision sequence, any device, any day. `Math.random()` is
forbidden across the codebase and ESLint enforces it.

(Decision-deterministic, not sample-deterministic: reverb tails and DSP
minutiae may vary; the notes, timings, and parameter walks may not.)

## Running

```sh
npm install
npm run dev      # no audio assets required — fully synthesized
npm test         # determinism, score codes, lattice, mappings
npm run lint     # fails on any Math.random
npm run build
```

## The score code

```
TEND-E20-C-KAMO-41X
└┬─┘ └┬┘ ┬ └┬─┘ └┬┘┬
intention │ │   │  └ checksum (Luhn mod 36 — typos fail kindly)
     hour+minutes │ entropy word + number (the seed)
          circumstance (A–H: output / field / company)
```

Case-insensitive; dashes are decoration. ≤ 24 characters. The code IS
the score — no server, no lookup.

## Where things live

- [src/score.ts](src/score.ts) — Score type, encode/decode, seed words, checksum
- [src/rand.ts](src/rand.ts) — the only source of randomness
- [src/lattice.ts](src/lattice.ts) — just-intonation ratio pools, regions, voice leading, timbre specs
- [src/mappings.ts](src/mappings.ts) — intention → parameters, circumstance modifiers, all copy
- [src/engine/decisions.ts](src/engine/decisions.ts) — every musical choice, as pure functions
- [src/engine/](src/engine/) — voices, layers, scheduler, the composed ending
- [src/ui/](src/ui/) — the screens; all type tokens in [src/ui/tokens.css](src/ui/tokens.css)

**All tuning lives in `mappings.ts` + `lattice.ts`.** To swap the
typeface everywhere (screens and card), change `--font-family` in
`tokens.css` and nothing else.

## The sound, in brief

A fixed tonic that never moves (drone practice); all pitch is frequency
ratios over it — no note names anywhere. Sustained voices are additive
(partials 1–8, 1/n^1.4, each partial breathing on its own slow seeded
LFO); no detuned oscillators, because the payoff of just intonation is
the beatless lock. Harmonic motion is region drift: probability
reweighting within a fixed lattice, never modulation. Wander carries the
harmonic seventh (7/4) — a tone that exists on no piano. Focus and Rest
have no discrete onsets at all.

The ending is composed, never faded: density tapers, layers thin, the
drone resolves to 1/1 alone, one bell, ten seconds of true silence, then
the card.
