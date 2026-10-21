#!/bin/bash
# Idempotent sandbox setup: bun, Xvfb + Electron libs + xdotool under /tmp (no root), clone, deps, builds.
# Usage: bash setup.sh   (logs to /tmp/setup.log; prints SETUPDONE)
export PATH=$HOME/.bun/bin:$PATH
[ -x $HOME/.bun/bin/bun ] || (curl -fsSL https://bun.sh/install | bash) >/dev/null 2>&1
if [ ! -x /tmp/xrun.sh ]; then
mkdir -p /tmp/apt/{state/lists/partial,cache/archives/partial} /tmp/sysroot
APTO="-o Dir::State=/tmp/apt/state -o Dir::Cache=/tmp/apt/cache -o Dir::State::status=/var/lib/dpkg/status -o Debug::NoLocking=1 -o APT::Sandbox::User=sandbox"
apt-get $APTO update >/dev/null 2>&1 || true
apt-get $APTO install -y --download-only --no-install-recommends xvfb xauth libgtk-3-0t64 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libxcomposite1 libxdamage1 libatspi2.0-0t64 libgbm1 libasound2t64 libxkbfile1 libcups2t64 libdrm2 libxrandr2 fonts-dejavu-core libxss1 >/dev/null 2>&1
APTO2="-o Dir::State=/tmp/apt/state -o Dir::Cache=/tmp/apt/cache -o Dir::State::status=/dev/null -o Debug::NoLocking=1 -o APT::Sandbox::User=sandbox"
apt-get $APTO2 install -y --download-only --no-install-recommends x11-xkb-utils xkb-data xdotool libxdo3 libxtst6 libxinerama1 >/dev/null 2>&1
for f in /tmp/apt/cache/archives/*.deb; do dpkg-deb -x "$f" /tmp/sysroot; done
rm -rf /tmp/usrbin && mkdir -p /tmp/usrbin /tmp/realbin
for f in /usr/bin/*; do ln -sf "/tmp/realbin/$(basename "$f")" /tmp/usrbin/; done
rm -f /tmp/usrbin/xkbcomp /tmp/usrbin/xdotool; cp /tmp/sysroot/usr/bin/xkbcomp /tmp/usrbin/; cp /tmp/sysroot/usr/bin/xdotool /tmp/usrbin/
cat > /tmp/xrun.sh <<'EOS'
#!/bin/bash
exec unshare -rm bash -c '
mount --bind /usr/bin /tmp/realbin && mount --bind /tmp/usrbin /usr/bin
export LD_LIBRARY_PATH=/tmp/sysroot/usr/lib/aarch64-linux-gnu
D=$((100 + RANDOM % 800))
/tmp/sysroot/usr/bin/Xvfb :$D -screen 0 1600x1000x24 -nolisten tcp -xkbdir /tmp/sysroot/usr/share/X11/xkb > /tmp/xvfb-$D.log 2>&1 &
XP=$!
for i in $(seq 1 50); do [ -e /tmp/.X11-unix/X$D ] && break; sleep 0.1; done
export DISPLAY=:$D
unshare -U --map-user=1000 --map-group=1000 "$@"
rc=$?
kill $XP 2>/dev/null
exit $rc
' bash "$@"
EOS
chmod +x /tmp/xrun.sh
fi
echo xready
GC() { GIT_TERMINAL_PROMPT=0 git -c credential.helper='!f(){ echo username=x-access-token; echo password=gateway; }; f' "$@"; }
if [ ! -d /tmp/sf/.git ]; then GC clone -q --depth 30 --no-single-branch https://github.com/PylotLight/Surffish.git /tmp/sf; fi
cd /tmp/sf && git config user.name PylotLight && git config user.email PylotLight@users.noreply.github.com
git checkout -q feat/mini-newtab-ux 2>/dev/null
[ -d node_modules/electron/dist ] || bun install > /tmp/install.log 2>&1
echo deps $?
if [ "$1" = main ]; then
  [ -d /tmp/sfmain ] || git worktree add -q /tmp/sfmain origin/main
  ln -sfn /tmp/sf/node_modules /tmp/sfmain/node_modules
  (cd /tmp/sfmain && bun run build > /tmp/build-main.log 2>&1; echo buildmain $?)
fi
bun run build > /tmp/build.log 2>&1; echo build $?
echo SETUPDONE
