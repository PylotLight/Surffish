#!/usr/bin/env bash
# CI: run a command, and if it fails say why in one line.
#
#   bash scripts/ci/explain.sh "<step title>" <command> [args...]
#
# Output streams through unchanged (also kept in a temp log). On a non-zero exit it runs
# scripts/ci/failure-reason.ts on that log, which prints `::error title=<step title>::<reason>` and adds
# the line to $GITHUB_STEP_SUMMARY, then exits with the command's status.
set -uo pipefail
title="$1"; shift
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/explain.XXXXXX")"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  if command -v bun >/dev/null 2>&1 && bun "$here/failure-reason.ts" --step "$title" --log "$log" --exit "$status"; then :
  elif command -v node >/dev/null 2>&1 && node --experimental-strip-types --no-warnings "$here/failure-reason.ts" --step "$title" --log "$log" --exit "$status"; then :
  else
    last="$(grep -v '^[[:space:]]*$' "$log" | tail -n 1 | tr -d '\r' | cut -c1-200)"
    echo "::error title=$title::${last:-exited $status}"
    [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "- ❌ **$title**: ${last:-exited $status}" >> "$GITHUB_STEP_SUMMARY"
  fi
fi
rm -f "$log"
exit "$status"
