/**
 * journal.ts — plain entries in localStorage. No stats, no streaks.
 * Each entry is just: when, which score, and (optionally) one word.
 */

export type JournalEntry = {
  date: string; // ISO
  code: string;
  word?: string;
};

const KEY = 'soundings.journal.v2';

function read(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is JournalEntry =>
        typeof e === 'object' && e !== null && 'date' in e && 'code' in e,
    );
  } catch {
    return [];
  }
}

function write(entries: JournalEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // private mode or full storage — the journal is a courtesy, not a need
  }
}

/** Newest first. */
export function listEntries(): JournalEntry[] {
  return read().slice().reverse();
}

export function addEntry(entry: JournalEntry): void {
  write([...read(), entry]);
}

/** Attach the one word to the most recent entry for this code. */
export function setWord(code: string, word: string): void {
  const entries = read();
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].code === code) {
      entries[i] = { ...entries[i], word: word || undefined };
      break;
    }
  }
  write(entries);
}
