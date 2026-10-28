import { expect, type MockClock, mock, type TestBody, test } from 'claude-code/testing';
import { COMMIT_COUNT_KEEP_MS } from '../hooks/commits';
import {
  ABORTED_LINE,
  COMMIT_FIRST,
  COMMIT_SECOND,
  ERROR_WORD,
  FOOTER_LABEL,
  FOOTER_LABEL_DISCREET,
  LABEL_GAP,
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
// The rest of the line the stand-in draws after the word, from CLOSING's duration.
const TAIL = ' for 16s · done 3:40 PM';

// What every `turn.complete` in these tests carries besides its id and reason.
const TURN_BASE = { answer: 'done', durationMs: 1_000, text: 'done' } as const;

// What the stand-in saw, and its clock: work the mod leaves running (the commit line, which
// follows a Bash call's result) has run once a test calls `clock.settle()`.
type Seen = {
  toasts: string[];
  configSets: string[];
  storeSets: string[];
  storeDeletes: string[];
  logs: string[];
  clock: MockClock;
};

// The machine-wide store as a test starts it: by default the first-run toast was already seen.
const SEEN_BEFORE = { firstRunSeen: true } as const;
// Late enough that a count older than the keep bound still has a time after the epoch.
const NOW = 2 * COMMIT_COUNT_KEEP_MS;

// A promise the test settles by hand.
function latch(): { readonly promise: Promise<void>; readonly open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

// How the stand-in engine misbehaves when a test asks: `savedAs` is what a config hook changed a
// value to on its way in; `isListFailing` and `isStoreSetFailing` make that call throw (the kit
// then rejects it); `countReadsAs` is what every commit count reads as; `countReadGate` holds a
// commit count's read open until the test releases it, so the test can act in between, and
// `firstRunSetGate` does the same for the first-run flag's write.
type StandIn = {
  readonly savedAs?: boolean | string;
  readonly isListFailing?: boolean;
  readonly isStoreSetFailing?: boolean;
  readonly countReadsAs?: unknown;
  readonly countReadGate?: Gate;
  readonly firstRunSetGate?: Gate;
};
type Gate = { readonly entered: () => void; readonly released: Promise<void> };

// Nothing sits beneath the mod: these hooks stand for the engine. The two lines draw the word
// they were handed, so a test reads what the mod passed on. `holder` names who registered each
// visible name (another plugin can hold one); `stored` is the store before the session starts.
function engine(
  on: On,
  holder: (name: string) => string = () => 'poopstack',
  stored: Readonly<Record<string, unknown>> = SEEN_BEFORE,
  config: StandIn = {},
): Seen {
  const seen: Seen = {
    toasts: [],
    configSets: [],
    storeSets: [],
    storeDeletes: [],
    logs: [],
    clock: mock.clock(on, { now: NOW }),
  };
  const store = new Map<string, unknown>(Object.entries(stored));
  on('command.register', (_, e) => ({ value: { command: e.name } }));
  on('command.list', () => ({
    value: NAMES.map((name) => ({ name, description: '', source: 'plugin', plugin: holder(name) })),
  }));
  on('command.run', () => ({ text: 'answered by the other plugin' }));
  on('config.list', () => {
    if (config.isListFailing === true) {
      throw new Error('the config list failed');
    }
    return {
      value: ['enabled', 'preset', 'engagement'].map((field) => ({
        key: `poopstack.${field}`,
        label: field,
        kind: 'boolean',
        value: true,
        provider: { plugin: 'poopstack', tier: 'user' },
        isLocked: false,
      })),
    };
  });
  on('config.set', (_, e) => {
    seen.configSets.push(`${e.key}=${String(e.value)}`);
    return { value: config.savedAs ?? e.value };
  });
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('session.id', () => ({ value: 'session-1' }));
  on('store.get', async (_, e) => {
    if (config.countReadGate !== undefined && e.key.startsWith('commitJokes.')) {
      config.countReadGate.entered();
      await config.countReadGate.released;
    }
    const isCount = e.key.startsWith('commitJokes.') && 'countReadsAs' in config;
    return { value: isCount ? config.countReadsAs : store.get(e.key) };
  });
  on('store.set', async (_, e) => {
    if (config.firstRunSetGate !== undefined && e.key === 'firstRunSeen') {
      config.firstRunSetGate.entered();
      await config.firstRunSetGate.released;
    }
    if (config.isStoreSetFailing === true) {
      throw new Error('the store failed');
    }
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
  on('ui.log', (_, e) => {
    seen.logs.push(e.text);
    return { value: undefined };
  });
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>{e.props.word}</Text>;
  });
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box>
        <Text>{e.props.word}</Text>
        <Text>{` for ${e.props.durationMs / 1000}s · done 3:40 PM`}</Text>
      </Box>
    );
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
  surface: 'terminal' | 'desktop' | 'vscode',
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
  expect(await spinnerWord($, 'vscode', 'Creating notes.md', null)).toBe('Creating notes.md');
  expect(WORKING.has((await spinnerWord($, 'vscode', 'Working', null)) ?? '')).toBe(true);
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

// Every text a closing line draws, in order: the word, then the label when there is one.
async function closingTexts($: Engine, requestId: string, columns?: number): Promise<string[]> {
  const viewport = columns === undefined ? {} : { viewport: { columns, rows: 24 } };
  const ui = await $.ui.mount({ ...CLOSING, surface: 'terminal', requestId, ...viewport });
  const texts = (await ui.findAll({ type: 'Text' })).map((found) => found.text);
  await ui.unmount();
  return texts;
}

test(
  "a joked closing line carries the label after the engine's own text",
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    await start($);
    await turnWithRow($, 'turn-1', 'row-1', 'answer');
    const [word, tail, label] = await closingTexts($, 'row-1');
    expect(DONE.has(word ?? '')).toBe(true);
    expect(tail).toBe(TAIL);
    expect(label).toBe(`${LABEL_GAP}${FOOTER_LABEL}`);
    expect(await closingTexts($, 'row-unknown')).toEqual(['Brewed', TAIL]);
  },
);

test(
  'discreet labels a joked line without the emoji',
  { options: { ...ALWAYS, preset: 'discreet' } },
  async ($, on) => {
    engine(on);
    await start($);
    await turnWithRow($, 'turn-1', 'row-1', 'answer');
    expect(await closingTexts($, 'row-1')).toEqual([
      expect.any(String),
      TAIL,
      `${LABEL_GAP}${FOOTER_LABEL_DISCREET}`,
    ]);
  },
);

test('the label is left off where it would wrap the line', { options: ALWAYS }, async ($, on) => {
  engine(on);
  await start($);
  await turnWithRow($, 'turn-1', 'row-1', 'answer');
  expect((await closingTexts($, 'row-1', 200)).length).toBe(3);
  expect((await closingTexts($, 'row-1', 40)).length).toBe(2);
});

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
  expect(await closingTexts($, 'row-1')).toEqual([REFUSED_WORD, TAIL]);
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
    await seen.clock.settle();
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
    await seen.clock.settle();
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
    await seen.clock.settle();
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
    await seen.clock.settle();
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

// The pass-through chain (Codex's review, 2026-10-20): each observer at a gating event hands the
// engine the input it was given, exactly once, and returns the engine's answer unchanged. In the
// kit a stand-in that throws is skipped and nothing beneath it answers, so the call rejects; the
// throw tests check that the mod ran it once and handed the rejection on.
const INTERRUPTED = { result: { stdout: '', stderr: '', interrupted: true } } as const;
const BACKGROUNDED = {
  result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'task-1' },
} as const;
const DENIED = { deny: 'not in this folder' } as const;

