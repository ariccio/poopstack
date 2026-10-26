#!/usr/bin/env zsh
# Contract tests for scripts/git/validate-commit-message.zsh, the commit-msg
# check (2026-10-01). The check judges the SUBJECT line only:
# the first line that is neither blank nor a '#' comment line.
#
# Each case runs the real script on a fixture message file in a disposable
# directory; nothing here calls git. Case 01 is the defect that moved the check
# out of an inline lefthook.yml grep: a non-conventional subject passed whenever
# one body line was conventional.
#
# Venue: standalone runs of the script. Its real venue is lefthook's commit-msg
# `validate-message` job, proven separately by a real rejected commit.
set -uo pipefail

typeset -r candidate_relative_path="scripts/git/validate-commit-message.zsh"
typeset -r invalid_format_text="Invalid commit message format"

report_precondition_failure() {
  local failure_marker="$1"
  local what_failed="$2"
  local observed="$3"
  local remediation="$4"
  print -ru2 -- "✗ ${failure_marker}: ${what_failed}"
  print -ru2 -- "    detected at : scripts/git/validate-commit-message.test.zsh"
  print -ru2 -- "    observed    : ${observed}"
  print -ru2 -- "    remediation : ${remediation}"
}

typeset source_root=""
if ! source_root="$(cd "${0:A:h:h:h}" && pwd -P)" || [[ -z "${source_root}" ]]; then
  report_precondition_failure "COMMIT_MESSAGE_TEST_SOURCE_ROOT_FAILED" \
    "the repository root containing this test could not be resolved" \
    "'${0:A:h:h:h}' did not resolve to a physical directory" \
    "run the test from a poopstack checkout: zsh scripts/git/validate-commit-message.test.zsh"
  exit 1
fi
typeset -r source_root
typeset -r candidate_source_path="${source_root}/${candidate_relative_path}"
if [[ ! -r "${candidate_source_path}" ]]; then
  report_precondition_failure "COMMIT_MESSAGE_TEST_CANDIDATE_MISSING" \
    "the script under test is missing or unreadable" "${candidate_source_path}" \
    "restore scripts/git/validate-commit-message.zsh"
  exit 1
fi

typeset test_temporary_parent=""
if ! test_temporary_parent="$(cd "${TMPDIR:-/tmp}" && pwd -P)" || [[ -z "${test_temporary_parent}" ]]; then
  report_precondition_failure "COMMIT_MESSAGE_TEST_TEMP_PARENT_FAILED" \
    "the temporary parent could not be resolved" "TMPDIR='${TMPDIR:-/tmp}'" \
    "unset TMPDIR or point it at a writable directory"
  exit 1
fi
typeset -r test_temporary_parent

typeset test_root=""
if ! test_root="$(mktemp -d "${test_temporary_parent}/poopstack-commit-message-test.XXXXXX")"; then
  report_precondition_failure "COMMIT_MESSAGE_TEST_TEMP_ROOT_FAILED" \
    "mktemp could not create the test root" "parent ${test_temporary_parent}" \
    "check temporary-directory permissions and free space"
  exit 1
fi
typeset -r test_root
print -r -- "COMMIT_MESSAGE_TEST_ROOT=${test_root}"

typeset -g case_directory=""
typeset -gi candidate_status=0
typeset -gi case_failure_count=0
typeset -gi suite_failure_count=0

record_failure() {
  print -ru2 -- "    FAIL: $1"
  (( case_failure_count += 1 ))
}

