#!/usr/bin/env zsh
# claude-plugin.zsh — run Claude Code's own checks on the mod in plugins/poopstack:
#   validate : `claude plugin validate --strict` on the mod, then on the repository's
#              marketplace file (warnings fail too)
#   test     : `claude plugin test` (every *.test.ts and *.test.tsx in the mod)
# A missing `claude` CLI is a visible failure, never a skip (require-tool.zsh).
#
# Usage:  claude-plugin.zsh validate|test
set -u
local here="${0:A:h}"
local mod_folder="${here:h:h}/plugins/poopstack"
local action="${1:-}"

"${here}/require-tool.zsh" claude \
  "install Claude Code (https://code.claude.com/docs)" \
  "claude plugin ${action}" || exit $?

case "${action}" in
  validate)
    claude plugin validate --strict "${mod_folder}" || exit $?
    exec claude plugin validate --strict "${here:h:h}"
    ;;
  test)
    exec claude plugin test "${mod_folder}"
    ;;
  *)
    print -u2 -- "✗ FATAL(claude-plugin): unknown action '${action}'"
    print -u2 -- "    expected     : validate or test"
    print -u2 -- "    detected at  : ${0}"
    exit 2
    ;;
esac