test(
  'a Bash call reaches the engine once, unchanged, and its answer comes back unchanged',
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    const answers = [COMMITTED, DENIED, INTERRUPTED, BACKGROUNDED, NOTHING] as const;
    const sent = answers.map((_, index) => `git commit -m "feat: ${index}"`);
    const received: string[] = [];
    // The stand-in answers each call by the number in its command, so the calls may overlap.
    on('tool.call', (_, e) => {
      const command = e.tool === 'Bash' ? e.command : e.tool;
      received.push(command);
      return answers[sent.indexOf(command)] ?? NOTHING;
    });
    await start($);
    const returned = await Promise.all(
      sent.map((command) => $.tool.call({ tool: 'Bash', command })),
    );
    expect(returned).toEqual([...answers]);
    expect([...received].sort()).toEqual(sent);
  },
);

test(
  'a Bash call the engine fails on is not run again, and the failure still shows',
  { options: ALWAYS },
  async ($, on) => {
    const seen = engine(on);
    let calls = 0;
    on('tool.call', () => {
      calls += 1;
      throw new Error('the engine failed');
    });
    await start($);
    const outcome = await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' }).then(
      () => 'resolved',
      (error: unknown) => String(error),
    );
    expect(calls).toBe(1);
    expect(outcome.startsWith('HooksError')).toBe(true);
    expect(seen.toasts).toEqual([]);
  },
);

