#!/usr/bin/env bash
# CI only, self-hosted Mac runner: `bun install` without the runner's SOCKS proxy, then check that the
# Electron binary for the locked version is in place.
#
# Why: the runner's .env sets HTTP(S)_PROXY=socks5://127.0.0.1:1080 for the Actions runner. Bun's HTTP
# client only speaks http:// and https:// proxies, so a package that isn't already in node_modules or
# bun's cache (a new Electron, say) failed with `UnsupportedProxyProtocol downloading tarball ...`.
# The runner's network reaches registry.npmjs.org and Electron's GitHub downloads directly (checked
# with curl, Oct 2026), so bun goes direct. An http(s) proxy is left alone.
#
# A new Electron version's binary is fetched once, by the existing root postinstall (install-electron,
# running under the bun-as-node shim, so still no Node.js). Electron 45+ would otherwise download a
# missing binary lazily on the first require('electron') in a later step; the check below stops the
# job instead, so nothing after this step downloads Electron.
set -euo pipefail
for v in HTTPS_PROXY https_proxy HTTP_PROXY http_proxy ALL_PROXY all_proxy; do
  val="${!v:-}"
  case "$val" in socks*://*) echo "bun can't use $v (${val%%://*}); unset for bun install"; unset "$v" ;; esac
done
bash scripts/ci/watch-node.sh bun install

want="$(bun -e 'console.log(require("./node_modules/electron/package.json").version)')"
have="$(sed 's/^v//' node_modules/electron/dist/version 2>/dev/null || true)"
app="node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ "$have" = "$want" ] && [ -x "$app" ] && [ "$(cat node_modules/electron/path.txt 2>/dev/null)" = "Electron.app/Contents/MacOS/Electron" ]; then
  echo "Electron $want binary present (node_modules/electron/dist)"
else
  echo "::error::Electron $want binary is not in node_modules/electron/dist (found: ${have:-none}); bun install's postinstall should have put it there. Later steps would download it lazily, so stopping here."
  exit 1
fi
