#!/usr/bin/env bash
# CI preflight, self-hosted Mac release job: can this runner push to GitHub? Runs before the ~2 min
# build so a broken route fails in seconds instead of at `git push` after the zip is built.
#
# `git push --dry-run` of main (already equal to origin/main) asks GitHub's receive-pack for the ref
# list, which needs write access, through the same route the release push takes (the checkout step
# points git at SURFFISH_GH_PROXY, else HTTPS_PROXY from the env, else direct). It sends nothing.
# Run it through scripts/ci/explain.sh so a failure becomes a one-line annotation.
set -euo pipefail
redact() { printf %s "$1" | sed -E 's#//[^/@]*@#//***@#'; }
route="direct (no proxy)"
if [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]; then route="HTTPS_PROXY $(redact "${HTTPS_PROXY:-${https_proxy:-}}")"; fi
cfg="$(git config --get http.https://github.com/.proxy || true)"
if [ -n "$cfg" ]; then route="git http.https://github.com/.proxy $(redact "$cfg")"; fi
echo "git route to github.com: $route"
if [ -z "$cfg" ] && [ -z "${HTTPS_PROXY:-${https_proxy:-}}" ]; then
  echo "warning: no proxy for git; this Mac's network has refused GitHub token writes on the direct route before (403)"
fi
# give up after ~20s of no progress instead of hanging on a dead proxy
git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=20 push --dry-run --porcelain origin HEAD:refs/heads/main
echo "GitHub git write access: ok"
