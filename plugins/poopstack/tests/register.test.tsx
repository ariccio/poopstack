import { expect, type TestBody, test } from 'claude-code/testing';
import { COMMIT_COUNT_KEEP_MS } from '../hooks/commits';
import {
  ABORTED_LINE,
  COMMIT_FIRST,
  COMMIT_SECOND,
  ERROR_WORD,
  poolFor,
  REFUSED_WORD,
} from '../hooks/vocabulary';

type Engine = Parameters<TestBody>[0];
type On = Parameters<TestBody>[1];

const NAMES = ['poopstack', 'poop', 'commode', 'porcelain', 'agentic-outhouse'] as const;
const ALWAYS = { enabled: true, preset: 'regular', engagement: 'always' } as const;
const WORKING = new Set(poolFor('regular').map((entry) => entry.working));
const DONE = new Set(poolFor('regular').map((entry) => entry.done));

const SPINNER = {
  plugin: 'poopstack',
  component: 'Spinner',
  requestId: 'session-1',
  props: { word: 'Pollinating', message: null, suffix: '…', mode: 'thinking' },
} as const;

const CLOSING = {
  plugin: 'poopstack',
  component: 'TurnDuration',
  props: { word: 'Brewed', durationMs: 16_000 },
} as const;

// What every `turn.complete` in these tests carries besides its id and reason.
const TURN_BASE = { answer: 'done', durationMs: 1_000, text: 'done' } as const;

type Seen = {
  toasts: string[];
  configSets: string[];
  storeSets: string[];
  storeDeletes: string[];
};

// The machine-wide store as a test starts it: by default the first-run toast was already seen.
const SEEN_BEFORE = { firstRunSeen: true } as const;
// Late enough that a count older than the keep bound still has a time after the epoch.
const NOW = 2 * COMMIT_COUNT_KEEP_MS;

// Nothing sits beneath the mod: these hooks stand for the engine. The two lines draw the word
// they were handed, so a test reads what the mod passed on. `holder` names who registered each
// visible name (another plugin can hold one); `stored` is the store before the session starts.
function engine(
  on: On,
  holder: (name: string) => string = () => 'poopstack',
  stored: Readonly<Record<string, unknown>> = SEEN_BEFORE,
): Seen {
  const seen: Seen = { toasts: [], configSets: [], storeSets: [], storeDeletes: [] };
  const store = new Map<string, unknown>(Object.entries(stored));
  on('command.register', (_, e) => ({ value: { command: e.name } }));
  on('command.list', () => ({
    value: NAMES.map((name) => ({ name, description: '', source: 'plugin', plugin: holder(name) })),
  }));
  on('command.run', () => ({ text: 'answered by the other plugin' }));
  on('config.list', () => ({
    value: ['enabled', 'preset', 'engagement'].map((field) => ({
      key: `poopstack.${field}`,
      label: field,
      kind: 'boolean',
      value: true,
      provider: { plugin: 'poopstack', tier: 'user' },
      isLocked: false,
    })),
  }));
  on('config.set', (_, e) => {
    seen.configSets.push(`${e.key}=${String(e.value)}`);
    return { value: e.value };
  });
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('session.id', () => ({ value: 'session-1' }));
  on('clock.now', () => ({ value: NOW }));
  on('store.get', (_, e) => ({ value: store.get(e.key) }));
  on('store.set', (_, e) => {
    seen.storeSets.push(e.key);
    store.set(e.key, e.value);
    return { value: undefined };
  });
  on('store.delete', (_, e) => {
    seen.storeDeletes.push(e.key);
    store.delete(e.key);
    return { value: undefined };
  });
  on('store.keys', () => ({ value: [...store.keys()] }));
  on('turn.start', (_, e) => ({ turnId: e.turnId }));
  on('session.append', (_, e, next) => next(e));
  on('turn.complete', (_, e) => ({ text: e.answer }));
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text);
    return { value: undefined };
  });
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>{e.props.word}</Text>;
  });
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>{e.props.word}</Text>;
  });
  return seen;
}

async function start($: Engine, isInteractive = true): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive });
}

function run(command: string, args: string) {
  return {
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { source: 'plugin', plugin: 'poopstack' },
    cwd: '/work',
    surface: 'terminal',
    isInteractive: true,
  } as const;
}

