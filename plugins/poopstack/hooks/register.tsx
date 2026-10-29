import type {
  CommandInfo,
  EngineInterface,
  On,
  Register,
  RenderElement,
  RenderInput,
  RenderPropsOf,
  RenderSurface,
  SessionAppendInput,
  TurnCompleteInput,
  TurnCompleteReason,
} from 'claude-code';
import {
  COMMIT_COUNT_PREFIX,
  commitCountKey,
  isStale,
  readCount,
  type StoredCount,
} from './commits';
import { commitKind } from './git';
import {
  describeRate,
  isOwnRow,
  isPreset,
  matchedRate,
  type Preset,
  readSettings,
  type Settings,
  turnRate,
} from './options';
import { drawPhrase, hashId, nextRandom, prdConstant, roll, warmMisses } from './pick';
import {
  ABORTED_LINE,
  commitLine,
  doneFor,
  ERROR_WORD,
  footerLabel,
  isShownNow,
  LABEL_GAP,
  labelFits,
  poolFor,
  REFUSED_WORD,
} from './vocabulary';

// Wiring only: each hook reads what it needs from `$` and hands it to the pure modules. Every
// hook passes the event on unchanged when the mod is off, the session is not interactive, or the
// input is not what it expects, and its `.catch` does the same.
//
// Style: one operation per step. Every `await` is its own statement, and a value read from
// `$.state` is named `<key>Read` (the engine's `StateRead`: the value and its version) before its
// value is used.

const IS_OFF = { plugin: 'poopstack', key: 'isOff' } as const;
const WAS_ENABLED = { plugin: 'poopstack', key: 'wasEnabled' } as const;
const RNG = { plugin: 'poopstack', key: 'rng' } as const;
const PHRASE = { plugin: 'poopstack', key: 'phrase' } as const;
const BAG = { plugin: 'poopstack', key: 'bag' } as const;
const TURN_MISSES = { plugin: 'poopstack', key: 'turnMisses' } as const;
const COMMIT_MISSES = { plugin: 'poopstack', key: 'commitMisses' } as const;
const OUTCOME_MISSES = { plugin: 'poopstack', key: 'outcomeMisses' } as const;
const CLOSING_WORD = { plugin: 'poopstack', key: 'closingWord' } as const;

// Said when a stored commit count could not be read and was replaced (the store is shared with
// the world: lane 2 of the error-handling rules). His pair then starts again at its first line.
const COUNT_RESET =
  'p(oop)stack could not read a saved commit-joke count, so it started that count again.';
// $.store, machine-wide: whether the first-run toast has been shown at the end of a turn he
// typed. `firstRunShown`, the key of c938bc3, counted any turn (a cache nudge's included); it is
// removed when this one is written.
const FIRST_RUN = 'firstRunSeen';
const FIRST_RUN_BEFORE = 'firstRunShown';

// Set at each load's session.start; a reload starts them over.
let isInteractive = false;
let isFirstRunChecked = false;
// Set by a prompt he typed (`prompt.submit` from the composer); read at that turn's end.
let isTypedTurn = false;
const owned = new Set<string>();
const constants = new Map<number, number>();

// The main turn whose closing line is being paired (feature row 2): the phrase its spinner was
// given, and two facts that arrive in either order, the uuid of its `turn_duration` row (the
// line's requestId, FINDINGS 1) and why it ended. Each stage holds exactly the facts known so
// far; once both are known the line is settled at once and the pairing ends, so no stage holds
// both. A reload mid-turn loses it, and that line then keeps Claude Code's own word.
type Pairing =
  | {
      readonly stage: 'waiting';
      readonly turnId: string;
      readonly phrase: string | null;
    }
  | {
      readonly stage: 'row-seen';
      readonly turnId: string;
      readonly phrase: string | null;
      readonly uuid: string;
    }
  | {
      readonly stage: 'reason-known';
      readonly turnId: string;
      readonly phrase: string | null;
      readonly reason: TurnCompleteReason;
    };
let pairing: Pairing | null = null;
// Set when a main turn starts while the turn before it still waits for its `turn_duration` row:
// a prompt typed during a turn starts the next one at once, and no row names its turn
// (SessionAppendInput), so the next row could be either turn's. That row is left to Claude Code,
// and so is the earlier turn's line. It holds the earlier turn's id: an interrupted turn draws no row
// (FINDINGS 13), so its interruption clears it.
let ambiguousAfter: string | null = null;

// Set the moment `/poopstack off` starts, before any of its awaits, and checked right before each
// toast and store write: a joke already in flight when off arrives (an await between its own off
// check and its effect) then ends there. `$.state`'s off is the durable record; this is the
// synchronous one. A reload starts it over, and the reloaded module reads `$.state`'s off.
let isStopped = false;

