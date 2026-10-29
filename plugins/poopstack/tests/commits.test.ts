import { expect, test } from 'claude-code/testing';
import { COMMIT_COUNT_KEEP_MS, commitCountKey, isStale, readCount } from '../hooks/commits';

test('a session with nothing stored has shown no commit line', () => {
  expect(commitCountKey('session-1')).toBe('commitJokes.session-1');
  expect(readCount(undefined)).toEqual({ kind: 'none' });
  expect(readCount({ shown: 2, at: 5 })).toEqual({ kind: 'count', count: { shown: 2, at: 5 } });
});

test('a stored value of any other shape reads as malformed, never as a count', () => {
  const others = [
    null,
    true,
    3,
    'x',
    [],
    { shown: 1 },
    { shown: -1, at: 5 },
    { shown: 1.5, at: 5 },
  ];
  for (const held of others) {
    expect(readCount(held)).toEqual({ kind: 'malformed' });
  }
});

test('a count is stale only once it is untouched past the keep bound', () => {
  const at = 1_000;
  const atTheBound = at + COMMIT_COUNT_KEEP_MS;
  const pastTheBound = atTheBound + 1;
  expect(isStale({ shown: 1, at }, atTheBound)).toBe(false);
  expect(isStale({ shown: 1, at }, pastTheBound)).toBe(true);
});
