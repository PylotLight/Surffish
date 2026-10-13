#!/usr/bin/env bash
# CI only: run a command while sampling the process table, then report whether any real Node.js
# process ran *under that command* (a descendant named node whose resolved executable isn't bun).
# Fails if one did. Processes that aren't descendants of the command (e.g. other apps already running
# on a self-hosted runner) are ignored.
# Usage: bash scripts/ci/watch-node.sh bun install
set -uo pipefail
tmp="${RUNNER_TEMP:-/tmp}/node-watch.$$"
log="$tmp.hits"; gone="$tmp.gone"; known="$tmp.tree"
: > "$log"; : > "$gone"
"$@" & pid=$!
echo "$pid" > "$known"

# resolve symlinks portably (macOS readlink may lack -f on older systems)
resolve() {
  local f="$1" n=0
  while [ -L "$f" ] && [ $n -lt 20 ]; do
    local t; t="$(readlink "$f")" || break
    case "$t" in /*) f="$t" ;; *) f="$(dirname "$f")/$t" ;; esac
    n=$((n + 1))
  done
  printf '%s\n' "$f"
}

check() { # pid comm
  local p="$1" comm="$2" exe=""
  if [ -e /proc/self/exe ]; then
    exe="$(readlink "/proc/$p/exe" 2>/dev/null)"   # Linux: kernel-resolved binary
    [ -z "$exe" ] && { echo "$p" >> "$gone"; return; } # exited before it could be resolved
  else
    # macOS: ps comm is often just "node" (no path), so ask lsof for the mapped executable (the first
    # txt entry, a resolved vnode path: the bun-as-node shim shows up as the bun binary)
    if command -v lsof >/dev/null 2>&1; then
      exe="$(lsof -a -p "$p" -d txt -Fn 2>/dev/null | awk '/^n/ { print substr($0, 2); exit }')"
      [ -z "$exe" ] && ! kill -0 "$p" 2>/dev/null && { echo "$p" >> "$gone"; return; }
    fi
    [ -z "$exe" ] && exe="$comm"
    case "$exe" in /*) exe="$(resolve "$exe")" ;; esac
  fi
  case "$exe" in */bun|*/bun-as-node/node) ;; *) echo "$p $exe" >> "$log" ;; esac
}

while kill -0 "$pid" 2>/dev/null; do
  # one snapshot per tick: extend the known descendant set (kept across ticks, so a grandchild still
  # counts after its parent exits), then list node-named processes inside that set
  ps -A -o pid=,ppid=,comm= 2>/dev/null > "$tmp.ps"
  awk -v kf="$known" '
    BEGIN { while ((getline l < kf) > 0) k[l] = 1; close(kf) }
    { pid = $1; ppid = $2; $1 = ""; $2 = ""; sub(/^  /, ""); par[pid] = ppid; cm[pid] = $0 }
    END {
      do { added = 0; for (p in par) if (!(p in k) && (par[p] in k)) { k[p] = 1; added = 1 } } while (added)
      for (p in k) print p > kf
      for (p in k) if ((p in cm) && cm[p] ~ /(^|\/)node$/) print "N", p, cm[p]
    }' "$tmp.ps" | while read -r _ p comm; do check "$p" "$comm"; done
  sleep 0.1
done
wait "$pid"; code=$?
total="$(wc -l < "$known" | tr -d ' ')"
if [ -s "$log" ]; then
  echo "::error::a Node.js process was spawned by '$*':"; sort -u "$log"
  rm -f "$tmp".*; exit 1
fi
[ -s "$gone" ] && echo "($(sort -u "$gone" | wc -l | tr -d ' ') short-lived descendant(s) named node exited before their binary could be checked; with node -> bun first on PATH these are the shim)"
rm -f "$tmp".*
echo "no Node.js process spawned by '$*' ($total process(es) in its tree checked; node on PATH: $(command -v node))"
exit $code
