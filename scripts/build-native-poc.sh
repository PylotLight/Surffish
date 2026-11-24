#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/poc-native/build"
APP_DIR="${BUILD_DIR}/SurffishNative.app"
MACOS_DIR="${APP_DIR}/Contents/MacOS"
RESOURCES_DIR="${APP_DIR}/Contents/Resources"

echo "==> Building SurffishNative.app..."
mkdir -p "${MACOS_DIR}" "${RESOURCES_DIR}"

cat << 'EOF' > "${APP_DIR}/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>SurffishNative</string>
    <key>CFBundleIdentifier</key>
    <string>com.surffish.native-poc</string>
    <key>CFBundleName</key>
    <string>SurffishNative</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>15.4</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

xcrun swiftc \
  -parse-as-library \
  -target arm64-apple-macos15.4 \
  -module-cache-path /tmp/swift-cache \
  -framework AppKit \
  -framework WebKit \
  -framework LocalAuthentication \
  -o "${MACOS_DIR}/SurffishNative" \
  "${ROOT_DIR}"/poc-native/Sources/*.swift

echo "==> Built successfully: ${APP_DIR}"
echo "To run:"
echo "  open ${APP_DIR}"
echo "or run directly in terminal:"
echo "  ${MACOS_DIR}/SurffishNative"