// Every check reads the flag through this call. TypeScript narrows a module `let` across an
// `await` as if nothing else could set it, so a second check written as a bare read looks "always
// false" to the type checker, and to the lint rule built on it, though off may have arrived meanwhile.
function isStoppedNow(): boolean {
  return isStopped;
}

// Whether the mod may joke in this session at all: enabled in /config, in an interactive session.
// `/poopstack off` is read separately (`isOff`), since it needs an await.
function isActive(settings: Settings): boolean {
  return settings.isEnabled && isInteractive;
}

// The two negations, each a named step, for the checks that leave early.
function isNotActive(settings: Settings): boolean {
  const isOn = isActive(settings);
  return !isOn;
}

function isNotStoppedNow(): boolean {
  const isStoppedAtThisMoment = isStoppedNow();
  return !isStoppedAtThisMoment;
}

// A queue runs its work one at a time: two Bash calls can end together, and each step awaits the
// engine between its read and its write. Work a queue runs never queues more on the same queue
// (it would wait for itself).
type Queue = <T>(work: () => Promise<T>) => Promise<T>;
function makeQueue(): Queue {
  let tail: Promise<void> = Promise.resolve();
  async function queued<T>(work: () => Promise<T>): Promise<T> {
    const run = tail.then(work);
    // The caller holds `run` and meets its failure there; the queue only waits for it to settle.
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  return queued;
}
// The dice, the bag and the closing-line pairing: every turn hook's read-then-write.
const serial = makeQueue();
// The commit counts in $.store, on a queue of their own, so a slow store never holds a turn's
// hooks (Codex recheck finding 1).
const serialCount = makeQueue();

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`poopstack: $.state ${name} is unset after the session was set up`);
  }
  return value;
}

function constantFor(rate: number): number {
  const held = constants.get(rate);
  if (held !== undefined) {
    return held;
  }
  const constant = prdConstant(rate);
  constants.set(rate, constant);
  return constant;
}

// The dice constant for main turns, and the one for matched lines (commits and outcomes).
function turnConstant(settings: Settings): number {
  const rate = turnRate(settings);
  return constantFor(rate);
}

function matchedConstant(settings: Settings): number {
  const rate = matchedRate(settings);
  return constantFor(rate);
}

async function isOff($: EngineInterface): Promise<boolean> {
  const isOffRead = await $.state.get(IS_OFF);
  return isOffRead.value === true;
}

// --- the turn's phrase -------------------------------------------------------------------------

// Rolls the dice for the next main turn and, on a hit, draws its phrase from the bag. The engine
// samples the spinner's word before `turn.start` fires, so the choice is made a turn ahead.
async function drawTurn($: EngineInterface, settings: Settings): Promise<void> {
  const rngRead = await $.state.get(RNG);
  const rng = need(rngRead.value, 'rng');
  const turnMissesRead = await $.state.get(TURN_MISSES);
  const misses = need(turnMissesRead.value, 'turnMisses');
  const dice = nextRandom(rng);
  const constant = turnConstant(settings);
  const result = roll(constant, misses, dice.value);
  let { state } = dice;
  let phrase: string | null = null;
  if (result.isHit) {
    const bagRead = await $.state.get(BAG);
    const bag = need(bagRead.value, 'bag');
    const phraseRead = await $.state.get(PHRASE);
    const last = phraseRead.value ?? null;
    const entries = poolFor(settings.preset);
    const pool = entries.map((entry) => entry.working);
    const drawn = drawPhrase(bag, pool, last, state);
    await $.state.set(BAG, drawn.bag);
    phrase = drawn.phrase;
    state = drawn.state;
  }
  await $.state.set(TURN_MISSES, result.misses);
  await $.state.set(PHRASE, phrase);
  await $.state.set(RNG, state);
}

// The first load in a session seeds the generator and warm-starts both dice.
async function ensureSession($: EngineInterface, settings: Settings): Promise<void> {
  const rngRead = await $.state.get(RNG);
  if (rngRead.value !== undefined) {
    return;
  }
  const sessionId = await $.session.id();
  const now = await $.clock.now();
  const sessionHash = hashId(sessionId);
  const mixed = sessionHash ^ now;
  const seed = mixed >>> 0;
  const turnDice = nextRandom(seed);
  const commitDice = nextRandom(turnDice.state);
  const turnConstantNow = turnConstant(settings);
  const turnMisses = warmMisses(turnConstantNow, turnDice.value);
  await $.state.set(TURN_MISSES, turnMisses);
  const commitConstant = matchedConstant(settings);
  const commitMisses = warmMisses(commitConstant, commitDice.value);
  await $.state.set(COMMIT_MISSES, commitMisses);
  await $.state.set(BAG, []);
  await $.state.set(RNG, commitDice.state);
  await drawTurn($, settings);
}

