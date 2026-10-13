#!/usr/bin/env bash
# Experiment only (mac-hidden-exp workflow): runs a list of smokes 2 at a time under the hidden-mode
# env the caller exported, with scripts/ci/window-watch.swift sampling the screen around them.
#   bash scripts/ci/hidden-phase.sh <phase-name> "<bun script names>"
# Appends one row per smoke to $RUNNER_TEMP/hidden/results.md, writes failures to <phase>/_failed.
set -u
name="$1"; tests="$2"
root="$RUNNER_TEMP/hidden"; logs="$root/$name"; mkdir -p "$logs"
export logs
watch="$RUNNER_TEMP/window-watch"
wpid=""
if [ -x "$watch" ]; then "$watch" Electron 200 >"$logs/_watch.log" 2>&1 & wpid=$!; fi
echo "phase $name: SURFFISH_SMOKE_HIDDEN=${SURFFISH_SMOKE_HIDDEN:-} THROTTLE=${SURFFISH_SMOKE_HIDDEN_THROTTLE:-} FOCUSABLE=${SURFFISH_SMOKE_HIDDEN_FOCUSABLE:-}"
printf '%s\n' $tests | xargs -P 2 -I{} sh -c 's=$(date +%s); bun run "$1" >"$logs/$1.log" 2>&1; echo "$? $(( $(date +%s) - s ))" >"$logs/$1.status"' _ {}
if [ -n "$wpid" ]; then kill -TERM "$wpid" 2>/dev/null; wait "$wpid" 2>/dev/null; fi
watchjson="$(grep -h '^\[window-watch-json\]' "$logs/_watch.log" 2>/dev/null | tail -1 | sed 's/^\[window-watch-json\] //')"
failed=""
for t in $tests; do
  read -r code secs < "$logs/$t.status" || { code=99; secs=0; }
  if [ "$code" = 0 ]; then st=ok; else st=FAILED; failed="$failed $t"; fi
  verdicts="$(grep -ho -- '-> [A-Za-z ,]*$' "$logs/$t.log" | sed 's/^-> //' | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
  frames="$(grep -h "frames (rAF/s per view)" "$logs/$t.log" | head -1 | sed "s/.*per view): //")"
  echo "| $name | $t | $st | ${secs}s | ${verdicts:-no [smoke-hidden] line} ${frames:+frames: $frames} |" >> "$root/results.md"
  echo "::group::$st $name $t (${secs}s)"; cat "$logs/$t.log"; echo "::endgroup::"
done
echo "| $name | (window-watch, whole phase) | | | ${watchjson:-watcher unavailable} |" >> "$root/results.md"
echo "::group::window-watch $name"; cat "$logs/_watch.log" 2>/dev/null; echo "::endgroup::"
echo "$failed" > "$logs/_failed"
exit 0
