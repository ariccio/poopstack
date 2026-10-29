import { expect, test } from 'claude-code/testing';

test('session.start reaches the engine unchanged', async ($, on) => {
  // Nothing sits beneath the mod: this hook stands for the engine.
  on('session.start', (_, e) => ({ cwd: e.cwd }));

  const result = await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true });

  expect(result.cwd).toBe('/work');
});
