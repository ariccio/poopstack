import type { Preset } from './options';

// The phase-1 vocabulary: one base phrase per turn. `working` replaces the spinner's word
// while a turn runs ("Constipondering…"); `done` is a durative past form for a closing line,
// which the engine draws as "<done> for 42s · done 7:16 PM". `tier` is the lowest preset that
// shows the entry: discreet keeps to euphemism and plumbing words with no body word, regular
// adds plain and implied bodily words, maximum adds the crude ones. poopmaxxing shows what maximum
// shows; it differs only in its rate (options.ts).
//
// Sources: the ChatGPT conversation of 2026-10-19 (its ranked 500), the writers' research of
// 2026-10-20 and two of his own suggestions ("Pooping", "Straining"). Every entry passed the
// meaning review: no line that reads as a real status, a real operation or a shell command, and
// none of the cut words (tests/vocabulary.test.ts holds the list).

export type Entry = {
  readonly working: string;
  readonly done: string;
  readonly tier: Preset;
};

export const ENTRIES: readonly Entry[] = [
  { working: 'Taking a short bio break', done: 'Took a bio break', tier: 'discreet' },
  { working: 'Visiting the facilities', done: 'Visited the facilities', tier: 'discreet' },
  { working: 'Taking a constitutional', done: 'Took a constitutional', tier: 'discreet' },
  { working: 'Consulting the porcelain', done: 'Consulted the porcelain', tier: 'discreet' },
  { working: 'Convening the privy council', done: 'Sat with the privy council', tier: 'discreet' },
  { working: 'Exercising the right to stay seated', done: 'Remained seated', tier: 'discreet' },
  { working: 'Contemplating the tiles', done: 'Contemplated the tiles', tier: 'discreet' },
  { working: 'Reading the shampoo bottle', done: 'Read the shampoo bottle', tier: 'discreet' },
  { working: 'Occupying the smallest room', done: 'Occupied the smallest room', tier: 'discreet' },
  { working: 'Going through the motions', done: 'Went through the motions', tier: 'discreet' },
  { working: 'Digesting the request', done: 'Digested the request', tier: 'discreet' },
  { working: 'Taking a load off', done: 'Took a load off', tier: 'discreet' },
  { working: 'Passing a motion', done: 'Debated a motion', tier: 'discreet' },
  { working: 'Pulling up a stool', done: 'Sat on a stool', tier: 'discreet' },
  { working: 'Assessing restroom impact', done: 'Assessed restroom impact', tier: 'discreet' },
  { working: 'Mucking about', done: 'Mucked about', tier: 'discreet' },
  { working: 'Coprocessing', done: 'Coprocessed', tier: 'discreet' },
  { working: 'Doing its best thinking', done: 'Did its best thinking', tier: 'discreet' },
  { working: 'Accommodating the commode', done: 'Accommodated the commode', tier: 'discreet' },

  { working: 'Pooping', done: 'Pooped', tier: 'regular' },
  { working: 'Straining', done: 'Strained', tier: 'regular' },
  { working: 'Holding it in', done: 'Held it in', tier: 'regular' },
  { working: 'Holding the Thinker pose', done: 'Held the Thinker pose', tier: 'regular' },
  { working: 'Thinking on the throne', done: 'Thought on the throne', tier: 'regular' },
  { working: 'Constipondering', done: 'Constipondered', tier: 'regular' },
  { working: 'Posterioritizing', done: 'Posterioritized', tier: 'regular' },
  { working: 'Speculatively defecating', done: 'Speculatively defecated', tier: 'regular' },
  { working: 'Training a large bowel model', done: 'Trained a large bowel model', tier: 'regular' },
  { working: 'Bearing down on the problem', done: 'Bore down on the problem', tier: 'regular' },
  {
    working: 'Giving breakfast its exit interview',
    done: "Held breakfast's exit interview",
    tier: 'regular',
  },
  {
    working: 'Guarding against use-after-flush',
    done: 'Guarded against use-after-flush',
    tier: 'regular',
  },
  {
    working: "Garbage collecting yesterday's lunch",
    done: "Garbage collected yesterday's lunch",
    tier: 'regular',
  },
  { working: 'Negotiating with lunch', done: 'Negotiated with lunch', tier: 'regular' },
  {
    working: "Reviewing the toilet's fine print",
    done: "Reviewed the toilet's fine print",
    tier: 'regular',
  },
  {
    working: "Interpreting the toilet's silence",
    done: "Interpreted the toilet's silence",
    tier: 'regular',
  },
  { working: 'Riding a peristaltic wave', done: 'Rode a peristaltic wave', tier: 'regular' },
  {
    working: 'Choreographing the bowel movement',
    done: 'Choreographed the bowel movement',
    tier: 'regular',
  },
  {
    working: 'Awaiting peer review of the stool',
    done: 'Awaited peer review of the stool',
    tier: 'regular',
  },
  { working: 'Pooptimizing', done: 'Pooptimized', tier: 'regular' },
  { working: 'Defecogitating', done: 'Defecogitated', tier: 'regular' },
  { working: 'Fecalibrating', done: 'Fecalibrated', tier: 'regular' },
  { working: 'Scataloguing', done: 'Scatalogued', tier: 'regular' },
  { working: 'Poopulating', done: 'Poopulated', tier: 'regular' },
  { working: 'Stooling around', done: 'Stooled around', tier: 'regular' },
  { working: 'Uncluttering the colon', done: 'Uncluttered the colon', tier: 'regular' },
  { working: 'Decompiling dinner', done: 'Decompiled dinner', tier: 'regular' },
  { working: 'Telling the toilet everything', done: 'Told the toilet everything', tier: 'regular' },
  { working: 'Extruding the inevitable', done: 'Extruded the inevitable', tier: 'regular' },
  { working: 'Pursuing higher defecation', done: 'Pursued higher defecation', tier: 'regular' },
  { working: 'Apologizing to the porcelain', done: 'Apologized to the porcelain', tier: 'regular' },
  {
    working: 'Measuring the coefficient of relief',
    done: 'Measured the coefficient of relief',
    tier: 'regular',
  },
  { working: 'Debugging the bowels', done: 'Debugged the bowels', tier: 'regular' },
  {
    working: 'Conducting a lengthy food review',
    done: 'Conducted a lengthy food review',
    tier: 'regular',
  },
  { working: 'Working on a future fossil', done: 'Worked on a future fossil', tier: 'regular' },

  { working: 'Excrapolating', done: 'Excrapolated', tier: 'maximum' },
  { working: 'Procrapstinating', done: 'Procrapstinated', tier: 'maximum' },
  { working: 'Refartoring', done: 'Refartored', tier: 'maximum' },
  { working: 'Moving fast and breaking wind', done: 'Moved fast and broke wind', tier: 'maximum' },
  { working: 'Exploring the Turdassic', done: 'Explored the Turdassic', tier: 'maximum' },
  { working: 'Load-balancing the cheeks', done: 'Load-balanced the cheeks', tier: 'maximum' },
  { working: 'Learning from human feces', done: 'Learned from human feces', tier: 'maximum' },
  { working: 'Cycling the rear airlock', done: 'Cycled the rear airlock', tier: 'maximum' },
  {
    working: 'Waiting for inspiration to move',
    done: 'Awaited inspiration to move',
    tier: 'maximum',
  },
];

