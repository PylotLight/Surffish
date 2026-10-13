// Removing a smoke's throwaway profile. No Electron imports, so plain node/bun probes can use it too.
//
// The smokes run the app in their own process and delete the profile right before app.exit(), while
// Chromium (network service, GPU process, storage backends) and the app's own deferred writes can
// still be creating files in it. A plain recursive rm then races them and throws ENOTEMPTY
// ("Directory not empty"), which failed tab-selection and host-bridge on CI after every check had
// passed. Node's rm retries ENOTEMPTY/EBUSY/EPERM with a linear backoff when asked to (maxRetries),
// which covers those late writes; if it still can't, a leftover temp directory on an ephemeral
// runner is not a test failure, so it is reported and the smoke's result stands.
'use strict'

const { rmSync } = require('node:fs')

/** Remove `dir` (recursive, retried). Returns true when it is gone, false (with a warning) when not. */
function removeProfile(dir, { retries = 10, retryDelay = 100, rm = rmSync, warn = console.warn } = {}) {
  if (!dir) return true
  try {
    rm(dir, { recursive: true, force: true, maxRetries: retries, retryDelay })
    return true
  } catch (error) {
    warn(`[smoke] left the temporary profile behind (${error && error.code ? error.code : 'error'}: ${error && error.message ? error.message : error}); not a test failure`)
    return false
  }
}

module.exports = { removeProfile }
