#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/poc-native/build"
STAGING_DIR="${BUILD_DIR}/staging"
echo "==> Building Surffish Native for macOS 26 / Apple Silicon..."
mkdir -p "${STAGING_DIR}"

build_profile_app() {
    local profile="$1"
    local app_name="$2"
    local bundle_id="$3"
    local app_dir="${BUILD_DIR}/${app_name}.app"
    local macos_dir="${app_dir}/Contents/MacOS"
    local resources_dir="${app_dir}/Contents/Resources"
    local binary_name="$(printf '%s' "${app_name}" | /usr/bin/tr -d ' ')"
    local binary="${STAGING_DIR}/${binary_name}"

    rm -rf "${app_dir}"
    mkdir -p "${macos_dir}" "${resources_dir}"

    # Compile each profile separately. Local Network privacy uses the main
    # executable UUID as part of app identity; sharing one Mach-O between the
    # production and development bundles makes that identity ambiguous.
    xcrun swiftc \
      -parse-as-library \
      -target arm64-apple-macosx26.0 \
      -module-cache-path /tmp/swift-cache \
      -framework AppKit \
      -framework SwiftUI \
      -framework WebKit \
      -framework Network \
      -framework LocalAuthentication \
      -o "${binary}" \
      "${ROOT_DIR}"/poc-native/Sources/*.swift
    cp "${binary}" "${macos_dir}/Surffish"
    # Browser extensions are installed per profile at runtime; never bundle upstream extension code.

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
    <key>NSLocalNetworkUsageDescription</key>
    <string>Surffish connects to SSH hosts on your local network and can share its SOCKS5 proxy with trusted devices on your LAN.</string>
    <key>LSMinimumSystemVersion</key>
    <string>26.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>SurffishProfile</key>
    <string>${profile}</string>
</dict>
</plist>
EOF

    # Local Network privacy on macOS tracks apps by their code signature.
    # Prefer an Apple-issued development/distribution identity when one is installed.
    local signing_identity="${SURFFISH_CODESIGN_IDENTITY:-}"
    if [[ -z "${signing_identity}" ]]; then
        signing_identity="$(/usr/bin/security find-identity -v -p codesigning 2>/dev/null \
            | /usr/bin/sed -nE 's/.*"((Apple Development|Developer ID Application):[^"]+)".*/\1/p' \
            | /usr/bin/head -n 1)"
    fi

    if [[ -n "${signing_identity}" ]]; then
        echo "==> Signing ${app_name} with ${signing_identity}"
        /usr/bin/codesign --force --deep --sign "${signing_identity}" \
            --timestamp=none "${app_dir}"
    else
        echo "==> WARNING: No Apple-issued signing identity found; using ad-hoc signing."
        echo "==> Set SURFFISH_CODESIGN_IDENTITY to an Apple Development or Developer ID Application identity for reliable Local Network privacy."
        /usr/bin/codesign --force --deep --sign - --timestamp=none "${app_dir}"
    fi
    /usr/bin/codesign --verify --deep --strict "${app_dir}"

    echo "==> Built ${app_dir} (${profile} profile)"
}

build_profile_app "production" "Surffish" "com.surffish.app"
build_profile_app "development" "Surffish Dev" "com.surffish.app.dev"

production_uuid="$(/usr/bin/dwarfdump --uuid "${BUILD_DIR}/Surffish.app/Contents/MacOS/Surffish" | /usr/bin/awk 'NR == 1 { print $2 }')"
development_uuid="$(/usr/bin/dwarfdump --uuid "${BUILD_DIR}/Surffish Dev.app/Contents/MacOS/Surffish" | /usr/bin/awk 'NR == 1 { print $2 }')"
if [[ -z "${production_uuid}" || -z "${development_uuid}" || "${production_uuid}" == "${development_uuid}" ]]; then
    echo "ERROR: Production and Development app executables must have distinct Mach-O UUIDs."
    exit 1
fi
echo "==> Verified distinct executable UUIDs: production ${production_uuid}, development ${development_uuid}"

echo "==> Both macOS 26 applications built successfully."
echo "Production: ${BUILD_DIR}/Surffish.app"
echo "Development: ${BUILD_DIR}/Surffish Dev.app"
