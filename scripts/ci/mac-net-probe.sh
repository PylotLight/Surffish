#!/usr/bin/env bash
# CI diagnostic (prints schemes and HTTP status codes only): which route can reach the npm registry
# and Electron's release downloads from this runner. Never changes anything.
set -u
for v in HTTPS_PROXY https_proxy HTTP_PROXY http_proxy ALL_PROXY all_proxy NO_PROXY no_proxy SURFFISH_GH_PROXY; do
  val="${!v:-}"
  if [ -n "$val" ]; then echo "$v: scheme=${val%%://*} hostport=$(echo "$val" | sed -E 's#^[a-z0-9]+://([^@/]*@)?##; s#/.*$##')"; else echo "$v: unset"; fi
done
p="${HTTPS_PROXY:-${https_proxy:-}}"
hp="$(echo "$p" | sed -E 's#^[a-z0-9]+://([^@/]*@)?##; s#/.*$##')"
reg=https://registry.npmjs.org/electron/45.0.0-beta.3
zip=https://github.com/electron/electron/releases/download/v45.0.0-beta.3/SHASUMS256.txt
probe() { # label curl-args...
  local label="$1"; shift
  local out; out="$(curl -sS -o /dev/null -L --max-time 20 -w '%{http_code}' "$@" 2>&1 | tail -c 200)"
  echo "$label: $out"
}
for url in "$reg" "$zip"; do
  echo "== $url"
  [ -n "$hp" ] && probe "runner proxy as configured (${p%%://*})" --proxy "$p" "$url"
  [ -n "$hp" ] && probe "same host:port as http://" --proxy "http://$hp" "$url"
  probe "direct (no proxy)" --noproxy '*' "$url"
done
exit 0