test(
  'turned off mid-session, a commit reaches the engine once and its answer comes back unchanged',
  { options: ALWAYS },
  async ($, on) => {
    const seen = engine(on);
    let calls = 0;
    on('tool.call', () => {
      calls += 1;
      return COMMITTED;
    });
    await start($);
    await $.command.run(run('poop', 'off'));
    expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' })).toEqual(
      COMMITTED,
    );
    await seen.clock.settle();
    expect(calls).toBe(1);
    expect(seen.toasts).toEqual([]);
  },
);

test(
  'a prompt reaches the engine once, unchanged, and its answer comes back unchanged',
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    const prompts: string[] = [];
    on('prompt.submit', (_, e) => {
      prompts.push(`${e.origin.kind}: ${e.text}`);
      return e.text === 'drop me' ? { drop: 'dropped by the engine' } : { text: e.text };
    });
    await start($);
    const typed = await $.prompt.submit({
      text: 'hello',
      origin: { kind: 'composer' },
      wait: false,
    });
    const dropped = await $.prompt.submit({
      text: 'drop me',
      origin: { kind: 'scheduled-trigger' },
      wait: false,
    });
    expect(typed).toEqual({ text: 'hello' });
    expect(dropped).toEqual({ drop: 'dropped by the engine' });
    expect(prompts).toEqual(['composer: hello', 'scheduled-trigger: drop me']);
  },
);

test(
  'a prompt the engine fails on is not sent again, and the failure still shows',
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    let calls = 0;
    on('prompt.submit', () => {
      calls += 1;
      throw new Error('the engine failed');
    });
    await start($);
    const outcome = await $.prompt
      .submit({ text: 'hello', origin: { kind: 'composer' }, wait: false })
      .then(
        () => 'resolved',
        (error: unknown) => String(error),
      );
    expect(calls).toBe(1);
    expect(outcome.startsWith('HooksError')).toBe(true);
  },
);

test(
  'a failure inside the mod after a commit ran does not run the commit again',
  { options: ALWAYS },
  async ($, on) => {
    // A store that fails makes the commit line throw after the call settled; the hook's catch then
    // hands back the settled answer without calling again.
    const seen = engine(on, () => 'poopstack', SEEN_BEFORE, { isStoreSetFailing: true });
    let calls = 0;
    on('tool.call', () => {
      calls += 1;
      return COMMITTED;
    });
    await start($);
    expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' })).toEqual(
      COMMITTED,
    );
    await seen.clock.settle();
    expect(calls).toBe(1);
    expect(seen.toasts).toEqual([]);
    expect(seen.logs.length).toBe(1);
    expect(seen.logs[0]?.startsWith('p(oop)stack: the commit line failed')).toBe(true);
  },
);

test(
  '/poop off reports a setting saved as something else, and fails a headless run',
  { options: ALWAYS },
  async ($, on) => {
    engine(on, () => 'poopstack', SEEN_BEFORE, { savedAs: true });
    await start($);
    const result = await $.command.run(run('poop', 'off'));
    expect(result.text.startsWith('Jokes stopped for this session only')).toBe(true);
    expect(result.text.includes('it was saved as true')).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(await spinnerWord($, 'terminal', 'Pollinating', null)).toBe('Pollinating');
  },
);

