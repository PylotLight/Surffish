#!/usr/bin/env bash
# Install apt packages on a GitHub-hosted Linux runner, robust to the runner's flaky DNS.
#
# Usage: bash scripts/ci/apt-install.sh pkg1 pkg2 ...
#
# - Packages the image already has are skipped; with nothing missing apt is never touched (the
#   hosted images ship most of Chromium's runtime libraries already).
# - `apt-get update` exits 0 even when every mirror failed to resolve (it only warns), and the
#   install then fails with "Unable to locate package". `--error-on=any` turns those warnings into
#   a failure, and the update is retried with a backoff before giving up.
set -euo pipefail

missing=()
for pkg in "$@"; do
  if ! dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q "install ok installed"; then
    missing+=("$pkg")
  fi
done
if [ "${#missing[@]}" -eq 0 ]; then
  echo "apt-install: all ${#} packages already installed, skipping apt"
  exit 0
fi
echo "apt-install: missing ${missing[*]}"

update_ok=0
for wait in 0 15 30 60; do
  if [ "$wait" -gt 0 ]; then
    echo "::warning::apt-get update failed (mirror or DNS), retrying in ${wait}s"
    sleep "$wait"
  fi
  if sudo apt-get update --error-on=any; then
    update_ok=1
    break
  fi
done
if [ "$update_ok" -ne 1 ]; then
  echo "::error::apt-get update kept failing (getent archive.ubuntu.com: $(getent hosts archive.ubuntu.com || echo 'does not resolve')); the runner's DNS is down"
  exit 1
fi

for wait in 0 15 30; do
  if [ "$wait" -gt 0 ]; then
    echo "::warning::apt-get install failed, retrying in ${wait}s"
    sleep "$wait"
  fi
  if sudo apt-get install -y --no-install-recommends "${missing[@]}"; then
    exit 0
  fi
done
echo "::error::apt-get install of ${missing[*]} kept failing"
exit 1
