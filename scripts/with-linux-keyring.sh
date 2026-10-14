#!/bin/sh
# Run a command with a real, unlocked Secret Service keyring (gnome-keyring) on headless Linux, so
# Electron's safeStorage uses gnome-libsecret instead of refusing basic_text. Lets the Bramble quick
# unlock app check cover the persisted / migration path off a Mac. Needs gnome-keyring + dbus.
# Usage: dbus-run-session -- scripts/with-linux-keyring.sh xvfb-run -a electron --no-sandbox \
#          --password-store=gnome-libsecret scripts/check-bramble-quick-unlock-app.cjs <bramble dir>
set -e
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-$(mktemp -d)}"
eval "$(printf 'smoke\n' | gnome-keyring-daemon --unlock --components=secrets)"
export GNOME_KEYRING_CONTROL
exec "$@"
