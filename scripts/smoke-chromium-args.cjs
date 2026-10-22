// Smoke-only Chromium switches against "Failed to adjust OOM score of renderer with pid N:
// Permission denied (13)", which Chromium logs once per renderer on Linux when the browser process
// can't write a renderer's /proc/<pid>/oom_score_adj. Used by smoke-harness.cjs and by the scripts
// that launch Electron themselves. The app never gets these.
//
// Zygote-forked renderers are non-dumpable, so their oom_score_adj is root-owned. Only the setuid
// `chrome-sandbox` helper can write it, and Chromium only uses that with the setuid sandbox. With the
// user-namespace sandbox (the default whenever unprivileged user namespaces work, as on the k3s pods)
// or with no sandbox, the unprivileged browser process tries itself and fails.
//   - sandbox off: --no-zygote, so renderers are launched directly and no OOM-score write happens.
//     (Chromium only allows disabling the zygote when the sandbox is off.)
//   - sandbox on: nothing. --disable-namespace-sandbox would route the write through the setuid
//     helper, but the setuid sandbox can't create its namespaces inside an unprivileged pod.
// SMOKE_KEEP_ZYGOTE=1 skips this.
"use strict";

/**
 * @param {readonly string[]} argv the switches Electron is (or will be) launched with
 * @returns {string[]} extra switches to launch it with
 */
function smokeChromiumArgs(
  argv = [],
  env = process.env,
  platform = process.platform,
) {
  if (platform !== "linux" || env.SMOKE_KEEP_ZYGOTE === "1") return [];
  if (env.ELECTRON_DISABLE_SANDBOX || argv.includes("--no-sandbox"))
    return ["--no-sandbox", "--no-zygote"];
  return [];
}

module.exports = { smokeChromiumArgs };
