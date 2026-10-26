import { expect, type TestBody, test } from 'claude-code/testing';
import { COMMIT_FIRST, COMMIT_SECOND, poolFor } from '../hooks/vocabulary';

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

type Seen = {
  toasts: string[];
  configSets: string[];
  storeSets: string[];
  storeDeletes: string[];
};

// Nothing sits beneath the mod: these hooks stand for the engine. The two lines draw the word
// they were handed, so a test reads what the mod passed on. `holder` names who registered each
// visible name (another plugin can hold one).
function engine(
  on: On,
  holder: (name: string) => string = () => 'poopstack',
  stored: unknown = true,
): Seen {
  const seen: Seen = { toasts: [], configSets: [], storeSets: [], storeDeletes: [] };
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
  on('clock.now', () => ({ value: 1_000 }));
  on('store.get', () => ({ value: stored }));
  on('store.set', (_, e) => {
    seen.storeSets.push(e.key);
    return { value: undefined };
  });
  on('store.delete', (_, e) => {
    seen.storeDeletes.push(e.key);
    return { value: undefined };
  });
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

test(
  'a closing line gets a past form, and keeps it on every redraw',
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    await start($);
    const ui = await $.ui.mount({ ...CLOSING, surface: 'terminal', requestId: 'row-1' });
    const first = (await ui.find({ type: 'Text' }))?.text ?? '';
    await ui.redraw();
    const again = (await ui.find({ type: 'Text' }))?.text ?? '';
    await ui.unmount();
    expect(DONE.has(first)).toBe(true);
    expect(again).toBe(first);
  },
);

test(
  'the expanded view and the waiting text are left to the engine',
  { options: ALWAYS },
  async ($, on) => {
    engine(on);
    await start($);
    const expanded = { ...CLOSING.props, isExpanded: true };
    const waiting = { ...CLOSING.props, waitingFor: { agents: [], workflows: 0 } };
    const one = await $.ui.mount({ ...CLOSING, surface: 'terminal', props: expanded });
    expect((await one.find({ type: 'Text' }))?.text).toBe('Brewed');
    await one.unmount();
    const two = await $.ui.mount({ ...CLOSING, surface: 'terminal', props: waiting });
    expect((await two.find({ type: 'Text' }))?.text).toBe('Brewed');
    await two.unmount();
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
    // Nothing stored yet on this machine: the store answers null.
    const seen = engine(on, () => 'poopstack', null);
    on('prompt.submit', (_, e) => ({ text: e.text }));
    on('turn.complete', (_, e) => ({ text: e.text }));
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