// His two commit lines (decision 28), in the order a session shows them; from the third commit
// joke on, the first line again (decision 41's default). Discreet shows only the first.
export const COMMIT_FIRST = 'Making a deposit (not the money kind)';
export const COMMIT_SECOND =
  "don't worry, it's perfectly normal to have to go multiple times per day";

// His line for a turn he interrupted (decision 47), shown as a toast: an interrupted turn draws no
// closing line to rewrite. Regular and maximum only; the real verb comes first (decision 31).
export const ABORTED_LINE = "Aborted mid-movement: you didn't lock the door, they didn't knock!";

// The closing line of a turn an API error ended (decision 31, his text): regular and maximum
// only, on the outcome dice. A refused turn whose line would have joked says only "Refused"
// (decision 24); a plain turn keeps Claude Code's own word either way.
export const ERROR_WORD = 'Failed: oopsie doopsie, had a lil poopsie';
export const REFUSED_WORD = 'Refused';

// The label a joked closing line carries after Claude Code's own text (feature row 8), so a
// reader can tell the word came from the mod. Discreet shows it without the emoji (design item
// 11); a "Refused" line carries nothing after it (decision 24). Each label's length in UTF-16
// units equals its width in columns: the emoji is two of each.
export const FOOTER_LABEL = '🚽 p(oop)stack';
export const FOOTER_LABEL_DISCREET = 'p(oop)stack';
export const LABEL_GAP = ' · ';

// The columns a closing line takes besides its word: "✻ " before it, and " for 1h 2m 3s · done
// 12:59 PM" after it (the engine's format, FINDINGS 22). An estimate from that format, not
// measured on a narrow terminal; the live matrix measures it.
export const LINE_TAIL_COLUMNS = 31;

export function footerLabel(word: string, preset: Preset): string | null {
  if (word === REFUSED_WORD) {
    return null;
  }
  return preset === 'discreet' ? FOOTER_LABEL_DISCREET : FOOTER_LABEL;
}

// Whether the label fits after the line without wrapping it; true where the surface has not
// measured its width, since a wrap there only costs a row.
export function labelFits(columns: number | undefined, word: string, label: string): boolean {
  if (columns === undefined) {
    return true;
  }
  return word.length + LINE_TAIL_COLUMNS + LABEL_GAP.length + label.length <= columns;
}

const RANK: Readonly<Record<Preset, number>> = {
  discreet: 0,
  regular: 1,
  maximum: 2,
  poopmaxxing: 3,
};

export function isShownAt(entry: Entry, preset: Preset): boolean {
  return RANK[entry.tier] <= RANK[preset];
}

export function poolFor(preset: Preset): readonly Entry[] {
  return ENTRIES.filter((entry) => isShownAt(entry, preset));
}

// The past form that pairs with a turn's phrase, or null when the turn was plain or the phrase
// is not in the preset's pool (the spinner then showed Claude Code's own word).
export function doneFor(phrase: string | null, preset: Preset): string | null {
  return poolFor(preset).find((entry) => entry.working === phrase)?.done ?? null;
}

// Whether a closing line's stored word may show under the preset in force now: a switch to a
// tamer preset returns the lines on screen that it would not have joked to Claude Code's word.
export function isShownNow(word: string, preset: Preset): boolean {
  if (word === REFUSED_WORD) {
    return true;
  }
  if (word === ERROR_WORD) {
    return preset !== 'discreet';
  }
  return poolFor(preset).some((entry) => entry.done === word);
}

// `shown` counts the commit jokes this session showed before this one.
export function commitLine(shown: number, preset: Preset): string {
  return shown === 1 && preset !== 'discreet' ? COMMIT_SECOND : COMMIT_FIRST;
}
