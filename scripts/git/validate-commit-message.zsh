#!/usr/bin/env zsh
# validate-commit-message.zsh — the commit-msg check: the commit's SUBJECT
# line must be a conventional-commit subject.
#
# Called by lefthook's commit-msg `validate-message` job with git's message
# file ({1}). git also runs commit-msg for `git merge` (githooks(5)), so merge
# messages are judged the same way.
#
# 2026-10-01: the check moved here from an inline `grep`
# in lefthook.yml. That grep matched ANY line of the file, so a message whose
# subject was not conventional passed whenever one body line was (a
# "Merge branch 'x'" subject over a "feat: ..." body line). Now only the
# subject is judged. The accepted pattern and the failure text are unchanged;
# one line naming the judged subject is added after the text.
#
# The subject is the first line that is neither blank (empty or whitespace
# only) nor a '#' comment line. Measured on git 2.50.1 (Apple Git-155) in a
# disposable repository, 2026-10-01: with -m or -F, git has already removed
# leading blank lines before this hook runs, and keeps '#' lines; with an
# editor, the hook sees the edited text before git's clean-up, so blank and
# '#' lines can precede the subject (git-commit(1), --cleanup).
#
# Residuals, recorded 2026-10-01:
#   - a -m or -F message whose first non-blank line starts with '#' keeps that
#     line as its real subject (git's default clean-up keeps '#' lines when no
#     editor runs), but this check skips it and judges a later line;
#   - a repository that sets core.commentChar to something other than '#'
#     would have its comment lines judged as subjects (this repository does not set it).
#
# Usage:
#   zsh scripts/git/validate-commit-message.zsh <commit-message-file>
#
# Exit codes:
#   0  the subject is conventional
#   1  the subject is not conventional (the format help is printed)
#   2  broken invariant: not exactly one argument, the message file is missing
#      or unreadable (git always hands commit-msg a readable file), or grep
#      could not evaluate the subject. Never a pass.
#
# Tests: scripts/git/validate-commit-message.test.zsh (pnpm test:validate-commit-message).
set -uo pipefail

typeset -r script_path="scripts/git/validate-commit-message.zsh"
typeset -r conventional_subject_pattern='^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)(\(.+\))?: .{1,}'

report_broken_invariant() {
  local failure_marker="$1"
  local what_failed="$2"
  local expected="$3"
  local observed="$4"
  local remediation="$5"
  print -ru2 -- "✗ FATAL(validate-commit-message): ${failure_marker}: ${what_failed}"
  print -ru2 -- "    detected at : ${script_path}"
  print -ru2 -- "    expected    : ${expected}"
  print -ru2 -- "    observed    : ${observed}"
  print -ru2 -- "    remediation : ${remediation}"
}

if (( $# != 1 )); then
  report_broken_invariant "COMMIT_MESSAGE_VALIDATOR_USAGE" \
    "expected exactly one argument, the commit message file" \
    "one argument (lefthook passes git's message file as {1})" \
    "$# argument(s)" \
    "call it as the lefthook commit-msg job does: zsh ${script_path} {1}"
  exit 2
fi

typeset -r message_file="$1"
if [[ ! -f "${message_file}" || ! -r "${message_file}" ]]; then
  report_broken_invariant "COMMIT_MESSAGE_FILE_UNREADABLE" \
    "the commit message file is missing or unreadable" \
    "a readable regular file (git always hands commit-msg one)" \
    "'${message_file}'" \
    "check the commit-msg wiring in lefthook.yml passes {1}; a missing message is never a pass"
  exit 2
fi

# read_subject_line — set subject_line to the first line on standard input
# that is neither blank nor a '#' comment line; leave it empty if none is.
typeset subject_line=""
read_subject_line() {
  local candidate_line
  while IFS= read -r candidate_line || [[ -n "${candidate_line}" ]]; do
    if [[ -z "${candidate_line//[[:space:]]/}" ]]; then
      continue
    fi
    if [[ "${candidate_line}" == '#'* ]]; then
      continue
    fi
    subject_line="${candidate_line}"
    return 0
  done
  return 0
}

if ! read_subject_line < "${message_file}"; then
  report_broken_invariant "COMMIT_MESSAGE_FILE_UNREADABLE" \
    "the commit message file could not be read" \
    "a readable regular file (git always hands commit-msg one)" \
    "'${message_file}' passed the readability check, then the read failed" \
    "retry the commit; if it recurs, inspect the file's permissions"
  exit 2
fi

# grep, not zsh's =~, so the pattern keeps the exact ERE engine the inline
# lefthook check used. A here-string, not a pipe: no SIGPIPE can colour the
# status under pipefail.
integer grep_status=0
grep -qE -- "${conventional_subject_pattern}" <<< "${subject_line}" || grep_status=$?

case "${grep_status}" in
  0)
    exit 0
    ;;
  1)
    print -r -- "✗ Invalid commit message format!"
    print -r -- ""
    print -r -- "✓ Valid format: <type>(<scope>): <subject>"
    print -r -- ""
    print -r -- "Types: feat, fix, docs, style, refactor, test, chore, build, ci, perf, revert"
    print -r -- ""
    print -r -- "Examples:"
    print -r -- "  feat(spinner): add the shuffle bag for base phrases"
    print -r -- "  fix(footer): keep the engine's duration after a rewritten word"
    print -r -- "  docs: describe the off switch in the README"
    print -r -- ""
    print -r -- "Judged subject line: '${subject_line}' (the first line that is neither blank nor a '#' comment)"
    exit 1
    ;;
  *)
    report_broken_invariant "COMMIT_MESSAGE_PATTERN_CHECK_FAILED" \
      "grep could not evaluate the subject line" \
      "grep exit 0 (conventional) or 1 (not conventional)" \
      "grep exit ${grep_status}" \
      "check that grep is installed and on PATH in the hook environment"
    exit 2
    ;;
esac