test(
  '/poopstack on and a preset report a refused or changed setting',
  { options: { ...ALWAYS, enabled: false } },
  async ($, on) => {
    engine(on, () => 'poopstack', SEEN_BEFORE, { savedAs: false });
    await start($);
    const turnedOn = await $.command.run(run('poopstack', 'on'));
    expect(turnedOn.text.startsWith('Not turned on')).toBe(true);
    expect(turnedOn.exitCode).toBe(1);
    const preset = await $.command.run(run('poopstack', 'maximum'));
    expect(preset.text.startsWith('The preset stays regular')).toBe(true);
    expect(preset.exitCode).toBe(1);
  },
);

test(
  "a failure inside the mod's own command says so and fails a headless run",
  { options: ALWAYS },
  async ($, on) => {
    engine(on, () => 'poopstack', SEEN_BEFORE, { isListFailing: true });
    await start($);
    const result = await $.command.run(run('poop', 'off'));
    expect(result.text.startsWith('The command failed inside p(oop)stack')).toBe(true);
    expect(result.exitCode).toBe(1);
  },
);

test(
  'a session that began with no session.start, as after /clear, sets its dice at its first turn',
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    const writes: string[] = [];
    on('state.set', (_, e, next) => {
      writes.push(e.key);
      return next(e);
    });
    await $.turn.start({ text: 'go', turnId: 'turn-1' });
    expect(writes.includes('rng') && writes.includes('outcomeMisses')).toBe(true);
    writes.length = 0;
    await $.turn.complete(TURN);
    expect(writes.includes('phrase')).toBe(true);
  },
);

const COUNT_RESET_START = 'p(oop)stack could not read a saved commit-joke count';

test(
  "a session's start removes a commit count it cannot read, and says so once",
  { options: ALWAYS },
  async ($, on) => {
    const seen = engine(on, () => 'poopstack', {
      ...SEEN_BEFORE,
      'commitJokes.bad': 'malformed',
      'commitJokes.good': { shown: 1, at: NOW },
    });
    await start($);
    expect(seen.storeDeletes).toEqual(['commitJokes.bad']);
    expect(seen.toasts.length).toBe(1);
    expect(seen.toasts[0]?.startsWith(COUNT_RESET_START)).toBe(true);
    await start($);
    expect(seen.toasts.length).toBe(1);
  },
);

test(
  'a commit that meets a count it cannot read says so and starts the pair again',
  { options: ALWAYS },
  async ($, on) => {
    const seen = engine(on, () => 'poopstack', SEEN_BEFORE, { countReadsAs: { shown: 'two' } });
    on('tool.call', () => COMMITTED);
    await start($);
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' });
    await seen.clock.settle();
    expect(seen.toasts.length).toBe(2);
    expect(seen.toasts[0]?.startsWith(COUNT_RESET_START)).toBe(true);
    expect(seen.toasts[1]).toBe(COMMIT_FIRST);
    expect(seen.storeSets).toEqual(['commitJokes.session-1']);
  },
);

test(
  '/poop off typed while a commit joke is in flight stops it before its write and its toast',
  { options: ALWAYS },
  async ($, on) => {
    const entered = latch();
    const released = latch();
    const countReadGate = { entered: entered.open, released: released.promise };
    const seen = engine(on, () => 'poopstack', SEEN_BEFORE, { countReadGate });
    on('tool.call', () => COMMITTED);
    await start($);
    const call = $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' });
    await entered.promise;
    await $.command.run(run('poop', 'off'));
    released.open();
    await seen.clock.settle();
    expect(await call).toEqual(COMMITTED);
    expect(seen.configSets).toEqual(['poopstack.enabled=false']);
    expect(seen.storeSets).toEqual([]);
    expect(seen.toasts).toEqual([]);
  },
);

test(
  'two commits that end together show his two lines in order',
  { options: ALWAYS },
  async ($, on) => {
    const seen = engine(on);
    on('tool.call', () => COMMITTED);
    await start($);
    await Promise.all([
      $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' }),
      $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: y"' }),
    ]);
    await seen.clock.settle();
    expect(seen.toasts).toEqual([COMMIT_FIRST, COMMIT_SECOND]);
  },
);

