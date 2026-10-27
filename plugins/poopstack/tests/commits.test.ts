import { expect, test } from 'claude-code/testing';
import { COMMIT_COUNT_KEEP_MS, commitCountKey, isStale, shownSoFar } from '../hooks/commits';

const KEY = commitCountKey('session-1');

test('a session with nothing stored has shown no commit line', () => {
  expect(KEY).toBe('commitJokes.session-1');
  expect(shownSoFar(KEY, undefined)).toBe(0);
  expect(shownSoFar(KEY, { shown: 2, at: 5 })).toBe(2);
});

test('a stored value this mod could not have written throws, naming its key', () => {
  for (const held of [null, true, 3, 'x', [], { shown: 1 }, { shown: -1, at: 5 }]) {
    expect(() => shownSoFar(KEY, held)).toThrow('poopstack: $.store commitJokes.session-1');
  }
  expect(() => shownSoFar(KEY, { shown: 1.5, at: 5 })).toThrow('is not a commit count');
  expect(() => isStale(KEY, { at: 5 }, 10)).toThrow('is not a commit count');
});

test('a count is stale only once it is untouched past the keep bound', () => {
  const at = 1_000;
  expect(isStale(KEY, { shown: 1, at }, at + COMMIT_COUNT_KEEP_MS)).toBe(false);
  expect(isStale(KEY, { shown: 1, at }, at + COMMIT_COUNT_KEEP_MS + 1)).toBe(true);
});