# start_case NAME [MESSAGE]: a fresh directory per case; with MESSAGE, writes it
# byte for byte (no added newline) to the case's message file.
start_case() {
  local case_name="$1"
  case_failure_count=0
  case_directory="${test_root}/${case_name}"
  if ! mkdir -p "${case_directory}"; then
    record_failure "could not create ${case_directory}"
    return 1
  fi
  if (( $# >= 2 )); then
    if ! print -rn -- "$2" > "${case_directory}/message"; then
      record_failure "could not write the fixture message"
      return 1
    fi
  fi
  return 0
}

# run_candidate [ARGS...]: runs the real script; extra environment comes from
# the caller (the grep-failure case prepends a stub directory to PATH).
run_candidate() {
  /bin/zsh "${candidate_source_path}" "$@" \
    < /dev/null > "${case_directory}/stdout" 2> "${case_directory}/stderr"
  candidate_status=$?
}

expect_status() {
  local expected_status="$1"
  if (( candidate_status != expected_status )); then
    record_failure "exit status: expected ${expected_status}, observed ${candidate_status}"
  fi
}

expect_output_contains() {
  local stream="$1"
  local expected_text="$2"
  if ! grep -Fq -- "${expected_text}" "${case_directory}/${stream}"; then
    record_failure "${stream} lacks '${expected_text}'"
  fi
}

expect_output_lacks() {
  local stream="$1"
  local forbidden_text="$2"
  if grep -Fq -- "${forbidden_text}" "${case_directory}/${stream}"; then
    record_failure "${stream} unexpectedly contains '${forbidden_text}'"
  fi
}

expect_accepted() {
  expect_status 0
  expect_output_lacks stdout "${invalid_format_text}"
}

expect_rejected() {
  expect_status 1
  expect_output_contains stdout "${invalid_format_text}"
}

case_01_nonconventional_subject_with_conventional_body_line() {
  start_case 01 $'Merge branch \'x\'\n\nfeat: a conventional line in the body\n' || return 1
  run_candidate "${case_directory}/message"
  expect_rejected
}

case_02_conventional_subject_with_body() {
  # The orchestrator's merge shape: `-m "<subject>" -m "<trailer lines>"`.
  start_case 02 $'feat(handicap): add the slope adjustment\n\nCo-Authored-By: Example <noreply@example.invalid>\n' || return 1
  run_candidate "${case_directory}/message"
  expect_accepted
}

case_03_nonconventional_subject_without_body() {
  start_case 03 $'Update the handicap table\n' || return 1
  run_candidate "${case_directory}/message"
  expect_rejected
}

case_04_blank_lines_then_conventional_subject() {
  # An empty line and a whitespace-only line, as an editor session can leave.
  start_case 04 $'\n   \nfeat: subject after blank lines\n' || return 1
  run_candidate "${case_directory}/message"
  expect_accepted
}

case_05_comment_lines_then_conventional_subject() {
  start_case 05 $'# a comment line\n# another comment line\nfeat: subject after comment lines\n' || return 1
  run_candidate "${case_directory}/message"
  expect_accepted
}

case_06_type_with_empty_description() {
  start_case 06 $'feat: \n\nbody text after an empty description\n' || return 1
  run_candidate "${case_directory}/message"
  expect_rejected
}

case_07_missing_message_file() {
  start_case 07 || return 1
  run_candidate "${case_directory}/no-such-message-file"
  expect_status 2
  expect_output_contains stderr "COMMIT_MESSAGE_FILE_UNREADABLE"
  expect_output_lacks stdout "${invalid_format_text}"
}

case_08_no_argument() {
  start_case 08 || return 1
  run_candidate
  expect_status 2
  expect_output_contains stderr "COMMIT_MESSAGE_VALIDATOR_USAGE"
  expect_output_lacks stdout "${invalid_format_text}"
}

case_09_rejection_names_the_judged_line() {
  start_case 09 $'WIP handicap table\n\nmore notes, none of them conventional\n' || return 1
  run_candidate "${case_directory}/message"
  expect_rejected
  expect_output_contains stdout "Judged subject line: 'WIP handicap table'"
}

case_10_grep_failure_is_a_broken_invariant() {
  start_case 10 $'feat: a conventional subject\n\nbody text\n' || return 1
  local stub_directory="${case_directory}/stub-bin"
  if ! mkdir -p "${stub_directory}" || \
      ! print -r -- $'#!/bin/sh\nexit 2' > "${stub_directory}/grep" || \
      ! /bin/chmod 755 "${stub_directory}/grep"; then
    record_failure "could not create the failing grep stub"
    return 1
  fi
  PATH="${stub_directory}:${PATH}" run_candidate "${case_directory}/message"
  expect_status 2
  expect_output_contains stderr "COMMIT_MESSAGE_PATTERN_CHECK_FAILED"
  expect_output_lacks stdout "${invalid_format_text}"
}

run_case() {
  local case_function="$1"
  print -r -- "${case_function} ..."
  "${case_function}"
  if (( case_failure_count == 0 )); then
    print -r -- "  ok"
  else
    print -ru2 -- "  FAILED: ${case_function} (${case_failure_count} assertion(s))"
    (( suite_failure_count += 1 ))
  fi
}

run_case case_01_nonconventional_subject_with_conventional_body_line
run_case case_02_conventional_subject_with_body
run_case case_03_nonconventional_subject_without_body
run_case case_04_blank_lines_then_conventional_subject
run_case case_05_comment_lines_then_conventional_subject
run_case case_06_type_with_empty_description
run_case case_07_missing_message_file
run_case case_08_no_argument
run_case case_09_rejection_names_the_judged_line
run_case case_10_grep_failure_is_a_broken_invariant

if (( suite_failure_count > 0 )); then
  print -ru2 -- "FAILED: ${suite_failure_count} case(s)"
  print -ru2 -- "COMMIT_MESSAGE_TEST_RETAINED_ROOT=${test_root}"
  exit 1
fi

# Total success: remove the root this run created, and nothing else. The path
# is re-proved against the shape mktemp was asked for before the removal.
if [[ "${test_root}" != "${test_temporary_parent}"/poopstack-commit-message-test.* || ! -d "${test_root}" ]]; then
  report_precondition_failure "COMMIT_MESSAGE_TEST_CLEANUP_REFUSED" \
    "the test root does not have the shape this run created" "${test_root}" \
    "investigate; nothing was removed"
  exit 2
fi
if ! /bin/rm -rf -- "${test_root}"; then
  report_precondition_failure "COMMIT_MESSAGE_TEST_CLEANUP_FAILED" \
    "all cases passed but the test root could not be removed" "${test_root}" \
    "remove it by hand and investigate the permission or busy-file cause"
  exit 2
fi

print -r -- "OK: 10 cases; test root removed"
exit 0
