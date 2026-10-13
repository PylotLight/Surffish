// Smoke-only Chromium switches that cut "Failed to adjust OOM score of renderer with pid N:
// Permission denied (13)", which Chromium logs once per renderer on the Linux CI runners. Used by
// smoke-harness.cjs and by the scripts that launch Electron themselves. The app never gets these.
//
// Why it happens: zygote-forked renderers are non-dumpable, so their /proc/<pid>/oom_score_adj is
// root-owned. With the setuid sandbox, Chromium has its setuid `chrome-sandbox` helper write it;
// with the user-namespace sandbox (preferred whenever unprivileged user namespaces work, as on the
// k3s pods) or with no sandbox, the unprivileged browser process tries itself and fails.
//   - sandbox on + setuid helper installed (CI with passwordless sudo): --disable-namespace-sandbox,
//     so Chromium uses the setuid sandbox and adjusts OOM scores through the helper. Still sandboxed.
//   - sandbox off: --no-zygote, so renderers are launched directly and no OOM-score write happens.
//     (Chromium only allows disabling the zygote when the sandbox is off.)
// SMOKE_KEEP_ZYGOTE=1 skips all of this.
'use strict'

const { statSync } = require('node:fs')
const { dirname, join } = require('node:path')

function setuidHelperInstalled(electronBinary) {
  try {
    const stat = statSync(join(dirname(electronBinary), 'chrome-sandbox'))
    return stat.uid === 0 && (stat.mode & 0o4000) !== 0
  } catch {
    return false
  }
}

/**
 * @param {string} electronBinary path of the Electron executable that will run
 * @param {readonly string[]} argv the switches it is (or will be) launched with
 * @returns {string[]} extra switches to launch it with
 */
function smokeChromiumArgs(electronBinary, argv = [], env = process.env, platform = process.platform) {
  if (platform !== 'linux' || env.SMOKE_KEEP_ZYGOTE === '1') return []
  if (env.ELECTRON_DISABLE_SANDBOX || argv.includes('--no-sandbox')) return ['--no-sandbox', '--no-zygote']
  if (argv.includes('--disable-setuid-sandbox')) return []
  return setuidHelperInstalled(electronBinary) ? ['--disable-namespace-sandbox'] : []
}

module.exports = { smokeChromiumArgs }
