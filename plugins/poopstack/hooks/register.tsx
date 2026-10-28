import type {
  EngineInterface,
  Register,
  RenderElement,
  RenderInput,
  RenderPropsOf,
  RenderSurface,
  TurnCompleteInput,
  TurnCompleteReason,
} from 'claude-code';
import { COMMIT_COUNT_PREFIX, commitCountKey, isStale, shownSoFar } from './commits';
import { commitKind } from './git';
import {
  describeRate,
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

const IS_OFF = { plugin: 'poopstack', key: 'isOff' } as const;
const WAS_ENABLED = { plugin: 'poopstack', key: 'wasEnabled' } as const;
const RNG = { plugin: 'poopstack', key: 'rng' } as const;
const PHRASE = { plugin: 'poopstack', key: 'phrase' } as const;
const BAG = { plugin: 'poopstack', key: 'bag' } as const;
const TURN_MISSES = { plugin: 'poopstack', key: 'turnMisses' } as const;
const COMMIT_MISSES = { plugin: 'poopstack', key: 'commitMisses' } as const;
const OUTCOME_MISSES = { plugin: 'poopstack', key: 'outcomeMisses' } as const;
const CLOSING_WORD = { plugin: 'poopstack', key: 'closingWord' } as const;

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
// line's requestId, FINDINGS 1) and why it ended. A reload mid-turn loses it, and that line
// then keeps Claude Code's own word.
type Pairing = {
  readonly turnId: string;
  readonly phrase: string | null;
  uuid: string | null;
  reason: TurnCompleteReason | null;
};
let pairing: Pairing | null = null;

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

async function isOff($: EngineInterface): Promise<boolean> {
  return (await $.state.get(IS_OFF)).value === true;
}

// --- the turn's phrase -------------------------------------------------------------------------

// Rolls the dice for the next main turn and, on a hit, draws its phrase from the bag. The engine
// samples the spinner's word before `turn.start` fires, so the choice is made a turn ahead.
async function drawTurn($: EngineInterface, settings: Settings): Promise<void> {
  const rng = need((await $.state.get(RNG)).value, 'rng');
  const misses = need((await $.state.get(TURN_MISSES)).value, 'turnMisses');
  const dice = nextRandom(rng);
  const result = roll(constantFor(turnRate(settings)), misses, dice.value);
  let state = dice.state;
  let phrase: string | null = null;
  if (result.isHit) {
    const bag = need((await $.state.get(BAG)).value, 'bag');
    const last = (await $.state.get(PHRASE)).value ?? null;
    const pool = poolFor(settings.preset).map((entry) => entry.working);
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
  if ((await $.state.get(RNG)).value !== undefined) {
    return;
  }
  const seed = (hashId(await $.session.id()) ^ (await $.clock.now())) >>> 0;
  const turnDice = nextRandom(seed);
  const commitDice = nextRandom(turnDice.state);
  await $.state.set(TURN_MISSES, warmMisses(constantFor(turnRate(settings)), turnDice.value));
  await $.state.set(
    COMMIT_MISSES,
    warmMisses(constantFor(matchedRate(settings)), commitDice.value),
  );
  await $.state.set(BAG, []);
  await $.state.set(RNG, commitDice.state);
  await drawTurn($, settings);
}

// The outcome dice joined after the others (decision 47), so a session that began under an
// earlier version of the mod meets this one with the generator set and these misses unset. This
// is the only place they are set, for a new session too, so the interrupted-turn tests cover it.
async function ensureOutcomeDice($: EngineInterface, settings: Settings): Promise<void> {
  if ((await $.state.get(OUTCOME_MISSES)).value !== undefined) {
    return;
  }
  const rng = need((await $.state.get(RNG)).value, 'rng');
  const dice = nextRandom(rng);
  await $.state.set(OUTCOME_MISSES, warmMisses(constantFor(matchedRate(settings)), dice.value));
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
  const wasEnabled = (await $.state.get(WAS_ENABLED)).value;
  if (settings.isEnabled && wasEnabled === false) {
    await $.state.set(IS_OFF, false);
  }
  await $.state.set(WAS_ENABLED, settings.isEnabled);
}

// --- what the two lines draw -------------------------------------------------------------------

async function spinnerPhrase(
  $: EngineInterface,
  settings: Settings,
  surface: RenderSurface,
  props: RenderPropsOf['Spinner'],
): Promise<string | null> {
  if (!(settings.isEnabled && isInteractive) || props.message !== null) {
    return null;
  }
  // Off the terminal the word is the step's own text; only the bare "Working" is replaced.
  if (surface !== 'terminal' && props.word !== 'Working') {
    return null;
  }
  if (await isOff($)) {
    return null;
  }
  const phrase = (await $.state.get(PHRASE)).value ?? null;
  const isStillShown = poolFor(settings.preset).some((entry) => entry.working === phrase);
  return isStillShown ? phrase : null;
}

// The word a closing line was given when its turn was paired, if the preset in force now may
// show it; null for a line never paired (a plain turn, or a line drawn before the mod loaded)
// and for a word a tamer preset would not show: that line keeps Claude Code's word.
async function closingWord(
  $: EngineInterface,
  settings: Settings,
  requestId: string,
  props: RenderPropsOf['TurnDuration'],
): Promise<string | null> {
  if (!(settings.isEnabled && isInteractive) || props.isExpanded === true) {
    return null;
  }
  if (props.waitingFor !== undefined || (await isOff($))) {
    return null;
  }
  const word = (await $.state.get({ ...CLOSING_WORD, id: requestId })).value;
  return word !== undefined && isShownNow(word, settings.preset) ? word : null;
}

// Claude Code's own closing line, as drawn with the paired word, and the label after it (feature
// row 8) unless the line refuses one or the measured width would wrap it.
function withLabel(
  $: EngineInterface,
  e: RenderInput<'TurnDuration'>,
  drawn: RenderElement,
  word: string,
  preset: Preset,
): RenderElement {
  const label = footerLabel(word, preset);
  if (label === null || !labelFits(e.viewport?.columns, word, label)) {
    return drawn;
  }
  const { Box, Text } = $.ui.resolve(e);
  return (
    <Box>
      {drawn}
      <Text dimColor>{`${LABEL_GAP}${label}`}</Text>
    </Box>
  );
}

// --- the commit line ---------------------------------------------------------------------------

async function commitJoke($: EngineInterface, settings: Settings): Promise<void> {
  if (!(settings.isEnabled && isInteractive) || (await isOff($))) {
    return;
  }
  const rng = need((await $.state.get(RNG)).value, 'rng');
  const misses = need((await $.state.get(COMMIT_MISSES)).value, 'commitMisses');
  const dice = nextRandom(rng);
  const result = roll(constantFor(matchedRate(settings)), misses, dice.value);
  await $.state.set(RNG, dice.state);
  await $.state.set(COMMIT_MISSES, result.misses);
  if (!result.isHit) {
    return;
  }
  const key = commitCountKey(await $.session.id());
  const shown = shownSoFar(key, await $.store.get(key));
  await $.store.set(key, { shown: shown + 1, at: await $.clock.now() });
  $.ui.toast(commitLine(shown, settings.preset));
}

// --- the interrupted turn ----------------------------------------------------------------------

// The outcome lines (interrupted, error) share one set of dice at the matched rate, in regular
// and maximum only; false when the mod is off or the preset is discreet.
async function rollOutcome($: EngineInterface, settings: Settings): Promise<boolean> {
  if (!(settings.isEnabled && isInteractive) || settings.preset === 'discreet') {
    return false;
  }
  if (await isOff($)) {
    return false;
  }
  const rng = need((await $.state.get(RNG)).value, 'rng');
  const misses = need((await $.state.get(OUTCOME_MISSES)).value, 'outcomeMisses');
  const dice = nextRandom(rng);
  const result = roll(constantFor(matchedRate(settings)), misses, dice.value);
  await $.state.set(RNG, dice.state);
  await $.state.set(OUTCOME_MISSES, result.misses);
  return result.isHit;
}

// An interrupted turn draws no closing line (FINDINGS 13), so his line is a toast; Claude Code's
// own interrupt row stays as it is.
async function abortedJoke($: EngineInterface, settings: Settings): Promise<void> {
  if (await rollOutcome($, settings)) {
    $.ui.toast(ABORTED_LINE);
  }
}

// --- the closing line, paired with its turn (feature row 2) ------------------------------------

// What a paired line says. The past form of the turn's own phrase when it answered; "Refused"
// in its place when it was refused; the error line on the outcome dice when an API error ended
// it; nothing (Claude Code's word) after an interrupt, on a plain turn, or when the mod is off.
async function pairedWord(
  $: EngineInterface,
  settings: Settings,
  held: Pairing,
  reason: TurnCompleteReason,
): Promise<string | null> {
  if (reason === 'error') {
    return (await rollOutcome($, settings)) ? ERROR_WORD : null;
  }
  if (!(settings.isEnabled && isInteractive) || (await isOff($))) {
    return null;
  }
  const done = doneFor(held.phrase, settings.preset);
  if (done === null || reason === 'aborted') {
    return null;
  }
  return reason === 'refusal' ? REFUSED_WORD : done;
}

// Called when either fact arrives: the word is written once both are known. The line usually
// draws after both (186 of 191 lines in the probe's logs); a line that drew first is redrawn by
// the write, or, if the engine does not redraw it, keeps Claude Code's word.
async function settleClosing($: EngineInterface, settings: Settings): Promise<void> {
  const held = pairing;
  if (held === null || held.uuid === null || held.reason === null) {
    return;
  }
  pairing = null;
  const word = await pairedWord($, settings, held, held.reason);
  if (word !== null) {
    await $.state.set({ ...CLOSING_WORD, id: held.uuid }, word);
  }
}

async function startPairing($: EngineInterface, turnId: string): Promise<void> {
  const phrase = (await $.state.get(PHRASE)).value ?? null;
  pairing = { turnId, phrase, uuid: null, reason: null };
}

async function noteDurationRow(
  $: EngineInterface,
  settings: Settings,
  uuid: string,
): Promise<void> {
  if (pairing !== null && pairing.uuid === null) {
    pairing.uuid = uuid;
    await settleClosing($, settings);
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
  if (e.reason === 'aborted') {
    await abortedJoke($, settings);
  }
  if (pairing !== null && pairing.turnId === e.turnId) {
    pairing.reason = e.reason;
    await settleClosing($, settings);
  }
  await drawTurn($, settings);
  if (wasTyped) {
    await firstRun($, settings);
  }
}

// Removes the commit counts of sessions untouched past the keep bound (hooks/commits.ts).
async function pruneCommitCounts($: EngineInterface, settings: Settings): Promise<void> {
  if (!(settings.isEnabled && isInteractive) || (await isOff($))) {
    return;
  }
  const now = await $.clock.now();
  const keys = (await $.store.keys()).filter((key) => key.startsWith(COMMIT_COUNT_PREFIX));
  const counts = await Promise.all(keys.map((key) => $.store.get(key)));
  const stale = keys.filter((key, index) => isStale(key, counts[index], now));
  await Promise.all(stale.map((key) => $.store.delete(key)));
}

// --- the first run on this machine -------------------------------------------------------------

async function firstRun($: EngineInterface, settings: Settings): Promise<void> {
  if (isFirstRunChecked || !(settings.isEnabled && isInteractive) || (await isOff($))) {
    return;
  }
  isFirstRunChecked = true;
  if ((await $.store.get(FIRST_RUN)) === true) {
    return;
  }
  await $.store.set(FIRST_RUN, true);
  await $.store.delete(FIRST_RUN_BEFORE);
  $.ui.toast(
    `Sanitized for your protection. Jokes on ${describeRate(turnRate(settings))}; /poop off stops them.`,
  );
}

// --- the command -------------------------------------------------------------------------------

// A command's answer. `exitCode` reaches only a headless run whose whole prompt was the command
// (`claude -p "/poopstack off"`); 1 says it did not do all it was asked: a setting not saved as
// asked, or a failure inside the mod.
type Answer = { readonly text: string; readonly exitCode?: number };
const FAILED_EXIT = 1;

// Changes one of this plugin's /config rows; the engine reloads the module with the new value.
// Null when the row now holds the value asked for; otherwise why not: refused, or saved as
// something else (a config hook may change a value on its way in).
async function setOption(
  $: EngineInterface,
  field: string,
  value: boolean | string,
): Promise<string | null> {
  const rows = await $.config.list();
  const row = rows.find(
    (candidate) =>
      candidate.provider.plugin === $.plugin.name && candidate.key.endsWith(`.${field}`),
  );
  if (row === undefined) {
    return `no /config row named ${field} was found for ${$.plugin.name}`;
  }
  const outcome = await $.config.set({ key: row.key, value });
  if (outcome.deny !== undefined) {
    return outcome.deny;
  }
  return outcome.value === value ? null : `it was saved as ${JSON.stringify(outcome.value)}`;
}

async function turnOff($: EngineInterface): Promise<Answer> {
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
  await $.state.set(IS_OFF, false);
  const problem = settings.isEnabled ? null : await setOption($, 'enabled', true);
  if (problem !== null) {
    return {
      text: `Not turned on: the setting was not saved (${problem}).`,
      exitCode: FAILED_EXIT,
    };
  }
  return { text: `On. Jokes on ${describeRate(turnRate(settings))} (${settings.preset}).` };
}

async function setPreset($: EngineInterface, settings: Settings, preset: Preset): Promise<Answer> {
  const problem = await setOption($, 'preset', preset);
  if (problem !== null) {
    return { text: `The preset stays ${settings.preset}: ${problem}.`, exitCode: FAILED_EXIT };
  }
  const rate = describeRate(turnRate({ ...settings, preset }));
  return { text: `Preset is now ${preset}: jokes on ${rate}.` };
}

async function statusText($: EngineInterface, settings: Settings): Promise<string> {
  if (!settings.isEnabled || (await isOff($))) {
    return 'Off. /poopstack on turns the jokes back on.';
  }
  return `On · ${settings.preset} · jokes on ${describeRate(turnRate(settings))}.`;
}

async function answer($: EngineInterface, settings: Settings, args: string): Promise<Answer> {
  const verb = args.trim().toLowerCase();
  if (verb === '' || verb === 'status') {
    return { text: await statusText($, settings) };
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
  return { text: `Unknown word "${verb}". Try on, off, discreet, regular, maximum or status.` };
}

// The answer to one of the mod's own names, or null for a name another plugin holds.
async function answerOwn(
  $: EngineInterface,
  settings: Settings,
  command: string,
  args: string,
): Promise<Answer | null> {
  if (!owned.has(command)) {
    return null;
  }
  return await answer($, settings, args);
}

const DESCRIPTION = 'p(oop)stack: on, off, discreet, regular, maximum, or status';
const FAILED =
  'The command failed inside p(oop)stack (the transcript names the error); /poopstack status shows where it stands.';
const HINT = '[on|off|discreet|regular|maximum|status]';

// The catch of each command hook: a failure inside the mod's own command says so, and fails a
// headless run, instead of passing on; a name the mod does not hold passes on to its owner.
function failedOrPass<E extends { readonly command: string }, R>(
  _$: unknown,
  e: E,
  next: (e: E) => Promise<R>,
): Promise<R | Answer> {
  return owned.has(e.command) ? Promise.resolve({ text: FAILED, exitCode: FAILED_EXIT }) : next(e);
}

// Each visible name (decision 35) is registered by its literal name; a name another plugin or
// Claude Code already holds is refused, and the mod then leaves that name to its owner.
async function registerCommands($: EngineInterface): Promise<void> {
  await Promise.allSettled([
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
  ]);
  owned.clear();
  for (const command of await $.command.list()) {
    if (command.source === 'plugin' && command.plugin === $.plugin.name) {
      owned.add(command.name);
    }
  }
}

export const register: Register = (on, options) => {
  const settings = readSettings(options);

  on('session.start', async ($, e, next) => {
    await registerCommands($);
    const result = await next(e);
    isInteractive = e.isInteractive;
    await reconcileOff($, settings);
    await ensureReady($, settings);
    await pruneCommitCounts($, settings);
    return result;
  }).catch((_$, e, next) => next(e));

  // An observer: notes the phrase a main turn starts with, for its closing line.
  on('turn.start', async ($, e, next) => {
    const result = await next(e);
    if (e.agentId === undefined) {
      await ensureReady($, settings);
      await startPairing($, e.turnId);
    }
    return result;
  }).catch((_$, e, next) => next(e)); // `next` is replay-safe here: a settled call is not re-run

  // An observer: the main loop's `turn_duration` notice is the row its closing line draws for.
  on('session.append', { door: 'notice' }, async ($, e, next) => {
    const result = await next(e);
    const isDuration = e.message.type === 'system' && e.message.name === 'turn_duration';
    if (isDuration && e.agentId === undefined) {
      await noteDurationRow($, settings, e.uuid);
    }
    return result;
  }).catch((_$, e, next) => next(e)); // `next` is replay-safe here: a settled call is not re-run

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (e.agentId === undefined) {
      await endMainTurn($, settings, e);
    }
    return result;
  }).catch((_$, e, next) => next(e));

  // An observer: the prompt goes on unchanged; only where it came from is noted.
  on('prompt.submit', async (_$, e, next) => {
    const result = await next(e);
    if (e.origin.kind === 'composer' && e.isMeta !== true) {
      isTypedTurn = true;
    }
    return result;
  }).catch((_$, e, next) => next(e)); // `next` is replay-safe here: a settled call is not re-run

  // An observer: the call runs first and its result returns unchanged.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e);
    if (result.deny === undefined && commitKind(result.result) !== null) {
      await commitJoke($, settings);
    }
    return result;
  }).catch((_$, e, next) => next(e)); // `next` is replay-safe here: a settled call is not re-run

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const phrase = await spinnerPhrase($, settings, e.surface, e.props);
    return phrase === null ? next(e) : next({ ...e, props: { ...e.props, word: phrase } });
  }).catch((_$, e, next) => next(e));

  // A joked line keeps Claude Code's own text (its true duration and time) with the label after
  // it, left off where the measured width would wrap. The engine raises TurnDuration on the
  // terminal only (its types), so design item 10 needs no surface check here.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const word = await closingWord($, settings, e.requestId, e.props);
    if (word === null) {
      return next(e);
    }
    const drawn = await next({ ...e, props: { ...e.props, word } });
    return withLabel($, e, drawn, word, settings.preset);
  }).catch((_$, e, next) => next(e));

  // One hook per visible name, each matched by its literal name (the catch: `failedOrPass`).
  on('command.run', { command: 'poopstack' }, async ($, e, next) => {
    return (await answerOwn($, settings, e.command, e.args)) ?? next(e);
  }).catch(failedOrPass);
  on('command.run', { command: 'poop' }, async ($, e, next) => {
    return (await answerOwn($, settings, e.command, e.args)) ?? next(e);
  }).catch(failedOrPass);
  on('command.run', { command: 'commode' }, async ($, e, next) => {
    return (await answerOwn($, settings, e.command, e.args)) ?? next(e);
  }).catch(failedOrPass);
  on('command.run', { command: 'porcelain' }, async ($, e, next) => {
    return (await answerOwn($, settings, e.command, e.args)) ?? next(e);
  }).catch(failedOrPass);
  on('command.run', { command: 'agentic-outhouse' }, async ($, e, next) => {
    return (await answerOwn($, settings, e.command, e.args)) ?? next(e);
  }).catch(failedOrPass);
};
