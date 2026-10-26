#!/usr/bin/env zsh
# require-tool.zsh — assert a required external CLI is on PATH, or FAIL LOUDLY.
#
# House doctrine (.claude/rules/error-handling.md; CLAUDE.md
# §"Error handling"): a missing required tool is a VISIBLE FAILURE, never a
# silent skip. This helper is the loud-fail replacement for the old
# "echo 'tool not installed'" quality-gate stubs.
#
# Usage:  require-tool.zsh <tool> <install-hint> [<blocked-gate>]
# Exit:   0 if <tool> resolves on PATH; 127 (with diagnostic packet) if absent.
set -u

local tool="${1:?require-tool: missing arg 1 <tool>}"
local install_hint="${2:?require-tool: missing arg 2 <install-hint>}"
local blocked_gate="${3:-<unnamed gate>}"

if command -v "$tool" >/dev/null 2>&1; then
  exit 0
fi

print -u2 -- "✗ FATAL(require-tool): required tool not found — '${tool}'"
print -u2 -- "    gate blocked : ${blocked_gate}"
print -u2 -- "    expected     : 'command -v ${tool}' resolves to an executable on PATH"
print -u2 -- "    observed     : 'command -v ${tool}' found nothing (binary absent)"
print -u2 -- "    detected at  : ${0}"
print -u2 -- "    PATH         : ${PATH}"
print -u2 -- "    remediation  : ${install_hint}"
print -u2 -- "    rationale    : house error-handling doctrine forbids silent tool skips"
exit 127