// The outcome dice joined after the others (decision 47), so a session that began under an
// earlier version of the mod meets this one with the generator set and these misses unset. This
// is the only place they are set, for a new session too, so the interrupted-turn tests cover it.
async function ensureOutcomeDice($: EngineInterface, settings: Settings): Promise<void> {
  const outcomeMissesRead = await $.state.get(OUTCOME_MISSES);
  if (outcomeMissesRead.value !== undefined) {
    return;
  }
  const rngRead = await $.state.get(RNG);
  const rng = need(rngRead.value, 'rng');
  const dice = nextRandom(rng);
  const constant = matchedConstant(settings);
  const misses = warmMisses(constant, dice.value);
  await $.state.set(OUTCOME_MISSES, misses);
  await $.state.set(RNG, dice.state);
}

// The session's generator, dice and bag, each set once. `session.start` sets them; a /clear goes on
// under a new session id with no `session.start` (the types, at `session.end`), so each main turn's
// start sets them too when they are missing; every commit and turn end comes after one. Once set,
// nothing changes.
async function ensureReady($: EngineInterface, settings: Settings): Promise<void> {
  await ensureSession($, settings);
  await ensureOutcomeDice($, settings);
}

// A /config change reloads the module; one that turns `enabled` back on clears a session's off.
async function reconcileOff($: EngineInterface, settings: Settings): Promise<void> {
  const wasEnabledRead = await $.state.get(WAS_ENABLED);
  const wasEnabled = wasEnabledRead.value;
  const wasTurnedOffBefore = wasEnabled === false;
  if (settings.isEnabled && wasTurnedOffBefore) {
    await $.state.set(IS_OFF, false);
  }
  await $.state.set(WAS_ENABLED, settings.isEnabled);
}

// --- what the two lines draw -------------------------------------------------------------------

async function spinnerPhrase(
  $: EngineInterface,
  settings: Settings,
  surface: RenderSurface,
  props: Readonly<RenderPropsOf['Spinner']>,
): Promise<string | null> {
  const hasEngineMessage = props.message !== null;
  if (isNotActive(settings) || hasEngineMessage) {
    return null;
  }
  // Off the terminal the word is the step's own text; only the bare "Working" is replaced.
  const isOffTerminal = surface !== 'terminal';
  const isStepText = props.word !== 'Working';
  if (isOffTerminal && isStepText) {
    return null;
  }
  const isOffForSession = await isOff($);
  if (isOffForSession) {
    return null;
  }
  const phraseRead = await $.state.get(PHRASE);
  const phrase = phraseRead.value ?? null;
  const pool = poolFor(settings.preset);
  const isStillShown = pool.some((entry) => entry.working === phrase);
  if (!isStillShown || isStoppedNow()) {
    return null;
  }
  return phrase;
}

// The spinner as the engine will draw it: with the turn's phrase as its word, or unchanged.
async function spinnerInput(
  $: EngineInterface,
  settings: Settings,
  e: RenderInput<'Spinner'>,
): Promise<RenderInput<'Spinner'>> {
  const phrase = await spinnerPhrase($, settings, e.surface, e.props);
  if (phrase === null) {
    return e;
  }
  const props = { ...e.props, word: phrase };
  return { ...e, props };
}

// The word a closing line was given when its turn was paired, if the preset in force now may
// show it; null for a line never paired (a plain turn, or a line drawn before the mod loaded)
// and for a word a tamer preset would not show: that line keeps Claude Code's word. An expanded
// line and one waiting for agents (the line's props) keep Claude Code's word too.
async function closingWord(
  $: EngineInterface,
  settings: Settings,
  e: RenderInput<'TurnDuration'>,
): Promise<string | null> {
  const isExpanded = e.props.isExpanded === true;
  const isWaiting = e.props.waitingFor !== undefined;
  const isExpandedOrWaiting = isExpanded || isWaiting;
  if (isNotActive(settings) || isExpandedOrWaiting) {
    return null;
  }
  const isOffForSession = await isOff($);
  if (isOffForSession) {
    return null;
  }
  const closingWordRead = await $.state.get({ ...CLOSING_WORD, id: e.requestId });
  const word = closingWordRead.value;
  const isUnpaired = word === undefined;
  if (isUnpaired || isStoppedNow()) {
    return null;
  }
  const isAllowedNow = isShownNow(word, settings.preset);
  return isAllowedNow ? word : null;
}

