import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { dispatchBrambleToolbarAction, resolveBrambleToolbarAction } from '../shared/bramble-toolbar.ts'
import {
  BRAMBLE_BACKGROUND_WORKER_FILE,
  BRAMBLE_BACKGROUND_WORKER_SOURCE,
  BRAMBLE_BROWSER_ALIAS_FILE,
  BRAMBLE_BROWSER_ALIAS_SOURCE,
  adaptBrambleAutofillSettleDelay,
  adaptBramblePopupViewport,
  adaptBrambleFirefoxManifest,
  addBrambleQrJoin,
  BRAMBLE_JSQR_FILE,
  BRAMBLE_QR_JOIN_FILE,
  injectBrambleBrowserAlias,
  injectBrambleQrJoinScript,
  isBrambleExtensionUrl,
  stageBrambleFirefoxBuild
} from './bramble-poc-adapter.ts'

const firefoxManifest = {
  manifest_version: 3,
  name: 'Bramble',
  version: '1.28.0',
  browser_specific_settings: { gecko: { id: 'firefox@bramble.app' } },
  background: { scripts: ['background.js'], type: 'module' },
  permissions: ['storage', 'alarms', 'identity'],
  optional_permissions: ['identity'],
  action: { default_popup: 'popup.html', theme_icons: [{ light: 'light.png', dark: 'dark.png', size: 16 }] },
  content_scripts: [
    { matches: ['<all_urls>'], js: ['content-script.js'], all_frames: true },
    { matches: ['<all_urls>'], js: ['webauthn-inpage.js'], world: 'MAIN', run_at: 'document_start' },
    { matches: ['<all_urls>'], js: ['webauthn-bridge.js'], run_at: 'document_start' }
  ]
}

test('adapts only the known Bramble Firefox MV3 build to an Electron module worker', () => {
  const adapted = adaptBrambleFirefoxManifest(firefoxManifest)
  const background = adapted.background as Record<string, unknown>
  const action = adapted.action as Record<string, unknown>
  const permissions = adapted.permissions as string[]

  assert.deepEqual(background, {
    type: 'module',
    service_worker: BRAMBLE_BACKGROUND_WORKER_FILE
  })
  assert.equal('browser_specific_settings' in adapted, false)
  assert.deepEqual(permissions, ['storage', 'alarms'])
  assert.equal('optional_permissions' in adapted, false)
  assert.deepEqual(action, { default_popup: 'popup.html' })
  assert.deepEqual(adapted.content_scripts, [
    { matches: ['<all_urls>'], js: [BRAMBLE_BROWSER_ALIAS_FILE, 'content-script.js'], all_frames: true },
    { matches: ['<all_urls>'], js: ['webauthn-inpage.js'], world: 'MAIN', run_at: 'document_start' },
    { matches: ['<all_urls>'], js: [BRAMBLE_BROWSER_ALIAS_FILE, 'webauthn-bridge.js'], run_at: 'document_start' }
  ])
  assert.equal((firefoxManifest.background as Record<string, unknown>).service_worker, undefined)
})

test('refuses non-Bramble and incompatible background builds', () => {
  assert.throws(() => adaptBrambleFirefoxManifest({ ...firefoxManifest, name: 'Other extension' }), /Select Bramble/)
  assert.throws(() => adaptBrambleFirefoxManifest({ ...firefoxManifest, background: { service_worker: 'background.js' } }), /Firefox module background/)
})

test('allows popup navigation only within the loaded Bramble extension origin', () => {
  const extensionUrl = 'chrome-extension://bramble-extension-id/'
  assert.equal(isBrambleExtensionUrl('chrome-extension://bramble-extension-id/options.html', extensionUrl), true)
  assert.equal(isBrambleExtensionUrl('chrome-extension://bramble-extension-id/popup.html#vault', extensionUrl), true)
  assert.equal(isBrambleExtensionUrl('chrome-extension://other-extension-id/options.html', extensionUrl), false)
  assert.equal(isBrambleExtensionUrl('chrome-extension://bramble-extension-id.evil/options.html', extensionUrl), false)
  assert.equal(isBrambleExtensionUrl('https://bramble-extension-id/options.html', extensionUrl), false)
  assert.equal(isBrambleExtensionUrl('not a URL', extensionUrl), false)
})

