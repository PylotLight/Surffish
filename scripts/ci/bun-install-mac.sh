#!/usr/bin/env bash
# CI only, self-hosted Mac runner: `bun install` without the runner's SOCKS proxy, then make sure the
# Electron binary is already there. Never downloads Electron itself.
#
# Why: the runner's .env sets HTTP(S)_PROXY=socks5://127.0.0.1:1080 for the Actions runner. Bun's HTTP
# client only speaks http:// and https:// proxies, so any package that isn't already in node_modules
# or bun's cache fails with `UnsupportedProxyProtocol downloading tarball ...`. The runner's network
# reaches registry.npmjs.org directly (scripts/ci/mac-net-probe.sh), so bun goes direct. An http(s)
# proxy is left alone.
set -euo pipefail
for v in HTTPS_PROXY https_proxy HTTP_PROXY http_proxy ALL_PROXY all_proxy; do
  val="${!v:-}"
  case "$val" in socks*://*) echo "bun can't use $v (${val%%://*}); unset for bun install"; unset "$v" ;; esac
done
bash scripts/ci/watch-node.sh bun install

# Electron 45+ has no postinstall: require('electron') downloads a missing binary on first use (its
# install.js). This runner must never do that, so stop here when the binary for the locked version
# isn't already in node_modules/electron/dist.
want="$(bun -e 'console.log(require("./node_modules/electron/package.json").version)')"
have="$(sed 's/^v//' node_modules/electron/dist/version 2>/dev/null || true)"
app="node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ "$have" = "$want" ] && [ -x "$app" ] && [ "$(cat node_modules/electron/path.txt 2>/dev/null)" = "Electron.app/Contents/MacOS/Electron" ]; then
  echo "Electron $want binary present (node_modules/electron/dist)"
else
  echo "::error::Electron $want binary is not in node_modules/electron/dist (found: ${have:-none}). This runner never downloads Electron; see docs/perf.md 'Bun only, no Node.js in CI'."
  exit 1
fi