// Claude Code's own closing line, as drawn with the paired word, and the label after it (feature
// row 8) unless the line refuses one or the measured width would wrap it. The engine's line fills
// its row, a box around it did not shrink it, and it opens with a blank row (his screenshots,
// 2026-10-28), so the label sits at the right end of the closing line: aligned to the row's bottom,
// in a box that does not shrink, so it stays whole.
function withLabel(
  $: EngineInterface,
  e: RenderInput<'TurnDuration'>,
  drawn: RenderElement,
  word: string,
  preset: Preset,
): RenderElement {
  const label = footerLabel(word, preset);
  if (label === null) {
    return drawn;
  }
  const columns = e.viewport?.columns;
  const canFit = labelFits(columns, word, label);
  if (!canFit) {
    return drawn;
  }
  const { Box, Text } = $.ui.resolve(e);
  const labelText = `${LABEL_GAP}${label}`;
  return (
    <Box alignItems="flex-end">
      {drawn}
      <Box flexShrink={0}>
        <Text dimColor>{labelText}</Text>
      </Box>
    </Box>
  );
}

// --- the commit line ---------------------------------------------------------------------------

async function rollCommit($: EngineInterface, settings: Settings): Promise<boolean> {
  if (isNotActive(settings)) {
    return false;
  }
  const isOffForSession = await isOff($);
  if (isOffForSession) {
    return false;
  }
  const rngRead = await $.state.get(RNG);
  const rng = need(rngRead.value, 'rng');
  const commitMissesRead = await $.state.get(COMMIT_MISSES);
  const misses = need(commitMissesRead.value, 'commitMisses');
  const dice = nextRandom(rng);
  const constant = matchedConstant(settings);
  const result = roll(constant, misses, dice.value);
  await $.state.set(RNG, dice.state);
  await $.state.set(COMMIT_MISSES, result.misses);
  return result.isHit;
}

async function countAndShow($: EngineInterface, settings: Settings): Promise<void> {
  const sessionId = await $.session.id();
  const key = commitCountKey(sessionId);
  const stored = await $.store.get(key);
  const held = readCount(stored);
  const shown = held.kind === 'count' ? held.count.shown : 0;
  const at = await $.clock.now();
  if (isStoppedNow()) {
    return;
  }
  const shownNow = shown + 1;
  await $.store.set(key, { shown: shownNow, at });
  if (isStoppedNow()) {
    return;
  }
  if (held.kind === 'malformed') {
    $.ui.toast(COUNT_RESET);
  }
  const line = commitLine(shown, settings.preset);
  $.ui.toast(line);
}

// The commit line, after the Bash call's result: its dice on the turn queue (state only, quick),
// then its count and toast on the count queue.
async function commitJoke($: EngineInterface, settings: Settings): Promise<void> {
  const isHit = await serial(async () => rollCommit($, settings));
  if (isHit) {
    await serialCount(async () => countAndShow($, settings));
  }
}

// The commit line's bookkeeping takes about eight engine calls, 30 to 50 ms on a joked commit
// (timed once on 2026-10-28, a store write 18.5 ms), so it follows the tool's result instead of
// holding it (Codex review finding 1). No hook awaits it, so a failure would reach no one: it is
// logged as a dim transcript line naming the mod, never sent to the model.
function afterTheCall($: EngineInterface, work: Promise<void>): void {
  work.catch((error: unknown) => {
    $.ui.log(`p(oop)stack: the commit line failed: ${String(error)}`);
  });
}

// A Bash call's result, which the engine let through: a commit it made starts the commit line.
function noticeCommit($: EngineInterface, settings: Settings, callResult: unknown): void {
  const kind = commitKind(callResult);
  if (kind === null) {
    return;
  }
  const work = commitJoke($, settings);
  afterTheCall($, work);
}

// --- the interrupted turn ----------------------------------------------------------------------

// The outcome lines (interrupted, error) share one set of dice at the matched rate, in regular
// and maximum only; false when the mod is off or the preset is discreet.
async function rollOutcome($: EngineInterface, settings: Settings): Promise<boolean> {
  const isDiscreet = settings.preset === 'discreet';
  if (isNotActive(settings) || isDiscreet) {
    return false;
  }
  const isOffForSession = await isOff($);
  if (isOffForSession) {
    return false;
  }
  const rngRead = await $.state.get(RNG);
  const rng = need(rngRead.value, 'rng');
  const outcomeMissesRead = await $.state.get(OUTCOME_MISSES);
  const misses = need(outcomeMissesRead.value, 'outcomeMisses');
  const dice = nextRandom(rng);
  const constant = matchedConstant(settings);
  const result = roll(constant, misses, dice.value);
  await $.state.set(RNG, dice.state);
  await $.state.set(OUTCOME_MISSES, result.misses);
  return result.isHit;
}

// An interrupted turn draws no closing line (FINDINGS 13), so his line is a toast; Claude Code's
// own interrupt row stays as it is.
async function abortedJoke($: EngineInterface, settings: Settings): Promise<void> {
  const isHit = await rollOutcome($, settings);
  if (isHit && isNotStoppedNow()) {
    $.ui.toast(ABORTED_LINE);
  }
}

// --- the first run on this machine -------------------------------------------------------------