async function spinnerWord(
  $: Engine,
  surface: 'terminal' | 'desktop',
  word: string,
  message: string | null,
) {
  const ui = await $.ui.mount({ ...SPINNER, surface, props: { ...SPINNER.props, word, message } });
  const text = (await ui.find({ type: 'Text' }))?.text;
  await ui.unmount();
  return text;
}

test(
  'a joked turn shows a phrase from the vocabulary on the terminal',
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    await start($);
    expect(WORKING.has((await spinnerWord($, 'terminal', 'Pollinating', null)) ?? '')).toBe(true);
  },
);

test('the engine status message is never replaced', { options: ALWAYS }, async ($, on) => {
  engine(on);
  await start($);
  expect(await spinnerWord($, 'terminal', 'Pollinating', 'Compacting conversation')).toBe(
    'Pollinating',
  );
});

test('off the terminal only the bare "Working" is replaced', { options: ALWAYS }, async ($, on) => {
  engine(on);
  await start($);
  expect(await spinnerWord($, 'desktop', 'Creating notes.md', null)).toBe('Creating notes.md');
  expect(WORKING.has((await spinnerWord($, 'desktop', 'Working', null)) ?? '')).toBe(true);
});

test('a session that is not interactive is left alone', { options: ALWAYS }, async ($, on) => {
  engine(on);
  await start($, false);
  expect(await spinnerWord($, 'terminal', 'Pollinating', null)).toBe('Pollinating');
});

test(
  'turned off in settings, nothing is rewritten',
  { options: { ...ALWAYS, enabled: false } },
  async ($, on) => {
    engine(on);
    await start($);
    expect(await spinnerWord($, 'terminal', 'Pollinating', null)).toBe('Pollinating');
  },
);

test(
  '/poop off stops the rewrite at once and saves the setting',
  { options: ALWAYS },
  async ($, on) => {
    const seen = engine(on);
    await start($);
    const result = await $.command.run(run('poop', 'off'));
    expect(result.text.startsWith('Off.')).toBe(true);
    expect(seen.configSets).toEqual(['poopstack.enabled=false']);
    expect(await spinnerWord($, 'terminal', 'Pollinating', null)).toBe('Pollinating');
  },
);

test('/poopstack status says what is on, in neutral words', { options: ALWAYS }, async ($, on) => {
  engine(on);
  await start($);
  const result = await $.command.run(run('poopstack', ''));
  expect(result.text).toBe('On · regular · jokes on every turn.');
});

test('a name another plugin holds is left to that plugin', { options: ALWAYS }, async ($, on) => {
  engine(on, (name) => (name === 'porcelain' ? 'other' : 'poopstack'));
  await start($);
  const result = await $.command.run(run('porcelain', 'off'));
  expect(result.text).toBe('answered by the other plugin');
});

// The past form paired with each working phrase in the regular pool.
const DONE_OF = new Map(poolFor('regular').map((entry) => [entry.working, entry.done]));

type Reason = 'answer' | 'aborted' | 'refusal' | 'error';

// One main turn as the engine reports it: its start, the `turn_duration` row its closing line
// draws for, and its end, with the row before or after the end (both orders occur: FINDINGS 1).
async function turnWithRow(
  $: Engine,
  turnId: string,
  uuid: string,
  reason: Reason,
  isRowFirst = true,
): Promise<void> {
  const row = {
    message: { type: 'system', name: 'turn_duration', content: [] },
    door: 'notice',
    origin: { kind: 'unclassified' },
    uuid,
  } as const;
  const end = { ...TURN_BASE, turnId, isAborted: reason === 'aborted' } as const;
  await $.turn.start({ text: 'go', turnId });
  if (isRowFirst) {
    await $.session.append(row);
  }
  await (reason === 'refusal'
    ? $.turn.complete({ ...end, reason, refusal: { category: null, explanation: null } })
    : $.turn.complete({ ...end, reason }));
  if (!isRowFirst) {
    await $.session.append(row);
  }
}

async function closingText($: Engine, requestId: string, extra: object = {}): Promise<string> {
  const props = { ...CLOSING.props, ...extra };
  const ui = await $.ui.mount({ ...CLOSING, surface: 'terminal', requestId, props });
  const text = (await ui.find({ type: 'Text' }))?.text ?? '';
  await ui.unmount();
  return text;
}