test(
  "a row that comes after the next turn started is left to Claude Code, and so is its turn's line",
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    await start($);
    const rowOf = (uuid: string) =>
      ({
        message: { type: 'system', name: 'turn_duration', content: [] },
        door: 'notice',
        origin: { kind: 'unclassified' },
        uuid,
      }) as const;
    const end = (turnId: string) =>
      ({ ...TURN_BASE, turnId, isAborted: false, reason: 'answer' }) as const;
    await $.turn.start({ text: 'go', turnId: 'turn-a' });
    await $.turn.complete(end('turn-a'));
    const second = (await spinnerWord($, 'terminal', 'Pollinating', null)) ?? '';
    await $.turn.start({ text: 'typed during turn a', turnId: 'turn-b' });
    await $.session.append(rowOf('row-a'));
    await $.session.append(rowOf('row-b'));
    await $.turn.complete(end('turn-b'));
    expect(await closingText($, 'row-a')).toBe('Brewed');
    expect(await closingText($, 'row-b')).toBe(DONE_OF.get(second) ?? '');
  },
);

test(
  "a commit's result comes back before its joke's bookkeeping finishes",
  { options: ALWAYS },
  async ($, on) => {
    const entered = latch();
    const released = latch();
    const countReadGate = { entered: entered.open, released: released.promise };
    const seen = engine(on, () => 'poopstack', SEEN_BEFORE, { countReadGate });
    on('tool.call', () => COMMITTED);
    await start($);
    expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' })).toEqual(
      COMMITTED,
    );
    await entered.promise;
    expect(seen.toasts).toEqual([]);
    released.open();
    await seen.clock.settle();
    expect(seen.toasts).toEqual([COMMIT_FIRST]);
  },
);

test(
  "a commit whose count read stalls never holds the next turn's hooks",
  { options: ALWAYS },
  async ($, on) => {
    const entered = latch();
    const released = latch();
    const countReadGate = { entered: entered.open, released: released.promise };
    const seen = engine(on, () => 'poopstack', SEEN_BEFORE, { countReadGate });
    on('tool.call', () => COMMITTED);
    await start($);
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' });
    await entered.promise;
    await $.turn.start({ text: 'next', turnId: 'turn-2' });
    await $.turn.complete({ ...TURN, turnId: 'turn-2' });
    released.open();
    await seen.clock.settle();
    expect(seen.toasts).toEqual([COMMIT_FIRST]);
  },
);

test(
  '/poop off typed while the first-run flag is being written stops its cleanup and its toast',
  { options: ALWAYS },
  async ($, on) => {
    const entered = latch();
    const released = latch();
    const firstRunSetGate = { entered: entered.open, released: released.promise };
    const seen = engine(on, () => 'poopstack', {}, { firstRunSetGate });
    on('prompt.submit', (_, e) => ({ text: e.text }));
    await start($);
    await $.prompt.submit({ text: 'hello', origin: { kind: 'composer' }, wait: false });
    const done = $.turn.complete(TURN);
    await entered.promise;
    await $.command.run(run('poop', 'off'));
    released.open();
    await done;
    expect(seen.storeDeletes).toEqual([]);
    expect(seen.toasts).toEqual([]);
  },
);

test(
  'a turn interrupted after the next one started leaves that next turn its own row',
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    await start($);
    const end = (turnId: string, reason: 'answer' | 'aborted') =>
      ({ ...TURN_BASE, turnId, isAborted: reason === 'aborted', reason }) as const;
    await $.turn.start({ text: 'go', turnId: 'turn-a' });
    await $.turn.start({ text: 'typed during turn a', turnId: 'turn-b' });
    await $.turn.complete(end('turn-a', 'aborted'));
    await $.session.append({
      message: { type: 'system', name: 'turn_duration', content: [] },
      door: 'notice',
      origin: { kind: 'unclassified' },
      uuid: 'row-b',
    });
    await $.turn.complete(end('turn-b', 'answer'));
    expect(DONE.has(await closingText($, 'row-b'))).toBe(true);
  },
);
