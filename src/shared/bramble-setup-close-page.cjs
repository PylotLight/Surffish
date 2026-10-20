/**
 * Surffish-only: close Bramble's setup tab (options.html) once setup is really done. Staged with the
 * Scan QR helper (same <script> tag, see bramble-poc.ts); Bramble itself is never patched.
 *
 * How Bramble 1.29 signals completion (flythenimbus/bramble packages/core/src/app/OptionsApp.tsx,
 * SetupShell): after a join ("Connecting to your other device…" -> startJoin resolves), a restore, or
 * a create (once the recovery code screen's Continue is pressed) it swaps the whole page for a terminal
 * "done" screen: a check icon (lucide `svg.lucide-check`), an h1 ("Vault ready" / "Vault unlocked" /
 * "Vault added") and one line of text, with no buttons or fields. Errors stay on the form instead.
 * Every success path also writes a brand-new vault: a new `vault.registry` id with a non-empty
 * `vault-blob-b64:<id>` in chrome.storage.local.
 *
 * So the tab closes only when BOTH hold: the done screen is showing (checked by shape, so any locale
 * works) and a vault exists now that did not when this page loaded. Opening options.html on an existing
 * vault and leaving it never closes anything. After CLOSE_DELAY_MS (so the success state is seen) and a
 * last check that the done screen is still up, it asks Surffish (preload `surffishBramble.closeSetupTab`)
 * to close the tab; the main process re-checks the sender, the URL and that a vault exists, and swaps the
 * last tab of a window for a New Tab instead of closing the window.
 *
 * Plain script, no imports. Under Node/Bun (tests) it exports its pure helpers instead.
 */
;(function (root) {
  'use strict'

  var REGISTRY_KEY = 'vault.registry'
  var BLOB_KEY = 'vault-blob-b64'
  var CLOSE_DELAY_MS = 1500

  /** Storage keys of vaults that hold a blob, from a chrome.storage.local snapshot. Never blob contents. */
  function presentVaultKeys(items) {
    if (!items || typeof items !== 'object') return []
    var registry = items[REGISTRY_KEY]
    var vaults = registry && Array.isArray(registry.vaults) ? registry.vaults : []
    var keys = [BLOB_KEY]
    for (var i = 0; i < vaults.length; i++) {
      var id = vaults[i] && vaults[i].id
      if (typeof id === 'string' && id) keys.push(BLOB_KEY + ':' + id)
    }
    var present = []
    for (var k = 0; k < keys.length; k++) {
      var value = items[keys[k]]
      if (typeof value === 'string' && value.length > 0 && present.indexOf(keys[k]) < 0) present.push(keys[k])
    }
    return present.sort()
  }

  /** Vault keys in `after` that were not in `before`. */
  function newVaultKeys(before, after) {
    var known = Array.isArray(before) ? before : []
    return (Array.isArray(after) ? after : []).filter(function (key) { return known.indexOf(key) < 0 })
  }

  /** options.html with no ?screen= (import / restore from Settings keep their tab). */
  function isSetupPageUrl(href) {
    try {
      var url = new URL(href)
      return url.protocol === 'chrome-extension:' && url.pathname === '/options.html' && !url.searchParams.has('screen')
    } catch (_error) {
      return false
    }
  }

  /**
   * Shape of the terminal done screen in a snapshot { heading, checkIcon, controls, spinner }: a heading
   * and a check icon, and nothing to fill in or press, and no spinner (the connecting state has one).
   */
  function looksDone(snapshot) {
    return !!snapshot && snapshot.heading === true && snapshot.checkIcon === true && snapshot.controls === 0 && snapshot.spinner === false
  }

  /** The tab may close: the done screen is up and this page session produced a new vault. */
  function shouldClose(state) {
    return !!state && state.setupPage === true && looksDone(state.screen) && Array.isArray(state.baseline) &&
      newVaultKeys(state.baseline, state.current).length > 0
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { presentVaultKeys: presentVaultKeys, newVaultKeys: newVaultKeys, isSetupPageUrl: isSetupPageUrl, looksDone: looksDone, shouldClose: shouldClose, CLOSE_DELAY_MS: CLOSE_DELAY_MS }
    return
  }

  var document = root.document
  if (!document || root.__surffishBrambleSetupClose) return
  root.__surffishBrambleSetupClose = true
  if (!isSetupPageUrl(root.location.href)) return
  var bridge = root.surffishBramble
  var api = root.chrome && root.chrome.storage ? root.chrome : root.browser
  var local = api && api.storage && api.storage.local
  if (!bridge || typeof bridge.closeSetupTab !== 'function' || !local) return

  function storageGet(keys) {
    return new Promise(function (resolve, reject) {
      try {
        var pending = local.get(keys, function (items) {
          var error = api.runtime && api.runtime.lastError
          if (error) reject(new Error(error.message)); else resolve(items || {})
        })
        if (pending && typeof pending.then === 'function') pending.then(function (items) { resolve(items || {}) }, reject)
      } catch (error) { reject(error) }
    })
  }

  // The registry first, then only the blob keys it names (values stay in this page; only key names are kept).
  function readVaultKeys() {
    return storageGet(REGISTRY_KEY).then(function (items) {
      var registry = items[REGISTRY_KEY]
      var vaults = registry && Array.isArray(registry.vaults) ? registry.vaults : []
      var keys = [REGISTRY_KEY, BLOB_KEY]
      for (var i = 0; i < vaults.length; i++) if (vaults[i] && typeof vaults[i].id === 'string' && vaults[i].id) keys.push(BLOB_KEY + ':' + vaults[i].id)
      return storageGet(keys).then(presentVaultKeys)
    })
  }

  function screenSnapshot() {
    var page = document.getElementById('root') || document.body
    if (!page) return null
    return {
      heading: !!page.querySelector('h1'),
      checkIcon: !!page.querySelector('svg.lucide-check'),
      controls: page.querySelectorAll('button, input, textarea, select, form, a[href]').length,
      spinner: !!page.querySelector('.animate-spin')
    }
  }

  // What the vault store held when this page opened. Without it (storage unreadable) nothing closes.
  var baseline = null
  var closing = false
  readVaultKeys().then(function (keys) { baseline = keys; check() }, function () { baseline = null })

  function check() {
    if (closing || !baseline || !looksDone(screenSnapshot())) return
    closing = true
    readVaultKeys().then(function (current) {
      if (!shouldClose({ setupPage: true, screen: screenSnapshot(), baseline: baseline, current: current })) { closing = false; return }
      root.setTimeout(function () {
        if (!looksDone(screenSnapshot())) { closing = false; return }
        Promise.resolve(bridge.closeSetupTab()).then(function (closed) { if (!closed) closing = false }, function () { closing = false })
      }, CLOSE_DELAY_MS)
    }, function () { closing = false })
  }

  var scheduled = false
  function schedule() {
    if (scheduled) return
    scheduled = true
    // setTimeout, not requestAnimationFrame: a join can finish while the tab is in the background.
    root.setTimeout(function () { scheduled = false; check() }, 50)
  }

  function boot() {
    new root.MutationObserver(schedule).observe(document.body || document.documentElement, { childList: true, subtree: true })
    schedule()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
  else boot()
})(typeof globalThis !== 'undefined' ? globalThis : this)
