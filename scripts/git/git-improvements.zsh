#!/usr/bin/env zsh
# git-improvements.zsh — repo-local Git configuration hardening bundle.
#
# Ports the "FOSDEM 2024 — So You Think You Know Git" configuration bundle
# (https://www.youtube.com/watch?v=aolI_Rz0ZqY) from an earlier standalone
# script by the same author into this repo's zsh + loud-fail conventions
# (.claude/rules/error-handling.md).
#
# Sets exactly SIX bundle items (EIGHT `git config --local` keys — the
# fsckobjects item is a trio of three keys kept together as one concept):
#   1. rerere.enabled          true
#   2. rerere.autoupdate       true
#   3. diff.colorMoved         default
#   4. help.autocorrect        prompt
#   5. core.compression        9
#   6. fsckobjects trio:
#        transfer.fsckobjects  true
#        fetch.fsckobjects     true
#        receive.fsckobjects   true
#
# 2026-10-01: `merge.verbose` (formerly item 3) removed. It was a phantom: git
# has no key of that name (it has `merge.verbosity`, an integer), so the write
# stored a value nothing ever read. Evidence (Apple Git-155, git 2.50.1):
# `git help --config | grep -ix 'merge.verbose'` prints nothing, while the
# same search for 'merge.verbosity' prints the real key.
# The run-time counts below are derived from the keys actually attempted, and
# scripts/git/git-improvements.test.zsh checks every written key against the
# installed git's `git help --config`.
#
# Idempotent + safe to re-run: every write reads the "before" value, applies
# the write, then reads the value BACK to confirm it actually stuck — a `git
# config` exit-0 that silently failed to persist (e.g. a stray include, a
# read-only worktree config file) would otherwise be a silent success, which
# the house error-handling doctrine forbids. This is the one deliberate
# addition over the original, which trusted `git config`'s exit
# code alone.
#
# Standalone by design (matches the original's own framing: "This script can
# be run in any Git repository"): operates on whatever repository contains
# the CURRENT WORKING DIRECTORY, not on this script's own location — do NOT
# add a `cd` to this repo's root here.
#
# Usage:
#   zsh scripts/git/git-improvements.zsh
#
# Exit codes:
#   0  all bundle items applied and verified
#   1  not inside a git repository, OR one or more bundle items failed
set -euo pipefail

# Neutralise the inherited git environment before the first git call.
#
# This script's contract, stated above, is that it operates on the repository
# containing the CURRENT WORKING DIRECTORY. An inherited GIT_DIR silently
# overrides that: git resolves GIT_DIR before it ever consults cwd, so in the
# post-checkout / post-merge hook venue -- where git exports GIT_DIR -- the
# documented contract was not the one being honoured. Clearing the three
# locator variables at file scope makes every git call below (the repository
# guard, --show-toplevel, --git-path rr-cache, and the eight `git config
# --local` writes) resolve the SAME repository by the SAME rule, in every
# venue. Partial neutralisation would be worse than none: a guard reading one
# repository while the writes land in another is split-brain, not safety.
#
# Measured 2026-08-30 on git 2.50.1, disposable repo + linked worktree: with
# cwd at a worktree top level, `git config --local` writes to the identical
# file with GIT_DIR inherited and with GIT_DIR cleared (both landed in the
# shared <repo>/.git/config). So this is a no-op in the designed venue and a
# correction everywhere else. No check in this repository enforces this line: its own test runs
# the script under `env -i`, so no GIT_DIR is inherited there. Keep it by review.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

local script_path="scripts/git/git-improvements.zsh"

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  print -ru2 -- "✗ FATAL(git-improvements): not inside a git repository"
  print -ru2 -- "    detected at : ${script_path}"
  print -ru2 -- "    cwd         : ${PWD}"
  print -ru2 -- "    remediation : run this script from inside the target repository"
  exit 1
fi

local repo_toplevel repo_name
repo_toplevel="$(git rev-parse --show-toplevel)"
repo_name="${repo_toplevel:t}"

print -r -- "Applying the FOSDEM-2024 git configuration bundle to: ${repo_name}"
print -r -- "  (source talk: \"So You Think You Know Git\" — https://www.youtube.com/watch?v=aolI_Rz0ZqY)"
print -r --

typeset -a fatal_failures=()
typeset -a summary_keys=()
typeset -a summary_before=()
typeset -a summary_after=()
# Counted at each attempt, so the user-facing totals cannot drift from the
# list of writes below (they were literals until 2026-10-01).
integer attempted_key_count=0

# read_config_value — print the current --local value of a key, or the
# literal string "(unset)" if the key has no local value. Never lets an
# absent key masquerade as an empty string in the summary table.
read_config_value() {
  local key="$1"
  git config --local --get "${key}" 2> /dev/null || print -r -- '(unset)'
}

