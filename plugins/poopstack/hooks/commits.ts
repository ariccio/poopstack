import { isRecord } from './git';

// How many commit lines a session has shown, kept in $.store so the count outlives the process: a
// session resumed with `claude --resume` starts with an empty $.state (observed 2026-10-26 on
// Claude Code 2.1.310: the resumed session's first load read nothing its earlier process had
// set), and without this his pair would start again at the deposit line. Each session
// writes only its own key, so sessions running side by side never overwrite each other's count.
// Only the session's id, the count and the time of the last write are stored.

export const COMMIT_COUNT_PREFIX = 'commitJokes.';

// A bound on the store's growth, chosen, not measured: a count untouched for this long is removed
// when a later session starts, and a session resumed after that starts its pair again.
export const COMMIT_COUNT_KEEP_MS: number = 30 * 24 * 60 * 60 * 1000;

export type CommitCount = { readonly shown: number; readonly at: number };

export function commitCountKey(sessionId: string): string {
  return `${COMMIT_COUNT_PREFIX}${sessionId}`;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

// Only this mod writes these keys, so a value of another shape is a broken invariant.
function checked(key: string, held: unknown): CommitCount {
  if (isRecord(held)) {
    const { shown, at } = held;
    if (isCount(shown) && isCount(at)) {
      return { shown, at };
    }
  }
  throw new Error(`poopstack: $.store ${key} is not a commit count ({ shown, at })`);
}

// The commit lines this session showed before now; nothing stored means none.
export function shownSoFar(key: string, held: unknown): number {
  return held === undefined ? 0 : checked(key, held).shown;
}

export function isStale(key: string, held: unknown, now: number): boolean {
  return now - checked(key, held).at > COMMIT_COUNT_KEEP_MS;
}
