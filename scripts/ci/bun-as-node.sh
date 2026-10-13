#!/usr/bin/env bash
# CI only: make every `node` this job could spawn be Bun (no Node.js process at all).
# - drops the runner's own externals/node* directories from PATH
# - puts a `node` symlink to bun first on PATH (ahead of any system node), so `#!/usr/bin/env node` bins (electron's cli.js
#   and install-electron, electron-vite, ...) run under Bun's Node compatibility mode
# - persists PATH for later steps through $GITHUB_ENV and fails if `node` still isn't Bun.
# Usage (after bun is on PATH): bash scripts/ci/bun-as-node.sh
set -euo pipefail
bun_bin="$(command -v bun)" || { echo "::error::bun is not on PATH"; exit 1; }
shim="${RUNNER_TEMP:-/tmp}/bun-as-node"
mkdir -p "$shim"
ln -sf "$bun_bin" "$shim/node"
clean=""
IFS=: read -ra parts <<< "$PATH"
for p in "${parts[@]}"; do
  [ -z "$p" ] && continue
  case "$p" in */externals/node*|"$shim") continue ;; esac
  clean="$clean:$p"
done
export PATH="$shim:$(dirname "$bun_bin")$clean"
[ -n "${GITHUB_ENV:-}" ] && echo "PATH=$PATH" >> "$GITHUB_ENV"
resolved="$(command -v node)"
case "$resolved" in */externals/*) echo "::error::node resolves to the runner's externals ($resolved)"; exit 1 ;; esac
node -e 'process.versions.bun || process.exit(1)' || { echo "::error::node ($resolved) is not bun"; exit 1; }
[ "$resolved" = "$shim/node" ] || { echo "::error::node resolves to $resolved, not the bun shim"; exit 1; }
echo "node -> $resolved -> $bun_bin (bun $(bun --version)); the runner's externals/node* are off PATH"