# set_git_config_key — apply one `git config --local` write, verify it
# actually stuck via readback, and record the outcome. Returns 1 (and
# records into fatal_failures) on either a nonzero `git config` exit OR a
# readback mismatch; never silently continues past either.
set_git_config_key() {
  local key="$1" desired_value="$2"
  local before_value after_value

  (( attempted_key_count += 1 ))
  before_value="$(read_config_value "${key}")"

  if ! git config --local "${key}" "${desired_value}"; then
    print -ru2 -- "✗ FATAL(git-improvements): 'git config --local ${key} ${desired_value}' exited nonzero"
    print -ru2 -- "    detected at : ${script_path}"
    print -ru2 -- "    before      : ${before_value}"
    fatal_failures+=("${key} (write failed)")
    return 1
  fi

  after_value="$(read_config_value "${key}")"
  if [[ "${after_value}" != "${desired_value}" ]]; then
    print -ru2 -- "✗ FATAL(git-improvements): readback mismatch for '${key}' after a successful write"
    print -ru2 -- "    detected at : ${script_path}"
    print -ru2 -- "    expected    : ${desired_value}"
    print -ru2 -- "    observed    : ${after_value}"
    print -ru2 -- "    rationale   : a write that reports success but does not stick is a broken"
    print -ru2 -- "                  invariant in this script or the local git config, never a"
    print -ru2 -- "                  silent success (house error-handling doctrine)"
    fatal_failures+=("${key} (readback mismatch)")
    return 1
  fi

  summary_keys+=("${key}")
  summary_before+=("${before_value}")
  summary_after+=("${after_value}")
  return 0
}

# rerere needs its cache directory to record conflict resolutions; git will
# create it lazily on first use, but creating it here up front means the
# feature is fully ready immediately after this script exits, matching the
# original's behavior.
#
# Resolved via `git rev-parse --git-path rr-cache` rather than a hardcoded
# "${repo_toplevel}/.git/rr-cache" — in a LINKED WORKTREE, `.git` is a plain
# FILE (a gitdir pointer), not a directory, so the hardcoded path would try
# to mkdir a subdirectory of a file and fail with ENOTDIR, exactly where
# rerere matters most (parallel-worktree workflows). rr-cache is one of
# git's shared/common-dir items (gitrepository-layout), so --git-path
# resolves to the ONE shared cache honoring git-dir indirection, regardless
# of which worktree invoked this script. Only the PARENT (the git-dir
# itself) is guaranteed to already exist, so that's what gets resolved via
# cd+pwd; rr-cache itself may not exist yet, which is exactly what this
# mkdir -p is for.
local rr_cache_raw rr_cache_dir
rr_cache_raw="$(git rev-parse --git-path rr-cache)"
case "${rr_cache_raw}" in
  /*) rr_cache_dir="${rr_cache_raw}" ;;
  *) rr_cache_dir="$(cd "${rr_cache_raw:h}" && pwd)/${rr_cache_raw:t}" ;;
esac

if ! mkdir -p "${rr_cache_dir}" 2> /dev/null; then
  print -ru2 -- "✗ FATAL(git-improvements): failed to create rerere cache directory"
  print -ru2 -- "    detected at : ${script_path}"
  print -ru2 -- "    path        : ${rr_cache_dir}"
  fatal_failures+=("rerere cache directory")
elif [[ ! -d "${rr_cache_dir}" ]]; then
  print -ru2 -- "✗ FATAL(git-improvements): mkdir -p reported success but rerere cache directory is missing"
  print -ru2 -- "    detected at : ${script_path}"
  print -ru2 -- "    path        : ${rr_cache_dir}"
  fatal_failures+=("rerere cache directory (readback mismatch)")
fi

if ! set_git_config_key "rerere.enabled" "true"; then :; fi
if ! set_git_config_key "rerere.autoupdate" "true"; then :; fi
if ! set_git_config_key "diff.colorMoved" "default"; then :; fi
if ! set_git_config_key "help.autocorrect" "prompt"; then :; fi
if ! set_git_config_key "core.compression" "9"; then :; fi
if ! set_git_config_key "transfer.fsckobjects" "true"; then :; fi
if ! set_git_config_key "fetch.fsckobjects" "true"; then :; fi
if ! set_git_config_key "receive.fsckobjects" "true"; then :; fi

print -r -- "Before -> after summary:"
integer i
for (( i = 1; i <= ${#summary_keys[@]}; i++ )); do
  printf '  %-22s %-10s -> %s\n' "${summary_keys[i]}" "${summary_before[i]}" "${summary_after[i]}"
done

if (( ${#fatal_failures[@]} > 0 )); then
  print -r --
  print -ru2 -- "✗ git-improvements: ${#fatal_failures[@]} of ${attempted_key_count} configuration key(s) failed in ${repo_name}:"
  local failure
  for failure in "${fatal_failures[@]}"; do
    print -ru2 -- "    - ${failure}"
  done
  print -ru2 -- "  Some settings may not have been applied — re-run after resolving the cause above."
  exit 1
fi

print -r --
print -r -- "✓ git-improvements: all ${attempted_key_count} configuration key(s) applied and verified in ${repo_name}."
print -r --

# --- informational only (read-only; never writes): suggest matching GLOBAL
#     settings, mirroring the original's own end-of-run suggestions. ---
local global_rerere global_maintenance
global_rerere="$(git config --global --get rerere.enabled 2> /dev/null || print -r -- '')"
if [[ "${global_rerere}" != "true" ]]; then
  print -r -- "Suggestion: enable rerere globally for every repository on this machine:"
  print -r -- "    git config --global rerere.enabled true"
  print -r --
fi

global_maintenance="$(git config --global --get maintenance.auto 2> /dev/null || print -r -- '')"
if [[ "${global_maintenance}" != "true" ]]; then
  print -r -- "Suggestion: enable git maintenance for faster repository operations:"
  print -r -- "    git config --global maintenance.auto true"
  print -r -- "    git maintenance register"
  print -r -- "    git maintenance start"
  print -r --
fi

exit 0