async function firstRun($: EngineInterface, settings: Settings): Promise<void> {
  if (isFirstRunChecked || isNotActive(settings)) {
    return;
  }
  const isOffForSession = await isOff($);
  if (isOffForSession) {
    return;
  }
  isFirstRunChecked = true;
  const firstRunStored = await $.store.get(FIRST_RUN);
  const isSeenBefore = firstRunStored === true;
  if (isSeenBefore || isStoppedNow()) {
    return;
  }
  await $.store.set(FIRST_RUN, true);
  if (isStoppedNow()) {
    return;
  }
  await $.store.delete(FIRST_RUN_BEFORE);
  if (isStoppedNow()) {
    return;
  }
  const rate = turnRate(settings);
  const rateText = describeRate(rate);
  $.ui.toast(`Sanitized for your protection. Jokes on ${rateText}; /poop off stops them.`);
}

// --- the closing line, paired with its turn (feature row 2) ------------------------------------

// What a paired line says. The past form of the turn's own phrase when it answered; "Refused"
// in its place when it was refused; the error line on the outcome dice when an API error ended
// it; nothing (Claude Code's word) after an interrupt, on a plain turn, or when the mod is off.
async function pairedWord(
  $: EngineInterface,
  settings: Settings,
  phrase: string | null,
  reason: TurnCompleteReason,
): Promise<string | null> {
  if (reason === 'error') {
    const isHit = await rollOutcome($, settings);
    return isHit ? ERROR_WORD : null;
  }
  if (isNotActive(settings)) {
    return null;
  }
  const isOffForSession = await isOff($);
  if (isOffForSession) {
    return null;
  }
  const done = doneFor(phrase, settings.preset);
  if (done === null) {
    return null;
  }
  if (reason === 'aborted') {
    return null;
  }
  return reason === 'refusal' ? REFUSED_WORD : done;
}

// Both facts are known: the pairing ends here, before any await, and the word is written. The
// line usually draws after both (186 of 191 lines in the probe's logs); a line that drew first is
// redrawn by the write, or, if the engine does not redraw it, keeps Claude Code's word.
async function settleClosing(
  $: EngineInterface,
  settings: Settings,
  phrase: string | null,
  uuid: string,
  reason: TurnCompleteReason,
): Promise<void> {
  pairing = null;
  const word = await pairedWord($, settings, phrase, reason);
  if (word !== null) {
    await $.state.set({ ...CLOSING_WORD, id: uuid }, word);
  }
}

// Whether a turn still waits for the `turn_duration` row its closing line draws for. An
// interrupted turn draws none (FINDINGS 13), so it waits for nothing.
function isAwaitingRow(held: Pairing): boolean {
  switch (held.stage) {
    case 'waiting':
      return true;
    case 'row-seen':
      return false;
    case 'reason-known':
      return held.reason !== 'aborted';
  }
}

async function startPairing($: EngineInterface, turnId: string): Promise<void> {
  const held = pairing;
  const isHeld = held !== null;
  if (isHeld && isAwaitingRow(held)) {
    ambiguousAfter = held.turnId;
  }
  const phraseRead = await $.state.get(PHRASE);
  const phrase = phraseRead.value ?? null;
  pairing = { stage: 'waiting', turnId, phrase };
}

// A main loop `turn_duration` row: the uuid its closing line draws for.
async function noteDurationRow(
  $: EngineInterface,
  settings: Settings,
  uuid: string,
): Promise<void> {
  if (ambiguousAfter !== null) {
    ambiguousAfter = null;
    return;
  }
  const held = pairing;
  if (held === null) {
    return;
  }
  switch (held.stage) {
    case 'waiting':
      pairing = { stage: 'row-seen', turnId: held.turnId, phrase: held.phrase, uuid };
      return;
    case 'reason-known':
      await settleClosing($, settings, held.phrase, uuid, held.reason);
      return;
    case 'row-seen':
      // The turn already has its row; a second one before its end is not this line's.
      return;
  }
}

// The main turn ended: why it ended.
async function noteTurnEnd(
  $: EngineInterface,
  settings: Settings,
  turnId: string,
  reason: TurnCompleteReason,
): Promise<void> {
  const held = pairing;
  if (held === null) {
    return;
  }
  if (held.turnId !== turnId) {
    return;
  }
  switch (held.stage) {
    case 'waiting':
    case 'reason-known':
      pairing = { stage: 'reason-known', turnId, phrase: held.phrase, reason };
      return;
    case 'row-seen':
      await settleClosing($, settings, held.phrase, held.uuid, reason);
      return;
  }
}

