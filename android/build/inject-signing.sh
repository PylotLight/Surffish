#!/usr/bin/env bash
# Injects release signing into the expo-prebuild android/ project (run from the expo root, after prebuild).
# Without it, release builds are signed with the template's debug keystore (fine for sideloading).
#
# Env required:
#   KEYSTORE_FILE   absolute path to the .keystore
#   STORE_PASSWORD  keystore password
#   KEY_PASSWORD    key password
#   KEY_ALIAS       key alias (default: surffish)
set -euo pipefail

: "${KEYSTORE_FILE:?set KEYSTORE_FILE}"
: "${STORE_PASSWORD:?set STORE_PASSWORD}"
: "${KEY_PASSWORD:?set KEY_PASSWORD}"

APP_GRADLE="android/app/build.gradle"
[ -f "$APP_GRADLE" ] || { echo "run from the expo project root (expecting $APP_GRADLE)"; exit 1; }

python3 - "$APP_GRADLE" <<'PY'
import re, sys
p = sys.argv[1]
src = open(p).read()
block = """    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_FILE"))
            storePassword System.getenv("STORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS") ?: "surffish"
            keyPassword System.getenv("KEY_PASSWORD")
        }
"""
if 'storeFile file(System.getenv("KEYSTORE_FILE"))' not in src:
    src = src.replace('    signingConfigs {\n', block, 1)
src = re.sub(r'(release\s*\{[^}]*?)signingConfig signingConfigs\.debug', r'\1signingConfig signingConfigs.release', src, count=1, flags=re.S)
open(p, 'w').write(src)
PY

echo "release signing injected (alias=${KEY_ALIAS:-surffish})"
grep -n "signingConfig" "$APP_GRADLE" | head -6
