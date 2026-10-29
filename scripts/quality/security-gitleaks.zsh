#!/usr/bin/env zsh
# security-gitleaks.zsh — REAL secret-scanning gate (net-new; gitleaks 8.30.1).
#
# gitleaks v8 REMOVED the legacy 'detect'/'protect' subcommands; the current
# forms (verified against the installed 8.30.1 binary, 2026-07-20) are:
#   full-history : gitleaks git .            (pre-push / check:full)
#   staged diff  : gitleaks git --staged .   (pre-commit)
# Exit code is 1 on leaks (gitleaks default). Config auto-loads from
# ./.gitleaks.toml at the repo root.
#
# Usage:  security-gitleaks.zsh [--staged]
set -u
local here="${0:A:h}"
cd "${here}/../.." || exit 2

"${here}/require-tool.zsh" gitleaks "brew install gitleaks" "gitleaks secret scan" || exit $?

if [[ "${1:-}" == "--staged" ]]; then
  exec gitleaks git --staged --redact --no-banner .
fi
exec gitleaks git --redact --no-banner .