test('provides extension-context browser alias and wraps the original worker after alias setup', () => {
  assert.match(BRAMBLE_BROWSER_ALIAS_SOURCE, /globalThis\.browser/)
  assert.match(BRAMBLE_BROWSER_ALIAS_SOURCE, /typeof globalThis\.document === 'undefined'/)
  assert.match(BRAMBLE_BROWSER_ALIAS_SOURCE, /surffishBramble/)
  assert.match(BRAMBLE_BROWSER_ALIAS_SOURCE, /openOptionsPage/)
  assert.match(BRAMBLE_BROWSER_ALIAS_SOURCE, /writeClipboard/)
  assert.match(BRAMBLE_BROWSER_ALIAS_SOURCE, /clipboard, 'writeText'/)
  assert.match(BRAMBLE_BROWSER_ALIAS_SOURCE, /hasDocument: async \(\) => true/)
  assert.match(BRAMBLE_BACKGROUND_WORKER_SOURCE, /import '\.\/surffish-bramble-browser-alias\.js'/)
  assert.match(BRAMBLE_BACKGROUND_WORKER_SOURCE, /import '\.\/background\.js'/)
  assert.doesNotMatch(BRAMBLE_BACKGROUND_WORKER_SOURCE, /\bawait\b/)
})

test('shortens only the picker settle delay and leaves visibility policy unchanged', () => {
  const source = 'var oi=500,si=-1/0;function ci(){si=performance.now()}function li(){return performance.now()-si<oi}'
  const adapted = adaptBrambleAutofillSettleDelay(source)
  assert.match(adapted, /var oi=100,si=-1\/0/)
  assert.throws(() => adaptBrambleAutofillSettleDelay('unexpected bundle'), /unsupported autofill click guard/)
})

test('injects the browser alias before Bramble extension-page module scripts, idempotently', () => {
  const original = '<!doctype html><html><head><title>Popup</title></head><body><script type="module" src="./popup.js"></script></body></html>'
  const adapted = injectBrambleBrowserAlias(original)
  assert.ok(adapted.indexOf(BRAMBLE_BROWSER_ALIAS_FILE) < adapted.indexOf('type="module"'))
  assert.equal(injectBrambleBrowserAlias(adapted), adapted)
})

test('makes the staged Bramble popup scrollable and responsive without double-injecting styles', () => {
  const original = '<html><head><style>html, body { width: 500px; height: 550px; overflow: hidden; }</style></head><body><div id="root"></div></body></html>'
  const adapted = adaptBramblePopupViewport(original)
  assert.match(adapted, /data-surffish-bramble-viewport/)
  assert.match(adapted, /max-width: 500px/)
  assert.match(adapted, /overflow: auto/)
  assert.equal(adaptBramblePopupViewport(adapted), adapted)
  assert.equal(original.includes('data-surffish-bramble-viewport'), false)
})