// The end of a main turn: the interrupted-turn toast, the closing line's pairing, the next
// turn's phrase, and the first-run toast after a turn he typed.
async function endMainTurn(
  $: EngineInterface,
  settings: Settings,
  e: TurnCompleteInput,
): Promise<void> {
  const wasTyped = isTypedTurn;
  isTypedTurn = false;
  const isAborted = e.reason === 'aborted';
  if (isAborted) {
    await abortedJoke($, settings);
  }
  const isAmbiguousTurn = e.turnId === ambiguousAfter;
  if (isAborted && isAmbiguousTurn) {
    ambiguousAfter = null;
  }
  await noteTurnEnd($, settings, e.turnId, e.reason);
  await drawTurn($, settings);
  if (wasTyped) {
    await firstRun($, settings);
  }
}

// One stored commit count, read and checked, beside its key.
type KeyedCount = { readonly key: string; readonly held: StoredCount };

async function readStoredCount($: EngineInterface, key: string): Promise<KeyedCount> {
  const stored = await $.store.get(key);
  const held = readCount(stored);
  return { key, held };
}

// Which counts to remove: the ones that cannot be read, and the ones untouched past the bound.
function countsToRemove(
  counts: readonly KeyedCount[],
  now: number,
): { readonly malformed: readonly string[]; readonly stale: readonly string[] } {
  const malformed: string[] = [];
  const stale: string[] = [];
  for (const { key, held } of counts) {
    if (held.kind === 'malformed') {
      malformed.push(key);
    }
    const isCountKind = held.kind === 'count';
    if (isCountKind && isStale(held.count, now)) {
      stale.push(key);
    }
  }
  return { malformed, stale };
}

// Removes the commit counts of sessions untouched past the keep bound (hooks/commits.ts), and any
// count it cannot read, saying so once: deleted, a malformed value cannot be met again.
async function pruneCommitCounts($: EngineInterface, settings: Settings): Promise<void> {
  if (isNotActive(settings)) {
    return;
  }
  const isOffForSession = await isOff($);
  if (isOffForSession) {
    return;
  }
  const now = await $.clock.now();
  const storeKeys = await $.store.keys();
  const countKeys = storeKeys.filter((key) => key.startsWith(COMMIT_COUNT_PREFIX));
  const reads = countKeys.map(async (key) => readStoredCount($, key));
  const counts = await Promise.all(reads);
  const { malformed, stale } = countsToRemove(counts, now);
  if (isStoppedNow()) {
    return;
  }
  const toDelete = [...malformed, ...stale];
  const deletions = toDelete.map(async (key) => $.store.delete(key));
  await Promise.all(deletions);
  const hasMalformed = malformed.length > 0;
  if (hasMalformed && isNotStoppedNow()) {
    $.ui.toast(COUNT_RESET);
  }
}

// A session's start, after the engine's: the off state, the dice, then the commit counts' pruning.
async function setUpSession($: EngineInterface, settings: Settings): Promise<void> {
  await reconcileOff($, settings);
  await ensureReady($, settings);
  await pruneCommitCounts($, settings);
}

// A main turn's start: the session's dice when a /clear left them unset, then its pairing.
async function startMainTurn(
  $: EngineInterface,
  settings: Settings,
  turnId: string,
): Promise<void> {
  await ensureReady($, settings);
  await startPairing($, turnId);
}

// --- the command -------------------------------------------------------------------------------

// A command's answer. `exitCode` reaches only a headless run whose whole prompt was the command
// (`claude -p "/poopstack off"`); 1 says it did not do all it was asked: a setting not saved as
// asked, or a failure inside the mod.
type Answer = { readonly text: string; readonly exitCode?: number };
const FAILED_EXIT = 1;
const OFF_STATUS = 'Off. /poopstack on turns the jokes back on.';

// Changes one of this plugin's /config rows; the engine reloads the module with the new value.
// Null when the row now holds the value asked for; otherwise why not: refused, or saved as
// something else (a config hook may change a value on its way in).
async function setOption(
  $: EngineInterface,
  field: string,
  value: boolean | string,
): Promise<string | null> {
  const rows = await $.config.list();
  const row = rows.find((candidate) => isOwnRow(candidate, $.plugin.name, field));
  if (row === undefined) {
    return `Claude Code lists no /config row for ${$.plugin.name}.${field} here, as for a mod loaded from a session's mods folder`;
  }
  const outcome = await $.config.set({ key: row.key, value });
  if (outcome.deny !== undefined) {
    return outcome.deny;
  }
  if (outcome.value === value) {
    return null;
  }
  const savedValueText = JSON.stringify(outcome.value);
  return `it was saved as ${savedValueText}`;
}

async function turnOff($: EngineInterface): Promise<Answer> {
  isStopped = true;
  await $.state.set(IS_OFF, true);
  const problem = await setOption($, 'enabled', false);
  if (problem !== null) {
    return {
      text: `Jokes stopped for this session only: the setting was not saved (${problem}).`,
      exitCode: FAILED_EXIT,
    };
  }
  return { text: "Off. Claude Code's own words are back; /poopstack on brings the jokes back." };
}

