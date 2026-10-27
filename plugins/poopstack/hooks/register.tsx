import type { EngineInterface, Register, RenderPropsOf, RenderSurface } from 'claude-code';
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
import { commitLine, poolFor } from './vocabulary';

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

// Until the closing line can be joined to its turn (feature row 2, waiting on his ruling), each
// line's joke is derived from its own id: an independent past-tense joke at the turn rate, the
// same on every redraw. A preset or rate change re-words the lines on screen.
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
  const hash = hashId(requestId);
  if ((hash >>> 16) / 65536 >= turnRate(settings)) {
    return null;
  }
  const pool = poolFor(settings.preset);
  return pool[(hash & 0xffff) % pool.length]?.done ?? null;
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

type ConfigOutcome = { readonly deny?: string | undefined };

// Changes one of this plugin's /config rows; the engine reloads the module with the new value.
async function setOption(
  $: EngineInterface,
  field: string,
  value: boolean | string,
): Promise<ConfigOutcome> {
  const rows = await $.config.list();
  const row = rows.find(
    (candidate) =>
      candidate.provider.plugin === $.plugin.name && candidate.key.endsWith(`.${field}`),
  );
  if (row === undefined) {
    return { deny: `no /config row named ${field} was found for ${$.plugin.name}` };
  }
  return $.config.set({ key: row.key, value });
}

async function turnOff($: EngineInterface): Promise<{ text: string }> {
  await $.state.set(IS_OFF, true);
  const outcome = await setOption($, 'enabled', false);
  if (outcome.deny !== undefined) {
    return {
      text: `Jokes stopped for this session only: the setting was not saved (${outcome.deny}).`,
    };
  }
  return { text: "Off. Claude Code's own words are back; /poopstack on brings the jokes back." };
}

async function turnOn($: EngineInterface, settings: Settings): Promise<{ text: string }> {
  await $.state.set(IS_OFF, false);
  const outcome = settings.isEnabled ? {} : await setOption($, 'enabled', true);
  if (outcome.deny !== undefined) {
    return { text: `Not turned on: the setting was not saved (${outcome.deny}).` };
  }
  return { text: `On. Jokes on ${describeRate(turnRate(settings))} (${settings.preset}).` };
}

async function setPreset(
  $: EngineInterface,
  settings: Settings,
  preset: Preset,
): Promise<{ text: string }> {
  const outcome = await setOption($, 'preset', preset);
  if (outcome.deny !== undefined) {
    return { text: `The preset stays ${settings.preset}: ${outcome.deny}.` };
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

async function answer(
  $: EngineInterface,
  settings: Settings,
  args: string,
): Promise<{ text: string }> {
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
): Promise<{ text: string } | null> {
  if (!owned.has(command)) {
    return null;
  }
  return await answer($, settings, args);
}

const DESCRIPTION = 'p(oop)stack: on, off, discreet, regular, maximum, or status';
const FAILED =
  'The command failed inside p(oop)stack (the transcript names the error); /poopstack status shows where it stands.';
const HINT = '[on|off|discreet|regular|maximum|status]';

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
    await ensureSession($, settings);
    await pruneCommitCounts($, settings);
    return result;
  }).catch((_$, e, next) => next(e));

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (e.agentId === undefined) {
      const wasTyped = isTypedTurn;
      isTypedTurn = false;
      await drawTurn($, settings);
      if (wasTyped) {
        await firstRun($, settings);
      }
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

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const word = await closingWord($, settings, e.requestId, e.props);
    return word === null ? next(e) : next({ ...e, props: { ...e.props, word } });
  }).catch((_$, e, next) => next(e));

  // One hook per visible name, each matched by its literal name; a name the mod does not hold
  // passes on to its owner. A failure inside the mod's own command says so instead of passing on.
  on('command.run', { command: 'poopstack' }, async ($, e, next) => {
    return (await answerOwn($, settings, e.command, e.args)) ?? next(e);
  }).catch(async (_$, e, next) => (owned.has(e.command) ? { text: FAILED } : next(e)));
  on('command.run', { command: 'poop' }, async ($, e, next) => {
    return (await answerOwn($, settings, e.command, e.args)) ?? next(e);
  }).catch(async (_$, e, next) => (owned.has(e.command) ? { text: FAILED } : next(e)));
  on('command.run', { command: 'commode' }, async ($, e, next) => {
    return (await answerOwn($, settings, e.command, e.args)) ?? next(e);
  }).catch(async (_$, e, next) => (owned.has(e.command) ? { text: FAILED } : next(e)));
  on('command.run', { command: 'porcelain' }, async ($, e, next) => {
    return (await answerOwn($, settings, e.command, e.args)) ?? next(e);
  }).catch(async (_$, e, next) => (owned.has(e.command) ? { text: FAILED } : next(e)));
  on('command.run', { command: 'agentic-outhouse' }, async ($, e, next) => {
    return (await answerOwn($, settings, e.command, e.args)) ?? next(e);
  }).catch(async (_$, e, next) => (owned.has(e.command) ? { text: FAILED } : next(e)));
};