test(
  "a closing line shows the past form of its own turn's phrase, whichever fact comes first",
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    await start($);
    const first = (await spinnerWord($, 'terminal', 'Pollinating', null)) ?? '';
    await turnWithRow($, 'turn-1', 'row-1', 'answer');
    const second = (await spinnerWord($, 'terminal', 'Pollinating', null)) ?? '';
    await turnWithRow($, 'turn-2', 'row-2', 'answer', false);
    const ui = await $.ui.mount({ ...CLOSING, surface: 'terminal', requestId: 'row-1' });
    const shown = (await ui.find({ type: 'Text' }))?.text;
    await ui.redraw();
    const again = (await ui.find({ type: 'Text' }))?.text;
    await ui.unmount();
    expect(DONE.has(shown ?? '')).toBe(true);
    expect(shown).toBe(DONE_OF.get(first));
    expect(again).toBe(shown);
    expect(await closingText($, 'row-2')).toBe(DONE_OF.get(second) ?? '');
  },
);

test(
  "a line never paired (drawn before the mod loaded) keeps the engine's word",
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    await start($);
    expect(await closingText($, 'row-unknown')).toBe('Brewed');
  },
);

test('a refused turn says only "Refused"', { options: ALWAYS }, async ($, on) => {
  engine(on);
  await start($);
  await turnWithRow($, 'turn-1', 'row-1', 'refusal');
  expect(await closingText($, 'row-1')).toBe(REFUSED_WORD);
});

test('an error turn shows his error line', { options: ALWAYS }, async ($, on) => {
  engine(on);
  await start($);
  await turnWithRow($, 'turn-1', 'row-1', 'error');
  expect(await closingText($, 'row-1')).toBe(ERROR_WORD);
});

test(
  "discreet keeps the engine's word on an error turn",
  { options: { ...ALWAYS, preset: 'discreet' } },
  async ($, on) => {
    engine(on);
    await start($);
    await turnWithRow($, 'turn-1', 'row-1', 'error');
    expect(await closingText($, 'row-1')).toBe('Brewed');
  },
);

test(
  "an interrupted turn's line, if one draws, keeps the engine's word",
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    await start($);
    await turnWithRow($, 'turn-1', 'row-1', 'aborted');
    expect(await closingText($, 'row-1')).toBe('Brewed');
  },
);

test(
  'the expanded view and the waiting text are left to the engine',
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    await start($);
    await turnWithRow($, 'turn-1', 'row-1', 'answer');
    expect(await closingText($, 'row-1', { isExpanded: true })).toBe('Brewed');
    const waiting = { waitingFor: { agents: [], workflows: 0 } };
    expect(await closingText($, 'row-1', waiting)).toBe('Brewed');
    expect(DONE.has(await closingText($, 'row-1'))).toBe(true);
  },
);

test(
  "/poop off turns a paired line back to the engine's word",
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    await start($);
    await turnWithRow($, 'turn-1', 'row-1', 'answer');
    await $.command.run(run('poop', 'off'));
    expect(await closingText($, 'row-1')).toBe('Brewed');
  },
);

// The engine's own report of a Bash call that made a commit (claude-code-tools, `gitOperation`).
const COMMITTED = {
  result: {
    stdout: '[main c938bc3] feat: x',
    stderr: '',
    interrupted: false,
    gitOperation: { commit: { sha: 'c938bc3', kind: 'committed', branch: 'main' } },
  },
} as const;
const NOTHING = { result: { stdout: '', stderr: '', interrupted: false } } as const;

// How Claude usually commits: a chain, and a message in a heredoc with quotes inside it.
const CLAUDE_STYLE = [
  "git add hooks/pick.ts && git commit -m \"$(cat <<'EOF'",
  'feat(core): add the bag',
  '',
  'His words: "Don\'t cancel the nudge."',
  '',
  'Co-Authored-By: Claude <noreply@anthropic.com>',
  'EOF',
  ')" 2>&1 | tail -n 20',
].join('\n');

test(
  'commits the engine reports show his two lines in order, then the first again',
  { options: ALWAYS },
  async ($, on) => {
    const seen = engine(on);
    on('tool.call', () => COMMITTED);
    await start($);
    await $.tool.call({ tool: 'Bash', command: CLAUDE_STYLE });
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' });
    await $.tool.call({ tool: 'Bash', command: 'git commit --amend --no-edit' });
    expect(seen.toasts).toEqual([COMMIT_FIRST, COMMIT_SECOND, COMMIT_FIRST]);
  },
);