async function turnOn($: EngineInterface, settings: Settings): Promise<Answer> {
  isStopped = false;
  await $.state.set(IS_OFF, false);
  if (!settings.isEnabled) {
    const problem = await setOption($, 'enabled', true);
    if (problem !== null) {
      return {
        text: `Not turned on: the setting was not saved (${problem}).`,
        exitCode: FAILED_EXIT,
      };
    }
  }
  const rate = turnRate(settings);
  const rateText = describeRate(rate);
  return { text: `On. Jokes on ${rateText} (${settings.preset}).` };
}

async function setPreset($: EngineInterface, settings: Settings, preset: Preset): Promise<Answer> {
  const problem = await setOption($, 'preset', preset);
  if (problem !== null) {
    return { text: `The preset stays ${settings.preset}: ${problem}.`, exitCode: FAILED_EXIT };
  }
  const chosen = { ...settings, preset };
  const rate = turnRate(chosen);
  const rateText = describeRate(rate);
  return { text: `Preset is now ${preset}: jokes on ${rateText}.` };
}

async function statusText($: EngineInterface, settings: Settings): Promise<string> {
  if (!settings.isEnabled) {
    return OFF_STATUS;
  }
  const isOffForSession = await isOff($);
  if (isOffForSession) {
    return OFF_STATUS;
  }
  const rate = turnRate(settings);
  const rateText = describeRate(rate);
  return `On · ${settings.preset} · jokes on ${rateText}.`;
}

async function answer($: EngineInterface, settings: Settings, args: string): Promise<Answer> {
  const trimmed = args.trim();
  const verb = trimmed.toLowerCase();
  const isBare = verb === '';
  const isStatus = verb === 'status';
  if (isBare || isStatus) {
    const text = await statusText($, settings);
    return { text };
  }
  if (verb === 'off') {
    return turnOff($);
  }
  if (verb === 'on') {
    return turnOn($, settings);
  }
  if (isPreset(verb)) {
    return setPreset($, settings, verb);
  }
  return {
    text: `Unknown word "${verb}". Try on, off, discreet, regular, maximum, poopmaxxing or status.`,
  };
}

// Whether a listed command is this plugin's own registration of `command`.
function isOwnEntry(entry: CommandInfo, command: string, plugin: string): boolean {
  const isSameName = entry.name === command;
  const isFromPlugin = entry.source === 'plugin';
  const isThisPlugin = entry.plugin === plugin;
  return isSameName && isFromPlugin && isThisPlugin;
}

// The answer to one of the mod's own names, or null for a name another plugin holds.
// Whether a name is this plugin's, read from the command list when the command runs. Names
// registered during session.start are listed only after it ends (measured 2026-10-28: the list
// held none of the five right after their registrations resolved, so an installed copy answered
// none of its commands), so the list at session.start cannot settle it. `owned` keeps the answer
// for the commands' catch, which cannot wait for the list.
async function isOwnCommand($: EngineInterface, command: string): Promise<boolean> {
  const listed = await $.command.list();
  const isOwn = listed.some((entry) => isOwnEntry(entry, command, $.plugin.name));
  if (isOwn) {
    owned.add(command);
  } else {
    owned.delete(command);
  }
  return isOwn;
}

// The body of each command hook: the mod's answer to its own name, or the event passed on to
// the plugin that holds the name. The engine takes a hook only as a function written inside the
// `on(...)` call or declared at the top of the file (the validator refused a `const` inside
// `register`, 2026-10-29), so each of the five hooks spells out its call to this one.
async function answerOrPass<E extends { readonly command: string; readonly args: string }, R>(
  $: EngineInterface,
  settings: Settings,
  e: E,
  next: (e: E) => Promise<R>,
): Promise<R | Answer> {
  const isOwn = await isOwnCommand($, e.command);
  if (!isOwn) {
    return next(e);
  }
  return answer($, settings, e.args);
}

const DESCRIPTION = 'p(oop)stack: on, off, discreet, regular, maximum, poopmaxxing, or status';
const FAILED =
  'The command failed inside p(oop)stack (the transcript names the error); /poopstack status shows where it stands.';
const HINT = '[on|off|discreet|regular|maximum|poopmaxxing|status]';

// The catch of each command hook: a failure inside the mod's own command says so, and fails a
// headless run, instead of passing on; a name the mod does not hold passes on to its owner.
async function failedOrPass<E extends { readonly command: string }, R>(
  _$: unknown,
  e: E,
  next: (e: E) => Promise<R>,
): Promise<R | Answer> {
  if (owned.has(e.command)) {
    return { text: FAILED, exitCode: FAILED_EXIT };
  }
  return next(e);
}

// The catch of every other hook: whatever failed, the event goes on unchanged.
async function passOn<E, R>(_$: unknown, e: E, next: (e: E) => Promise<R>): Promise<R> {
  return next(e);
}

