#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This native prototype requires macOS 15.4+ and Apple's WebKit frameworks." >&2
  exit 2
fi

cd "$(dirname "$0")/.."
swift --version
swift test
swift build
