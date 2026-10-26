// Recognising a commit the mod can confirm. A Bash call's exit status confirms a commit only when
// the call is one plain `git commit`: a compound, piped or backgrounded command could succeed
// while its commit failed, or fail after it succeeded, so the mod cannot tell and stays quiet.

// Quoted text (a commit message, a `$(cat <<'EOF' … EOF)` body inside double quotes) cannot
// change what runs, so it is set aside before the command's own shape is read.
const QUOTED = /'[^']*'|"(?:\\.|[^"\\])*"/g;
const SEPARATOR = /[;&|\n`]|\$\(/;
const COMMIT = /^\s*git(?:\s+-[cC]\s+\S+)*\s+commit(?:\s|$)/;
const DRY_RUN = /\s--dry-run\b/;

export function isPlainCommit(command: string, isBackground: boolean): boolean {
  if (isBackground) {
    return false;
  }
  const bare = command.replace(QUOTED, "''");
  return COMMIT.test(bare) && !SEPARATOR.test(bare) && !DRY_RUN.test(bare);
}