// Each visible name (decision 35) is registered by its literal name. A name the command list shows
// held by another plugin, when the command runs, is left to its owner (`isOwnCommand`).
async function registerCommands($: EngineInterface): Promise<void> {
  const registrations = [
    $.command.register({
      name: 'poopstack',
      description: DESCRIPTION,
      argumentHint: HINT,
      immediate: true,
    }),
    $.command.register({
      name: 'poop',
      description: DESCRIPTION,
      argumentHint: HINT,
      immediate: true,
    }),
    $.command.register({
      name: 'commode',
      description: DESCRIPTION,
      argumentHint: HINT,
      immediate: true,
    }),
    $.command.register({
      name: 'porcelain',
      description: DESCRIPTION,
      argumentHint: HINT,
      immediate: true,
    }),
    $.command.register({
      name: 'agentic-outhouse',
      description: DESCRIPTION,
      argumentHint: HINT,
      immediate: true,
    }),
  ];
  await Promise.allSettled(registrations);
}

// One hook per visible name, each matched by its literal name (the catch: `failedOrPass`). A
// top-level helper that receives `on` keeps `register` under Biome's 75-line cap (decision 82);
// the engine accepts hooks written inside the `on(...)` call here as in `register`.
function hookCommands(on: On, settings: Settings): void {
  on('command.run', { command: 'poopstack' }, async ($, e, next) =>
    answerOrPass($, settings, e, next),
  ).catch(failedOrPass);
  on('command.run', { command: 'poop' }, async ($, e, next) =>
    answerOrPass($, settings, e, next),
  ).catch(failedOrPass);
  on('command.run', { command: 'commode' }, async ($, e, next) =>
    answerOrPass($, settings, e, next),
  ).catch(failedOrPass);
  on('command.run', { command: 'porcelain' }, async ($, e, next) =>
    answerOrPass($, settings, e, next),
  ).catch(failedOrPass);
  on('command.run', { command: 'agentic-outhouse' }, async ($, e, next) =>
    answerOrPass($, settings, e, next),
  ).catch(failedOrPass);
}

// Whether an appended row is the main loop's `turn_duration` notice, the row a closing line
// draws for. Each check leaves early, so `name` is read only on a system row.
function isMainDurationRow(e: SessionAppendInput): boolean {
  if (e.agentId !== undefined) {
    return false;
  }
  if (e.message.type !== 'system') {
    return false;
  }
  return e.message.name === 'turn_duration';
}

export const register: Register = (on, options) => {
  const settings = readSettings(options);

  on('session.start', async ($, e, next) => {
    await registerCommands($);
    const result = await next(e);
    isInteractive = e.isInteractive;
    await serial(async () => setUpSession($, settings));
    return result;
  }).catch(passOn);

  // An observer: notes the phrase a main turn starts with, for its closing line.
  on('turn.start', async ($, e, next) => {
    const result = await next(e);
    if (e.agentId === undefined) {
      await serial(async () => startMainTurn($, settings, e.turnId));
    }
    return result;
  }).catch(passOn); // `next` is replay-safe here: a settled call is not re-run

  // An observer: the main loop's `turn_duration` notice is the row its closing line draws for.
  on('session.append', { door: 'notice' }, async ($, e, next) => {
    const result = await next(e);
    if (isMainDurationRow(e)) {
      await serial(async () => noteDurationRow($, settings, e.uuid));
    }
    return result;
  }).catch(passOn); // `next` is replay-safe here: a settled call is not re-run

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (e.agentId === undefined) {
      await serial(async () => endMainTurn($, settings, e));
    }
    return result;
  }).catch(passOn);

  // An observer: the prompt goes on unchanged; only where it came from is noted.
  on('prompt.submit', async (_$, e, next) => {
    const result = await next(e);
    const isComposer = e.origin.kind === 'composer';
    const isMeta = e.isMeta === true;
    if (isComposer && !isMeta) {
      isTypedTurn = true;
    }
    return result;
  }).catch(passOn); // `next` is replay-safe here: a settled call is not re-run

  // An observer: the result returns unchanged, at once; the commit line follows (`afterTheCall`).
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e);
    if (result.deny === undefined) {
      noticeCommit($, settings, result.result);
    }
    return result;
  }).catch(passOn); // `next` is replay-safe here: a settled call is not re-run

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const input = await spinnerInput($, settings, e);
    return next(input);
  }).catch(passOn);

  // A joked line keeps Claude Code's own text (its true duration and time) with the label after
  // it, left off where the measured width would wrap. The engine raises TurnDuration on the
  // terminal only (its types), so design item 10 needs no surface check here.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const word = await closingWord($, settings, e);
    if (word === null) {
      return next(e);
    }
    const props = { ...e.props, word };
    const drawn = await next({ ...e, props });
    return withLabel($, e, drawn, word, settings.preset);
  }).catch(passOn);

  hookCommands(on, settings);
};
