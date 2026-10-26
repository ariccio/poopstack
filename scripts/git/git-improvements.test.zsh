#!/usr/bin/env zsh
# Regression test for scripts/git/git-improvements.zsh (2026-10-01).
#
# Runs the bundle in a FRESH DISPOSABLE repository and reports five checks
# separately, so a failure names its own cause:
#
#   known-keys       every key the script wrote is one the INSTALLED git knows,
#                    read at test time from `git help --config` (git's own list
#                    of the configuration keys it understands). Never frozen into
#                    this file: a snapshot of a tool's own answer goes stale
#                    silently. Born from `merge.verbose`, a key git never had,
#                    which this bundle wrote from 2026-07-21 to 2026-10-01.
#   intended-values  the eight intended keys hold their intended values.
#   receipt-count    the success line's key count equals the number of keys the
#                    script actually wrote (the count used to be a literal that
#                    could drift from the list).
#   exit-status      the script exits 0.
#   source-unchanged the local config of the repository this test lives in is
#                    identical before and after. The script writes the
#                    repository containing its working directory, so a wrong
#                    working directory or an inherited GIT_DIR would write
#                    the repository's own shared .git/config.
#
# Comparison is case-insensitive (git's section and key names are). Exact
# matches only: `git help --config` documents subsection keys with placeholders
# (`branch.<name>.merge`, `alias.*`), so a future subsection write would fail
# the known-keys check loudly rather than pass it; extend the matcher then.
#
# Venue: a standalone run of the script. Its real venue is the repository's post-checkout
# and post-merge hooks, which this test does not exercise.
# cspell:ignore readback
set -uo pipefail

typeset -r candidate_relative_path="scripts/git/git-improvements.zsh"
typeset -r env_bin="/usr/bin/env"
typeset -r hermetic_path="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# The contract: what the bundle must leave behind. Duplicating the script's
# list here is deliberate; it is the intended state, not a tool's answer.
typeset -ra intended_keys_and_values=(
  rerere.enabled       true
  rerere.autoupdate    true
  diff.colorMoved      default
  help.autocorrect     prompt
  core.compression     9
  transfer.fsckobjects true
  fetch.fsckobjects    true
  receive.fsckobjects  true
)

report_precondition_failure() {
  local failure_marker="$1"
  local what_failed="$2"
  local observed="$3"
  local remediation="$4"
  print -ru2 -- "✗ ${failure_marker}: ${what_failed}"
  print -ru2 -- "    detected at : scripts/git/git-improvements.test.zsh"
  print -ru2 -- "    observed    : ${observed}"
  print -ru2 -- "    remediation : ${remediation}"
}

typeset source_root=""
if ! source_root="$(cd "${0:A:h:h:h}" && pwd -P)" || [[ -z "${source_root}" ]]; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_SOURCE_ROOT_FAILED" \
    "the repository root containing this test could not be resolved" \
    "'${0:A:h:h:h}' did not resolve to a physical directory" \
    "run the test from a poopstack checkout: zsh scripts/git/git-improvements.test.zsh"
  exit 1
fi
typeset -r source_root
typeset -r candidate_source_path="${source_root}/${candidate_relative_path}"
if [[ ! -r "${candidate_source_path}" ]]; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_CANDIDATE_MISSING" \
    "the script under test is missing or unreadable" "${candidate_source_path}" \
    "restore scripts/git/git-improvements.zsh"
  exit 1
fi

# The git the script will run: the first `git` on the same PATH the script is
# handed below. The known-keys list is asked of THIS binary, so the test never
# compares one git's writes against another git's vocabulary.
typeset git_bin=""
git_bin="$(path=(${(s.:.)hermetic_path}); whence -p git)"
if [[ -z "${git_bin}" || ! -x "${git_bin}" ]]; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_GIT_MISSING" \
    "no executable git on the test PATH" "PATH=${hermetic_path}" \
    "install git (Xcode command-line tools or Homebrew), then rerun the test"
  exit 1
fi
typeset -r git_bin

typeset test_temporary_parent=""
if ! test_temporary_parent="$(cd "${TMPDIR:-/tmp}" && pwd -P)" || [[ -z "${test_temporary_parent}" ]]; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_TEMP_PARENT_FAILED" \
    "the temporary parent could not be resolved" "TMPDIR='${TMPDIR:-/tmp}'" \
    "unset TMPDIR or point it at a writable directory"
  exit 1
