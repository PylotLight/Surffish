#!/usr/bin/env bash
# Ground-truth capture of a client performing a Cloudflare Turnstile challenge.
# Usage: capture-client.sh <outdir> <pid> [pid...] [interval_seconds=2] [duration_seconds=120]
#   (trailing numeric args are interval/duration; pids are everything between outdir and them)
# Logs:  <outdir>/net.log   — external TCP sockets per sample (lsof -a -i -p per pid)
#        <outdir>/t<NNN>.png — full-screen capture per sample
#        <outdir>/ips.log  — first sighting of each remote IP (timestamped)
set -u
OUT="${1:?outdir}"; shift
ARGS=("$@")
# peel trailing numeric interval/duration
DUR=120; IVAL=2
if [ "${#ARGS[@]}" -ge 2 ]; then DUR="${ARGS[${#ARGS[@]}-1]}"; IVAL="${ARGS[${#ARGS[@]}-2]}"; unset "ARGS[${#ARGS[@]}-1]" "ARGS[${#ARGS[@]}-2]"; fi
PIDS=("${ARGS[@]}")
[ "${#PIDS[@]}" -gt 0 ] || { echo "need at least one pid" >&2; exit 2; }
mkdir -p "$OUT"
END=$(( $(date +%s) + DUR ))
N=0
: > "$OUT/net.log"; : > "$OUT/ips.log"
echo "capturing pids: ${PIDS[*]}" >> "$OUT/net.log"
while [ "$(date +%s)" -lt "$END" ]; do
  N=$((N+1))
  TS=$(date +%H:%M:%S)
  SOCKS=""
  for P in "${PIDS[@]}"; do
    S=$(lsof -nP -a -i -p "$P" 2>/dev/null | awk -v p="$P" 'NR>1 && $NF !~ /^localhost/ {print p, $NF, $(NF-1)}')
    [ -n "$S" ] && SOCKS="${SOCKS}${S}
"
  done
  if [ -n "$SOCKS" ]; then
    {
      echo "=== $TS (sample $N) ==="
      echo "$SOCKS" | sed '/^$/d' | sort | uniq -c | sort -rn
    } >> "$OUT/net.log"
    echo "$SOCKS" | sed '/^$/d' | while read -r pid local_ remote_; do
      ip=$(echo "$remote_" | sed 's/.*://')
      if ! grep -q "$ip " "$OUT/ips.log" 2>/dev/null; then
        echo "$TS pid=$pid ip=$ip $remote_" >> "$OUT/ips.log"
      fi
    done
  fi
  screencapture -x "$OUT/t$(printf %03d $N).png" 2>/dev/null
  sleep "$IVAL"
done
echo "capture done: $N samples in $OUT"
