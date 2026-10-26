import { expect, test } from 'claude-code/testing';
import { commitKind } from '../hooks/git';

const bash = (gitOperation?: unknown) => ({
  stdout: '',
  stderr: '',
  interrupted: false,
  ...(gitOperation === undefined ? {} : { gitOperation }),
});

test('a commit or an amend the engine reports is a commit', () => {
  const sha = 'c938bc3';
  expect(commitKind(bash({ commit: { sha, kind: 'committed', branch: 'main' } }))).toBe(
    'committed',
  );
  expect(commitKind(bash({ commit: { sha, kind: 'amended' } }))).toBe('amended');
});

test('no report, another git operation, a cherry-pick or a malformed report is not', () => {
  expect(commitKind(bash())).toBe(null);
  expect(commitKind(bash({ push: { branch: 'main' } }))).toBe(null);
  expect(commitKind(bash({ commit: { sha: 'abc1234', kind: 'cherry-picked' } }))).toBe(null);
  expect(commitKind(bash({ commit: 'abc1234' }))).toBe(null);
  expect(commitKind(bash('commit'))).toBe(null);
  expect(commitKind(undefined)).toBe(null);
  expect(commitKind('git commit -m x')).toBe(null);
});