test('adds Surffish’s Scan QR to the staged options page only, idempotently', () => {
  const html = '<!doctype html><html><head><script type="module" src="/options.js"></script></head><body><div id="root"></div></body></html>'
  const once = injectBrambleQrJoinScript(html)
  assert.match(once, /<script defer src="\.\/surffish-bramble-qr-join\.js"><\/script>\n<\/head>/)
  assert.equal(injectBrambleQrJoinScript(once), once)

  const dir = mkdtempSync(join(tmpdir(), 'bramble-qr-'))
  try {
    writeFileSync(join(dir, 'options.html'), html)
    writeFileSync(join(dir, 'popup.html'), html)
    addBrambleQrJoin(dir, '/* page */', '/* jsqr */')
    assert.equal(readFileSync(join(dir, BRAMBLE_QR_JOIN_FILE), 'utf8'), '/* page */')
    assert.equal(readFileSync(join(dir, BRAMBLE_JSQR_FILE), 'utf8'), '/* jsqr */')
    assert.equal(readFileSync(join(dir, 'options.html'), 'utf8'), once)
    assert.equal(readFileSync(join(dir, 'popup.html'), 'utf8'), html, 'popup untouched')
    // Refresh (e.g. a dev run without the bundled jsQR): page script updated, stale decoder removed, tag not doubled.
    addBrambleQrJoin(dir, '/* page v2 */', null)
    assert.equal(readFileSync(join(dir, BRAMBLE_QR_JOIN_FILE), 'utf8'), '/* page v2 */')
    assert.equal(existsSync(join(dir, BRAMBLE_JSQR_FILE)), false)
    assert.equal(readFileSync(join(dir, 'options.html'), 'utf8'), once)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stages an adapted private copy and leaves the selected Firefox build unchanged', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'surffish-bramble-adapter-test-'))
  const source = join(temporaryRoot, 'source')
  const target = join(temporaryRoot, 'app-data', 'extension')
  mkdirSync(source, { recursive: true })
  const sourceManifest = {
    ...firefoxManifest,
    action: { default_popup: 'popup.html', theme_icons: [{ size: 16 }] },
    host_permissions: ['<all_urls>']
  }
  writeFileSync(join(source, 'manifest.json'), `${JSON.stringify(sourceManifest, null, 2)}\n`)
  writeFileSync(join(source, 'background.js'), 'globalThis.__brambleTestBackground = true;\n')
  const sourceContentScript = 'var oi=500,si=-1/0;function ci(){si=performance.now()}function li(){return performance.now()-si<oi}'
  const sourceAutofillUi = 'var O=typeof IntersectionObserver<`u`&&`trackVisibility`in IntersectionObserver.prototype,k=!1;function A(){if(!O||k)return!0;return false}'
  writeFileSync(join(source, 'content-script.js'), sourceContentScript)
  writeFileSync(join(source, 'autofill-ui.js'), sourceAutofillUi)
  const sourcePopup = '<html><head><title>Vault</title></head><body><script type="module" src="./popup.js"></script></body></html>'
  writeFileSync(join(source, 'popup.html'), sourcePopup)

  try {
    const staged = stageBrambleFirefoxBuild(source, target)
    const adapted = JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8'))
    assert.equal(staged.stagedDirectory, target)
    assert.equal(staged.version, '1.28.0')
    assert.equal(adapted.background.service_worker, BRAMBLE_BACKGROUND_WORKER_FILE)
    assert.ok(existsSync(join(target, BRAMBLE_BROWSER_ALIAS_FILE)))
    assert.match(readFileSync(join(target, BRAMBLE_BACKGROUND_WORKER_FILE), 'utf8'), /background\.js/)
    assert.match(readFileSync(join(target, 'popup.html'), 'utf8'), /surffish-bramble-browser-alias\.js/)
    assert.match(readFileSync(join(target, 'popup.html'), 'utf8'), /data-surffish-bramble-viewport/)
    assert.match(readFileSync(join(target, 'content-script.js'), 'utf8'), /var oi=100,si=-1\/0/)
    assert.equal(readFileSync(join(target, 'autofill-ui.js'), 'utf8'), sourceAutofillUi)
    assert.equal(readFileSync(join(source, 'manifest.json'), 'utf8'), `${JSON.stringify(sourceManifest, null, 2)}\n`)
    assert.equal(readFileSync(join(source, 'content-script.js'), 'utf8'), sourceContentScript)
    assert.equal(readFileSync(join(source, 'autofill-ui.js'), 'utf8'), sourceAutofillUi)
    assert.equal(readFileSync(join(source, 'popup.html'), 'utf8'), sourcePopup)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('routes the Bramble toolbar to install for a missing profile instead of reporting a popup as open', async () => {
  assert.equal(resolveBrambleToolbarAction({ installed: false, loading: false }), 'install')
  assert.equal(resolveBrambleToolbarAction({ installed: true, loading: false }), 'open')
  assert.equal(resolveBrambleToolbarAction({ installed: false, loading: true }), 'busy')
  assert.equal(resolveBrambleToolbarAction({ installed: true, loading: true }), 'busy')

  const actions: string[] = []
  const handlers = {
    open: () => { actions.push('open') },
    install: () => { actions.push('install') }
  }
  await dispatchBrambleToolbarAction({ installed: false, loading: false }, handlers)
  await dispatchBrambleToolbarAction({ installed: true, loading: false }, handlers)
  await dispatchBrambleToolbarAction({ installed: false, loading: true }, handlers)
  assert.deepEqual(actions, ['install', 'open'])
})

test('alias shims chrome.windows in the worker and forwards the pop-out to the offscreen page', async () => {
  const { runInNewContext } = await import('node:vm')
  const sent: unknown[] = []
  const worker: Record<string, unknown> = {
    URL,
    chrome: {
      action: { openPopup: async () => undefined },
      runtime: { getURL: (path: string) => `chrome-extension://abc${path}`, sendMessage: (message: unknown) => { sent.push(message); return Promise.resolve() } }
    }
  }
  worker.globalThis = worker
  runInNewContext(BRAMBLE_BROWSER_ALIAS_SOURCE, worker)
  // Electron's openPopup is a silent no-op; it must reject so Bramble falls back to windows.create.
  await assert.rejects((worker.chrome as { action: { openPopup: () => Promise<void> } }).action.openPopup())
  const windows = (worker.chrome as { windows: { create: (info: unknown) => Promise<{ id: number }>; remove: (id: number) => Promise<void>; get: (id: number) => Promise<unknown> } }).windows
  const created = await windows.create({ url: 'popup.html?detached=1', type: 'popup' })
  assert.equal(created.id, 1)
  await windows.remove(1)
  await assert.rejects(windows.get(1))
  assert.equal(JSON.stringify(sent), JSON.stringify([
    { __surffishBrambleWindows: 'create', url: 'chrome-extension://abc/popup.html?detached=1' },
    { __surffishBrambleWindows: 'remove' }
  ]))

  const calls: string[] = []
  let listener: ((message: unknown) => unknown) | undefined
  const page: Record<string, unknown> = {
    document: {},
    navigator: {},
    surffishBramble: { openPopout: async (url: string) => { calls.push(`open ${url}`) }, closePopout: async () => { calls.push('close') } },
    chrome: { runtime: { onMessage: { addListener: (fn: (message: unknown) => unknown) => { listener = fn } } } }
  }
  page.globalThis = page
  runInNewContext(BRAMBLE_BROWSER_ALIAS_SOURCE, page)
  listener?.(sent[0])
  listener?.(sent[1])
  listener?.({ type: 'unrelated' })
  assert.deepEqual(calls, ['open chrome-extension://abc/popup.html?detached=1', 'close'])
})

// ---------------------------------------------------------------------------
// storage.onChanged relay (Electron never fires it in the extension service worker)

function fakeEvent<T extends (...args: never[]) => unknown>() {
  const listeners: T[] = []
  return {
    listeners,
    addListener: (listener: T) => { listeners.push(listener) },
    removeListener: (listener: T) => { listeners.splice(listeners.indexOf(listener), 1) },
    hasListener: (listener: T) => listeners.includes(listener),
    fire: (...args: Parameters<T>) => { for (const listener of [...listeners]) listener(...args) }
  }
}

function fakeChrome(id = 'bramble') {
  const sent: unknown[] = []
  return {
    sent,
    chrome: {
      runtime: {
        id,
        getURL: (path: string) => `chrome-extension://${id}/${path.replace(/^\//, '')}`,
        onMessage: fakeEvent<(message: unknown, sender: unknown, sendResponse: () => void) => unknown>(),
        sendMessage: (message: unknown) => { sent.push(message); return Promise.resolve() }
      },
      storage: { onChanged: fakeEvent<(changes: Record<string, unknown>, area: string) => void>() }
    }
  }
}

test('worker: storage changes relayed by Bramble’s offscreen page reach Bramble’s onChanged listeners', async () => {
  const { chrome } = fakeChrome()
  const context: Record<string, unknown> = { chrome, console }
  context.globalThis = context
  const { runInNewContext } = await import('node:vm')
  runInNewContext(BRAMBLE_BROWSER_ALIAS_SOURCE, context)
  const seen: Array<[unknown, string]> = []
  const bramble = (changes: unknown, area: string): void => { seen.push([changes, area]) }
  chrome.storage.onChanged.addListener(bramble)
  const runtimeSeen: unknown[] = []
  chrome.runtime.onMessage.addListener((message: unknown) => { runtimeSeen.push(message) })
  const relay = { __surffishBrambleStorageChanged: { area: 'local', changes: { 'pref.autoLockMinutes': { newValue: 1, oldValue: 15 } } } }
  const offscreen = { id: 'bramble', url: 'chrome-extension://bramble/offscreen.html', tab: { id: 1 } }

  chrome.runtime.onMessage.fire(relay, offscreen, () => {})
  assert.deepEqual(seen, [[{ 'pref.autoLockMinutes': { newValue: 1, oldValue: 15 } }, 'local']])
  assert.deepEqual(runtimeSeen, [], 'Bramble’s own message listeners never see the relay')

  // Not from the offscreen page (a content script on a web page, another page, another extension): ignored.
  chrome.runtime.onMessage.fire(relay, { id: 'bramble', url: 'https://evil.example/', tab: { id: 2 } }, () => {})
  chrome.runtime.onMessage.fire(relay, { id: 'bramble', url: 'chrome-extension://bramble/popup.html' }, () => {})
  chrome.runtime.onMessage.fire(relay, { id: 'other', url: 'chrome-extension://bramble/offscreen.html' }, () => {})
  chrome.runtime.onMessage.fire({ __surffishBrambleStorageChanged: { area: 'session', changes: { k: {} } } }, offscreen, () => {})
  assert.equal(seen.length, 1)

  // Ordinary messages still reach Bramble.
  chrome.runtime.onMessage.fire({ type: 'CRYPTO_IS_LOCKED' }, offscreen, () => {})
  assert.deepEqual(runtimeSeen, [{ type: 'CRYPTO_IS_LOCKED' }])

  // A removed listener stops receiving; once the native event works, relays are ignored.
  chrome.storage.onChanged.removeListener(bramble)
  chrome.runtime.onMessage.fire(relay, offscreen, () => {})
  assert.equal(seen.length, 1)
  chrome.storage.onChanged.addListener(bramble)
  chrome.storage.onChanged.fire({ native: {} }, 'local')
  chrome.runtime.onMessage.fire(relay, offscreen, () => {})
  assert.deepEqual(seen.at(-1), [{ native: {} }, 'local'])
  assert.equal(seen.length, 2)
})

test('offscreen page: relays local-area changes to the worker, with large values reduced to keys and no session area', async () => {
  const { chrome, sent } = fakeChrome()
  const context: Record<string, unknown> = { chrome, console, document: {}, location: { protocol: 'chrome-extension:', pathname: '/offscreen.html' } }
  context.globalThis = context
  const { runInNewContext } = await import('node:vm')
  runInNewContext(BRAMBLE_BROWSER_ALIAS_SOURCE, context)
  chrome.storage.onChanged.fire({ 'pref.autoLockMinutes': { newValue: 5 }, 'vault-blob-b64:1': { newValue: 'x'.repeat(200_000) } }, 'local')
  chrome.storage.onChanged.fire({ 'vek:1': { newValue: 'secret key material' } }, 'session')
  // Objects built inside the vm realm: compare their JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ __surffishBrambleStorageChanged: { area: 'local', changes: { 'pref.autoLockMinutes': { newValue: 5 }, 'vault-blob-b64:1': {} } } }])
})

test('other extension pages and content scripts do not relay', async () => {
  for (const location of [{ protocol: 'chrome-extension:', pathname: '/popup.html' }, { protocol: 'https:', pathname: '/offscreen.html' }]) {
    const { chrome, sent } = fakeChrome()
    const context: Record<string, unknown> = { chrome, console, document: {}, location }
    context.globalThis = context
    const { runInNewContext } = await import('node:vm')
    runInNewContext(BRAMBLE_BROWSER_ALIAS_SOURCE, context)
    chrome.storage.onChanged.fire({ 'pref.autoLockMinutes': { newValue: 5 } }, 'local')
    assert.deepEqual(sent, [], JSON.stringify(location))
  }
})

test('alias gives Bramble’s popup and options pages chrome.tabs through Surffish (Settings → Restore / Import)', async () => {
  const { runInNewContext } = await import('node:vm')
  const calls: Array<[string, unknown]> = []
  const host = {
    tabs: async (op: string, payload: unknown) => {
      calls.push([op, payload])
      return op === 'query' ? [{ id: 5, url: 'https://example.com/' }] : op === 'create' ? { id: 9 } : undefined
    }
  }
  const page = (pathname: string, protocol = 'chrome-extension:') => {
    const { chrome } = fakeChrome()
    // Electron's own chrome.tabs in extension pages: query/update/get, no create/remove.
    const native = { query: async () => [{ id: 1, url: null }], update: async () => ({}), get: async () => ({}) }
    const context: Record<string, unknown> = { URL, console, document: {}, navigator: {}, location: { protocol, pathname }, surffishExtensionHost: host, chrome: { ...chrome, tabs: native } }
    context.globalThis = context
    runInNewContext(BRAMBLE_BROWSER_ALIAS_SOURCE, context)
    return context as { browser: { tabs: Record<string, (...args: unknown[]) => Promise<unknown>> }; chrome: { tabs: Record<string, unknown> } }
  }

  const popup = page('/popup.html')
  // Bramble 1.29: openSetup('restore') → browser.tabs.create({ url: runtime.getURL('options.html?screen=restore') }).
  assert.deepEqual(JSON.parse(JSON.stringify(await popup.browser.tabs.create!({ url: 'chrome-extension://bramble/options.html?screen=restore' }))), { id: 9 })
  await popup.browser.tabs.create!({ url: 'options.html?screen=import' })
  const queried = await popup.browser.tabs.query!({ active: true, currentWindow: true })
  assert.deepEqual(JSON.parse(JSON.stringify(queried)), [{ id: 5, url: 'https://example.com/' }])
  await new Promise((done) => (popup.browser.tabs.remove as unknown as (id: number, callback: () => void) => void)(9, () => done(undefined)))
  assert.deepEqual(calls.map(([op]) => op), ['create', 'create', 'query', 'remove'])
  assert.equal((calls[0]![1] as { url: string }).url, 'chrome-extension://bramble/options.html?screen=restore')
  assert.equal((calls[1]![1] as { url: string }).url, 'chrome-extension://bramble/options.html?screen=import', 'relative URLs resolve against the extension')

  calls.length = 0
  const options = page('/options.html')
  assert.equal(typeof options.browser.tabs.create, 'function')
  await options.browser.tabs.getCurrent!()
  assert.deepEqual(calls.map(([op]) => op), ['getCurrent'])

  // Not in the hidden offscreen host, and not in content scripts on web pages (Electron's tabs stay).
  for (const other of [page('/offscreen.html'), page('/', 'https:')]) {
    assert.equal(other.chrome.tabs.create, undefined)
  }
})