fi
if [[ "${test_temporary_parent}" == "${source_root}" || "${test_temporary_parent}" == "${source_root}"/* ]]; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_TEMP_PARENT_UNSAFE" \
    "the temporary parent lies inside the repository under test" "${test_temporary_parent}" \
    "unset TMPDIR or point it outside ${source_root}"
  exit 1
fi
typeset -r test_temporary_parent

typeset test_root=""
if ! test_root="$(mktemp -d "${test_temporary_parent}/poopstack-git-improvements-test.XXXXXX")"; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_TEMP_ROOT_FAILED" \
    "mktemp could not create the test root" "parent ${test_temporary_parent}" \
    "check temporary-directory permissions and free space"
  exit 1
fi
typeset -r test_root
print -r -- "GIT_IMPROVEMENTS_TEST_ROOT=${test_root}"

typeset -r hermetic_home="${test_root}/home"
typeset -r hermetic_xdg_config_home="${test_root}/xdg-config"
typeset -r hermetic_tmpdir="${test_root}/tmp"
typeset -r hermetic_empty_template="${test_root}/empty-template"
typeset -r fixture_repository="${test_root}/fixture-repository"
if ! mkdir -p "${hermetic_home}" "${hermetic_xdg_config_home}" "${hermetic_tmpdir}" "${hermetic_empty_template}"; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_SETUP_FAILED" \
    "the hermetic HOME/XDG/TMP/template directories could not be created" "${test_root}" \
    "check temporary-directory permissions and free space"
  exit 1
fi

# hermetic_run: the ONE launcher, the same shape as the hermetic owner in
# scripts/git/install-worktree-safe-lefthook.test.zsh. `env -i` discards the
# whole inherited environment (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and
# anything else a hook venue exports) rather than enumerating it, then names
# the minimal set. The GIT_CONFIG_* entries detach git from the developer's
# global and system configuration.
hermetic_run() {
  "${env_bin}" -i \
    PATH="${hermetic_path}" \
    HOME="${hermetic_home}" \
    XDG_CONFIG_HOME="${hermetic_xdg_config_home}" \
    TMPDIR="${hermetic_tmpdir}" \
    LC_ALL=C \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_CONFIG_SYSTEM=/dev/null \
    GIT_CONFIG_COUNT=0 \
    GIT_ATTR_NOSYSTEM=1 \
    GIT_DISCOVERY_ACROSS_FILESYSTEM=0 \
    GIT_TERMINAL_PROMPT=0 \
    "$@"
}

hermetic_git() {
  hermetic_run "${git_bin}" "$@"
}

hermetic_git_with_template() {
  local template_directory="$1"
  shift
  hermetic_run GIT_TEMPLATE_DIR="${template_directory}" "${git_bin}" "$@"
}

# A bare `git` in this file would inherit the caller's environment; the shadow
# makes such a call fail loudly instead of reaching the wrong repository.
git() {
  print -ru2 -- "✗ GIT_IMPROVEMENTS_TEST_BARE_GIT_CALL: unrouted git invocation 'git $*'"
  print -ru2 -- "    remediation : route it through hermetic_git or hermetic_git_with_template"
  return 2
}

retain_root_and_exit() {
  print -ru2 -- "GIT_IMPROVEMENTS_TEST_RETAINED_ROOT=${test_root}"
  exit 1
}

typeset -r git_version="$(hermetic_git --version)"
print -r -- "git under test: ${git_bin} (${git_version})"

typeset source_config_before=""
if ! source_config_before="$(cd "${source_root}" && hermetic_git config --local --list --show-origin)"; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_SOURCE_CONFIG_UNREADABLE" \
    "the source repository's local config could not be read" "${source_root}" \
    "run the test from a valid poopstack checkout"
  retain_root_and_exit
fi

typeset known_config_keys_text=""
if ! known_config_keys_text="$(hermetic_git help --config)" || [[ -z "${known_config_keys_text}" ]]; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_KNOWN_KEYS_UNAVAILABLE" \
    "'git help --config' failed or printed nothing" "${git_bin} (${git_version})" \
    "the installed git must list its configuration keys; check the git installation"
  retain_root_and_exit
fi
typeset -ra known_config_keys_lowercase=("${(@fL)known_config_keys_text}")

if ! hermetic_git_with_template "${hermetic_empty_template}" init -q "${fixture_repository}" \
    > "${test_root}/init.stdout" 2> "${test_root}/init.stderr"; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_FIXTURE_INIT_FAILED" \
    "git init of the disposable repository failed" "see ${test_root}/init.stderr" \
    "check temporary-directory permissions and the git installation"
  retain_root_and_exit
fi

typeset fixture_config_before=""
if ! fixture_config_before="$(cd "${fixture_repository}" && hermetic_git config --local --list)"; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_FIXTURE_CONFIG_UNREADABLE" \
    "the fresh repository's local config could not be read" "${fixture_repository}" \
    "check the git installation"
  retain_root_and_exit
fi

# The script under test is a CHILD PROCESS: only the environment it is handed
# reaches it, so it runs under hermetic_run with its working directory in the
# disposable repository.
(cd "${fixture_repository}" && hermetic_run /bin/zsh "${candidate_source_path}") \
  > "${test_root}/candidate.stdout" 2> "${test_root}/candidate.stderr"
typeset -ri candidate_status=$?

typeset fixture_config_after=""
if ! fixture_config_after="$(cd "${fixture_repository}" && hermetic_git config --local --list)"; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_FIXTURE_CONFIG_UNREADABLE" \
    "the repository's local config could not be read after the run" "${fixture_repository}" \
    "inspect ${test_root}/candidate.stderr"
  retain_root_and_exit
fi

typeset source_config_after=""
if ! source_config_after="$(cd "${source_root}" && hermetic_git config --local --list --show-origin)"; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_SOURCE_CONFIG_UNREADABLE" \
    "the source repository's local config could not be read after the run" "${source_root}" \
    "inspect ${test_root}/candidate.stderr"
  retain_root_and_exit
fi

# The keys the script wrote: every `key=value` line present after the run that
# was not present before it. `git config --list` prints section and key names
# in lower case.
typeset -a fixture_lines_before=("${(@f)fixture_config_before}")
typeset -a written_keys=()
typeset config_line
for config_line in "${(@f)fixture_config_after}"; do
  if (( ${fixture_lines_before[(Ie)${config_line}]} == 0 )); then
    written_keys+=("${config_line%%=*}")
  fi
done

typeset -i check_failure_count=0
typeset -i suite_failure_count=0

record_failure() {
  print -ru2 -- "    FAIL: $1"
  (( check_failure_count += 1 ))
}

check_known_keys() {
  local written_key
  if (( ${#written_keys[@]} == 0 )); then
    record_failure "the script wrote no keys at all, so this check would pass vacuously"
    return
  fi
  for written_key in "${written_keys[@]}"; do
    if (( ${known_config_keys_lowercase[(Ie)${(L)written_key}]} == 0 )); then
      record_failure "the script wrote '${written_key}', which ${git_bin} (${git_version}) does not list in 'git help --config'"
    fi
  done
}

check_intended_values() {
  local intended_key intended_value observed_value
  for intended_key intended_value in "${intended_keys_and_values[@]}"; do
    if ! observed_value="$(cd "${fixture_repository}" && hermetic_git config --local --get "${intended_key}")"; then
      observed_value="(unset)"
    fi
    if [[ "${observed_value}" != "${intended_value}" ]]; then
      record_failure "${intended_key}: expected '${intended_value}', observed '${observed_value}'"
    fi
  done
}

check_receipt_count() {
  local stdout_text receipt_count
  local -r receipt_pattern='all ([0-9]+) configuration key\(s\) applied and verified'
  stdout_text="$(< "${test_root}/candidate.stdout")"
  if [[ ! "${stdout_text}" =~ ${receipt_pattern} ]]; then
    record_failure "no success receipt ('all N configuration key(s) applied and verified') in the script's output"
    return
  fi
  receipt_count="${match[1]}"
  if (( receipt_count != ${#written_keys[@]} )); then
    record_failure "the receipt claims ${receipt_count} key(s); the script wrote ${#written_keys[@]}: ${(j:, :)written_keys}"
  fi
}

check_exit_status() {
  if (( candidate_status != 0 )); then
    record_failure "the script exited ${candidate_status}; see ${test_root}/candidate.stderr"
  fi
}

check_source_unchanged() {
  if [[ "${source_config_after}" != "${source_config_before}" ]]; then
    record_failure "the local config of ${source_root} changed during the run; the script wrote the real repository"
  fi
}

run_check() {
  local check_name="$1"
  local check_function="$2"
  check_failure_count=0
  print -r -- "check ${check_name} ..."
  "${check_function}"
  if (( check_failure_count == 0 )); then
    print -r -- "  ok"
  else
    print -ru2 -- "  FAILED: ${check_name} (${check_failure_count} assertion(s))"
    (( suite_failure_count += 1 ))
  fi
}

print -r -- "keys written: ${(j:, :)written_keys}"
run_check known-keys check_known_keys
run_check intended-values check_intended_values
run_check receipt-count check_receipt_count
run_check exit-status check_exit_status
run_check source-unchanged check_source_unchanged

if (( suite_failure_count > 0 )); then
  print -ru2 -- "FAILED: ${suite_failure_count} check(s)"
  retain_root_and_exit
fi

# Total success: remove the root this run created, and nothing else. The path
# is re-proved against the shape mktemp was asked for before the removal.
if [[ "${test_root}" != "${test_temporary_parent}"/poopstack-git-improvements-test.* || ! -d "${test_root}" ]]; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_CLEANUP_REFUSED" \
    "the test root does not have the shape this run created" "${test_root}" \
    "investigate; nothing was removed"
  exit 2
fi
if ! /bin/rm -rf -- "${test_root}"; then
  report_precondition_failure "GIT_IMPROVEMENTS_TEST_CLEANUP_FAILED" \
    "all checks passed but the test root could not be removed" "${test_root}" \
    "remove it by hand and investigate the permission or busy-file cause"
  exit 2
fi

print -r -- "OK: 5 checks; test root removed"
exit 0
