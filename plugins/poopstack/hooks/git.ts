// Whether a Bash call made a commit, by the engine's own account. Claude Code reports git's effect
// on the call's result (`gitOperation.commit`, with the new commit's sha), whatever shape the
// command had: a chain, a pipe, a heredoc message. Reading the command's text instead missed
// about a third of real commits (measured 2026-10-26 over 30 days of transcripts: 202 of 502
// commit commands passed the text check; the engine recorded 300 commits). A call that made no
// commit, or whose report is missing, is not a commit to joke about.

export type CommitKind = 'committed' | 'amended';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A cherry-pick also makes a commit, but not one Claude composed; it is left out.
export function commitKind(result: unknown): CommitKind | null {
  if (!isRecord(result)) {
    return null;
  }
  const { gitOperation } = result;
  if (!isRecord(gitOperation)) {
    return null;
  }
  const { commit } = gitOperation;
  if (!isRecord(commit)) {
    return null;
  }
  const { kind } = commit;
  return kind === 'committed' || kind === 'amended' ? kind : null;
}
