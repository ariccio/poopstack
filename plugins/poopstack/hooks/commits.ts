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
const KEEP_DAYS = 30;
const DAY_MS = 86_400_000;
export const COMMIT_COUNT_KEEP_MS: number = KEEP_DAYS * DAY_MS;

export type CommitCount = { readonly shown: number; readonly at: number };

export function commitCountKey(sessionId: string): string {
  return `${COMMIT_COUNT_PREFIX}${sessionId}`;
}

function isCount(value: unknown): value is number {
  if (typeof value !== 'number') {
    return false;
  }
  const isWhole = Number.isSafeInteger(value);
  const isNonNegative = value >= 0;
  return isWhole && isNonNegative;
}

// What a stored commit count holds. The store is shared with the world (the error-handling rules,
// lane 2): a hand edit, another build of the mod or another plugin can leave any value there, so
// a value of another shape is reported and replaced by the caller, never thrown at every start.
export type StoredCount =
  | { readonly kind: 'count'; readonly count: CommitCount }
  | { readonly kind: 'none' }
  | { readonly kind: 'malformed' };

export function readCount(held: unknown): StoredCount {
  if (held === undefined) {
    return { kind: 'none' };
  }
  if (isRecord(held)) {
    const { shown, at } = held;
    if (isCount(shown) && isCount(at)) {
      return { kind: 'count', count: { shown, at } };
    }
  }
  return { kind: 'malformed' };
}

export function isStale(count: CommitCount, now: number): boolean {
  const age = now - count.at;
  return age > COMMIT_COUNT_KEEP_MS;
}