// A test's $.state starts empty, as a process resumed with `claude --resume` does
// (hooks/commits.ts); the store stands for what the session's earlier process kept.
test(
  'a session resumed in a new process carries on its pair from the store',
  { options: ALWAYS },
  async ($, on) => {
    const seen = engine(on, () => 'poopstack', {
      ...SEEN_BEFORE,
      'commitJokes.session-1': { shown: 1, at: NOW - 1 },
      'commitJokes.session-2': { shown: 0, at: NOW - 1 },
    });
    on('tool.call', () => COMMITTED);
    await start($);
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' });
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: y"' });
    expect(seen.toasts).toEqual([COMMIT_SECOND, COMMIT_FIRST]);
    expect(seen.storeSets).toEqual(['commitJokes.session-1', 'commitJokes.session-1']);
  },
);

test(
  "a session's start removes only the counts untouched past the keep bound",
  { options: ALWAYS },
  async ($, on) => {
    const seen = engine(on, () => 'poopstack', {
      ...SEEN_BEFORE,
      'commitJokes.old': { shown: 2, at: NOW - COMMIT_COUNT_KEEP_MS - 1 },
      'commitJokes.recent': { shown: 1, at: NOW - COMMIT_COUNT_KEEP_MS },
    });
    await start($);
    expect(seen.storeDeletes).toEqual(['commitJokes.old']);
  },
);

test(
  'turned off in settings, the store is left alone',
  { options: { ...ALWAYS, enabled: false } },
  async ($, on) => {
    const seen = engine(on, () => 'poopstack', {
      ...SEEN_BEFORE,
      'commitJokes.old': { shown: 2, at: NOW - COMMIT_COUNT_KEEP_MS - 1 },
    });
    on('tool.call', () => COMMITTED);
    await start($);
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' });
    expect(seen.storeSets).toEqual([]);
    expect(seen.storeDeletes).toEqual([]);
    expect(seen.toasts).toEqual([]);
  },
);

test(
  'a call the engine reports no commit for shows nothing, and its result passes on unchanged',
  { options: ALWAYS },
  async ($, on) => {
    const seen = engine(on);
    on('tool.call', () => ({ ...NOTHING, isError: true, text: 'exit 1' }));
    await start($);
    const failed = await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' });
    expect(failed.isError).toBe(true);
    expect(failed.text).toBe('exit 1');
    expect(seen.toasts).toEqual([]);
  },
);

const TURN = {
  turnId: 'turn-1',
  answer: 'done',
  durationMs: 1_000,
  isAborted: false,
  reason: 'answer',
  text: 'done',
} as const;

test(
  'the first-run toast waits for a turn he typed, then shows once',
  { options: ALWAYS },
  async ($, on) => {
    // Nothing stored yet on this machine.
    const seen = engine(on, () => 'poopstack', {});
    on('prompt.submit', (_, e) => ({ text: e.text }));
    await start($);
    await $.prompt.submit({
      text: 'cache nudge: reply one line, no work',
      origin: { kind: 'scheduled-trigger' },
      wait: false,
    });
    await $.turn.complete(TURN);
    expect(seen.toasts).toEqual([]);
    await $.prompt.submit({ text: 'hello', origin: { kind: 'composer' }, wait: false });
    await $.turn.complete(TURN);
    await $.prompt.submit({ text: 'again', origin: { kind: 'composer' }, wait: false });
    await $.turn.complete(TURN);
    expect(seen.toasts.length).toBe(1);
    expect(seen.toasts[0]?.startsWith('Sanitized for your protection.')).toBe(true);
    expect(seen.storeSets).toEqual(['firstRunSeen']);
    expect(seen.storeDeletes).toEqual(['firstRunShown']);
  },
);

const ABORTED = { ...TURN, answer: '', text: '', isAborted: true, reason: 'aborted' } as const;

test(
  'an interrupted main turn shows his aborted line as a toast',
  { options: ALWAYS },
  async ($, on) => {
    const seen = engine(on);
    await start($);
    await $.turn.complete(ABORTED);
    await $.turn.complete(TURN);
    expect(seen.toasts).toEqual([ABORTED_LINE]);
  },
);

test(
  'discreet shows no aborted line',
  { options: { ...ALWAYS, preset: 'discreet' } },
  async ($, on) => {
    const seen = engine(on);
    await start($);
    await $.turn.complete(ABORTED);
    expect(seen.toasts).toEqual([]);
  },
);

test("a subagent's interrupted turn shows no aborted line", { options: ALWAYS }, async ($, on) => {
  const seen = engine(on);
  await start($);
  await $.turn.complete({ ...ABORTED, agentId: 'agent-1' });
  expect(seen.toasts).toEqual([]);
});
