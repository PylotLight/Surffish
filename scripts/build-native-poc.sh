#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/poc-native/build"
STAGING_DIR="${BUILD_DIR}/staging"
BINARY="${STAGING_DIR}/SurffishNative"

echo "==> Building Surffish Native for macOS 26 / Apple Silicon..."
mkdir -p "${STAGING_DIR}"

xcrun swiftc \
  -parse-as-library \
  -target arm64-apple-macosx26.0 \
  -module-cache-path /tmp/swift-cache \
  -framework AppKit \
  -framework WebKit \
  -framework Network \
  -framework LocalAuthentication \
  -o "${BINARY}" \
  "${ROOT_DIR}"/poc-native/Sources/*.swift

build_profile_app() {
    local profile="$1"
    local app_name="$2"
    local bundle_id="$3"
    local app_dir="${BUILD_DIR}/${app_name}.app"
    local macos_dir="${app_dir}/Contents/MacOS"
    local resources_dir="${app_dir}/Contents/Resources"

    rm -rf "${app_dir}"
    mkdir -p "${macos_dir}" "${resources_dir}"
    cp "${BINARY}" "${macos_dir}/Surffish"
    if [ -d "${ROOT_DIR}/poc-native/Resources/bramble" ]; then
        cp -R "${ROOT_DIR}/poc-native/Resources/bramble" "${resources_dir}/Bramble"
    fi

    cat > "${app_dir}/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>Surffish</string>
    <key>CFBundleIdentifier</key>
    <string>${bundle_id}</string>
    <key>CFBundleName</key>
    <string>${app_name}</string>
    <key>CFBundleDisplayName</key>
    <string>${app_name}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>26.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>SurffishProfile</key>
    <string>${profile}</string>
</dict>
</plist>
EOF

    local profile_support="${HOME}/Library/Application Support/SurffishNative/Profiles/${profile^}/Bramble"
    if [ ! -f "${profile_support}/manifest.json" ] && [ -d "${ROOT_DIR}/poc-native/Resources/bramble" ]; then
        mkdir -p "${profile_support}"
        cp -R "${ROOT_DIR}/poc-native/Resources/bramble/"* "${profile_support}/"
    fi

    echo "==> Built ${app_dir} (${profile} profile)"
}

build_profile_app "production" "Surffish" "com.surffish.app"
build_profile_app "development" "Surffish Dev" "com.surffish.app.dev"

echo "==> Both macOS 26 applications built successfully."
echo "Production: ${BUILD_DIR}/Surffish.app"
echo "Development: ${BUILD_DIR}/Surffish Dev.app"
