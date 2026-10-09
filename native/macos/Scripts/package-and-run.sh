#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This prototype requires macOS 15.4+ and Apple's WebKit frameworks." >&2
  exit 2
fi

cd "$(dirname "$0")/.."
swift build -c release
APP_DIR="$PWD/.build/SockfishNative.app"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
cp .build/release/SockfishNative "$APP_DIR/Contents/MacOS/SockfishNative"
cat > "$APP_DIR/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>SockfishNative</string>
  <key>CFBundleIdentifier</key><string>dev.sockfish.native-poc</string>
  <key>CFBundleName</key><string>Sockfish Native POC</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>15.4</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST
# Local ad-hoc signature only; this is not Developer ID signing or notarization.
codesign --force --deep --sign - "$APP_DIR"
open "$APP_DIR"
echo "Launched: $APP_DIR"
