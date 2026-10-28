import { expect, test } from 'claude-code/testing';
import {
  COMMIT_FIRST,
  COMMIT_SECOND,
  commitLine,
  ENTRIES,
  ERROR_WORD,
  isShownNow,
  poolFor,
  REFUSED_WORD,
} from '../hooks/vocabulary';

// The meaning review's mechanical half (design contract, item 7). The column caps are guesses
// until the narrow-terminal check in the live matrix: the spinner adds "… (12s · thinking with
// xhigh effort)" after the word, and the closing line adds " for 42s · done 7:16 PM".
const WORKING_CAP = 36;
const DONE_CAP = 40;

// Words cut by his rulings and Grok's cut list (plan, proposed change 4, adopted), the
// one-meaning words reserved for other surfaces, and words that read as a real failure or a real
// destructive operation.
const CUT = /\b(dump|dumped|dumping|backup|backed|backlog|force|forcing|sphincter|excretion)\b/i;
const RESERVED = /\b(ply|pressure|stall|stalls|floor|regular|regularity|fiber|sample)\b/i;
const ALARMING =
  /\b(fail|failed|error|crash|crashed|abort|aborted|interrupted|refused|denied|killed|timeout|delete|deleted|wipe|wiped|purge|reset|truncate|drop|dropped|leak|leaked)\b/i;
const SHELL_SHAPE = /^(sudo|rm|git|npm|pnpm|cd|ls|cat|curl|chmod|kill)\b|--|[|;$`<>/\\]/i;
const IRREGULAR_PAST = new Set([
  'Took',
  'Sat',
  'Read',
  'Went',
  'Did',
  'Held',
  'Bore',
  'Rode',
  'Thought',
  'Told',
]);

function isPastWord(word: string | undefined): boolean {
  return word !== undefined && (/ed$/.test(word) || IRREGULAR_PAST.has(word));
}

test('every line is plain ASCII within its column cap, with no ellipsis of its own', () => {
  for (const entry of ENTRIES) {
    for (const [text, cap] of [
      [entry.working, WORKING_CAP],
      [entry.done, DONE_CAP],
    ] as const) {
      expect(/^[\x20-\x7e]+$/.test(text)).toBe(true);
      expect(text.length <= cap).toBe(true);
      expect(text.endsWith('.')).toBe(false);
    }
  }
});

test('no line uses a cut word, a reserved word, an alarming word or a shell shape', () => {
  for (const entry of ENTRIES) {
    for (const text of [entry.working, entry.done]) {
      expect({ text, cut: CUT.test(text) }).toEqual({ text, cut: false });
      expect({ text, reserved: RESERVED.test(text) }).toEqual({ text, reserved: false });
      expect({ text, alarming: ALARMING.test(text) }).toEqual({ text, alarming: false });
      expect({ text, shell: SHELL_SHAPE.test(text) }).toEqual({ text, shell: false });
    }
  }
});

test('"brown" never appears in discreet', () => {
  for (const entry of poolFor('discreet')) {
    expect(/brown/i.test(`${entry.working} ${entry.done}`)).toBe(false);
  }
});

test('a working line is a present participle; a done line reads before "for 42s"', () => {
  for (const entry of ENTRIES) {
    const [first, second] = entry.working.split(' ');
    expect({
      line: entry.working,
      ok: /ing$/.test(first ?? '') || /ing$/.test(second ?? ''),
    }).toEqual({
      line: entry.working,
      ok: true,
    });
    const [pastFirst, pastSecond] = entry.done.split(' ');
    expect({ line: entry.done, ok: isPastWord(pastFirst) || isPastWord(pastSecond) }).toEqual({
      line: entry.done,
      ok: true,
    });
    // "for" inside the line would read "… for X for 42s".
    expect({ line: entry.done, hasFor: /\bfor\b/i.test(entry.done) }).toEqual({
      line: entry.done,
      hasFor: false,
    });
  }
});

test('no line appears twice', () => {
  const working = ENTRIES.map((entry) => entry.working);
  const done = ENTRIES.map((entry) => entry.done);
  expect(new Set(working).size).toBe(working.length);
  expect(new Set(done).size).toBe(done.length);
});

test('each preset includes the tamer ones, and discreet is about a third of the whole', () => {
  const discreet = poolFor('discreet').length;
  const regular = poolFor('regular').length;
  const maximum = poolFor('maximum').length;
  expect(discreet > 15 && discreet < regular && regular < maximum).toBe(true);
  expect(maximum).toBe(ENTRIES.length);
});

test('his commit lines come in his order, and discreet keeps to the first', () => {
  expect(commitLine(0, 'regular')).toBe(COMMIT_FIRST);
  expect(commitLine(1, 'regular')).toBe(COMMIT_SECOND);
  expect(commitLine(2, 'regular')).toBe(COMMIT_FIRST);
  expect(commitLine(1, 'discreet')).toBe(COMMIT_FIRST);
  expect(COMMIT_FIRST).toBe('Making a deposit (not the money kind)');
  expect(COMMIT_SECOND).toBe(
    "don't worry, it's perfectly normal to have to go multiple times per day",
  );
});

test('a closing word shows only where its preset would have joked it', () => {
  const tamest = ENTRIES.find((entry) => entry.tier === 'discreet');
  const wildest = ENTRIES.find((entry) => entry.tier === 'maximum');
  expect(tamest !== undefined && wildest !== undefined).toBe(true);
  for (const preset of ['discreet', 'regular', 'maximum'] as const) {
    expect(isShownNow(tamest?.done ?? '', preset)).toBe(true);
    expect(isShownNow(wildest?.done ?? '', preset)).toBe(preset === 'maximum');
    expect(isShownNow(REFUSED_WORD, preset)).toBe(true);
    expect(isShownNow(ERROR_WORD, preset)).toBe(preset !== 'discreet');
    expect(isShownNow('A word no entry has', preset)).toBe(false);
  }
});
