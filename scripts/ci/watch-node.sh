#!/usr/bin/env bash
# CI only: run a command while sampling the process table, then report whether any real Node.js
# process ran (a process named node whose executable isn't bun). Fails if one did.
# Usage: bash scripts/ci/watch-node.sh bun install
set -uo pipefail
log="${RUNNER_TEMP:-/tmp}/node-watch.$$"
: > "$log"
"$@" & pid=$!
while kill -0 "$pid" 2>/dev/null; do
  ps -A -o pid=,comm= 2>/dev/null | awk '$2 ~ /(^|\/)node$/ {print $1, $2}' | while read -r p comm; do
    # Linux: the real binary from /proc; macOS: ps already shows the exec path
    if [ -e /proc/self/exe ]; then exe="$(readlink "/proc/$p/exe" 2>/dev/null)"; else exe="$comm"; fi
    [ -z "$exe" ] && { echo "gone" >> "$log.gone"; continue; } # exited before it could be resolved
    case "$exe" in */bun|*/bun-as-node/node) ;; *) echo "$p $exe" >> "$log" ;; esac
  done
  sleep 0.1
done
wait "$pid"; code=$?
if [ -s "$log" ]; then echo "::error::a Node.js process ran during '$*':"; sort -u "$log"; rm -f "$log" "$log.gone"; exit 1; fi
[ -s "$log.gone" ] && echo "($(wc -l < "$log.gone" | tr -d ' ') short-lived process(es) named node exited before their binary could be checked; with node -> bun first on PATH these are the shim)"
rm -f "$log" "$log.gone"
echo "no Node.js process seen during '$*' (node on PATH: $(command -v node))"
exit $code
