#!/usr/bin/env bash
# CI only: run a command while sampling the process table, then report whether any real Node.js
# process ran (a process named node whose executable isn't bun). Fails if one did.
# Usage: bash scripts/ci/watch-node.sh bun install
set -uo pipefail
log="${RUNNER_TEMP:-/tmp}/node-watch.$$"
: > "$log"
"$@" & pid=$!
while kill -0 "$pid" 2>/dev/null; do
  ps -A -o pid=,comm= 2>/dev/null | awk '$2 ~ /(^|\/)node$/ {print $1}' | while read -r p; do
    exe="$(readlink -f "/proc/$p/exe" 2>/dev/null || ps -p "$p" -o comm= 2>/dev/null)"
    case "$exe" in */bun|*/bun-as-node/node) ;; *) echo "$p $exe" >> "$log" ;; esac
  done
  sleep 0.1
done
wait "$pid"; code=$?
if [ -s "$log" ]; then echo "::error::a Node.js process ran during '$*':"; sort -u "$log"; rm -f "$log"; exit 1; fi
rm -f "$log"
echo "no Node.js process seen during '$*' (node on PATH: $(command -v node))"
exit $code
