import { expect, test } from 'claude-code/testing';
import { isPlainCommit } from '../hooks/git';

test('a plain commit is recognised, its message whatever it holds', () => {
  expect(isPlainCommit('git commit -m "feat: add the bag"', false)).toBe(true);
  expect(isPlainCommit("git commit -m 'a; b && c | d'", false)).toBe(true);
  expect(isPlainCommit('git -C /tmp/x commit -am wip', false)).toBe(true);
  expect(
    isPlainCommit(
      `git commit -m "$(cat <<'EOF'\nfeat(core): add the bag\n\nBody; with && signs.\nEOF\n)"`,
      false,
    ),
  ).toBe(true);
});

test('anything the exit status cannot confirm is not a commit to joke about', () => {
  expect(isPlainCommit('git commit -m x && git push', false)).toBe(false);
  expect(isPlainCommit('cd repo && git commit -m x', false)).toBe(false);
  expect(isPlainCommit('git commit -m x; echo done', false)).toBe(false);
  expect(isPlainCommit('git commit -m x | tee log', false)).toBe(false);
  expect(isPlainCommit('git commit --dry-run -m x', false)).toBe(false);
  expect(isPlainCommit('git commit -m x', true)).toBe(false);
  expect(isPlainCommit('git commit-tree abc', false)).toBe(false);
  expect(isPlainCommit('git status', false)).toBe(false);
  expect(isPlainCommit('echo git commit', false)).toBe(false);
});
