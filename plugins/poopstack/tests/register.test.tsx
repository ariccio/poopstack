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

type Seen = { toasts: string[]; configSets: string[] };

// Nothing sits beneath the mod: these hooks stand for the engine. The two lines draw the word
// they were handed, so a test reads what the mod passed on. `holder` names who registered each
// visible name (another plugin can hold one).
function engine(on: On, holder: (name: string) => string = () => 'poopstack'): Seen {
  const seen: Seen = { toasts: [], configSets: [] };
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
  on('store.get', () => ({ value: true }));
  on('store.set', () => ({ value: undefined }));
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

test(
  'confirmed commits show his two lines in order, then the first again',
  { options: ALWAYS },
  async ($, on) => {
    const seen = engine(on);
    on('tool.call', () => ({ result: {} }));
    await start($);
    const commit = { tool: 'Bash', command: 'git commit -m "feat: x"' } as const;
    await $.tool.call(commit);
    await $.tool.call(commit);
    await $.tool.call(commit);
    expect(seen.toasts).toEqual([COMMIT_FIRST, COMMIT_SECOND, COMMIT_FIRST]);
  },
);

test(
  'a failed or compound commit shows nothing, and the result passes on unchanged',
  { options: ALWAYS },
  async ($, on) => {
    const seen = engine(on);
    on('tool.call', (_, e) =>
      e.tool === 'Bash' && e.command.includes('fail')
        ? { result: {}, isError: true, text: 'exit 1' }
        : { result: {} },
    );
    await start($);
    const failed = await $.tool.call({ tool: 'Bash', command: 'git commit -m fail' });
    await $.tool.call({ tool: 'Bash', command: 'git add . && git commit -m x' });
    expect(failed.isError).toBe(true);
    expect(seen.toasts).toEqual([]);
  },
);
