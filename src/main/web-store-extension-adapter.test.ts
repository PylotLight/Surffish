import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import {
  adaptWebStoreManifest,
  EXTENSION_BACKGROUND_WRAPPER_FILE,
  EXTENSION_SHIM_FILE,
  EXTENSION_SHIM_SOURCE,
  extensionWorkerFiles,
  injectExtensionShim,
  stageWebStoreExtension,
  writeExtensionShimFiles
} from './web-store-extension-adapter.ts'

const ID = 'dabkegjlekdcmefifaolmdhnhdcplklo'
const manifest = {
  update_url: 'https://clients2.google.com/service/update2/crx',
  manifest_version: 3,
  name: 'Fixture',
  version: '1.14',
  action: { default_popup: 'popup.html' },
  background: { service_worker: 'background.js' },
  content_scripts: [
    { matches: ['*://news.ycombinator.com/*'], js: ['content.js'] },
    { matches: ['*://example.com/*'], js: ['main.js'], world: 'MAIN' }
  ]
}

test('adapts the manifest: no update_url, store key, wrapped worker, shimmed isolated content scripts', () => {
  const { manifest: adapted, worker } = adaptWebStoreManifest(manifest, 'PUBKEY')
  assert.equal(adapted.update_url, undefined)
  assert.equal(adapted.key, 'PUBKEY')
  assert.deepEqual(adapted.background, { service_worker: EXTENSION_BACKGROUND_WRAPPER_FILE })
  assert.deepEqual(worker, { original: 'background.js', wrapper: EXTENSION_BACKGROUND_WRAPPER_FILE, module: false })
  const scripts = adapted.content_scripts as Array<{ js: string[] }>
  assert.deepEqual(scripts[0]?.js, [EXTENSION_SHIM_FILE, 'content.js'])
  assert.deepEqual(scripts[1]?.js, ['main.js'])
  assert.equal(manifest.update_url !== undefined, true, 'the source manifest object is not mutated')
  const nested = adaptWebStoreManifest({ ...manifest, background: { service_worker: 'js/sw.js', type: 'module' } }, null).worker
  assert.deepEqual(nested, { original: 'js/sw.js', wrapper: `js/${EXTENSION_BACKGROUND_WRAPPER_FILE}`, module: true })
})

test('injects the shim as the first script of extension pages', () => {
  const html = '<!doctype html><html><head><meta charset="utf-8"><script src="jquery.js"></script></head><body></body></html>'
  const adapted = injectExtensionShim(html)
  assert.ok(adapted.indexOf(EXTENSION_SHIM_FILE) < adapted.indexOf('jquery.js'))
  assert.equal(injectExtensionShim(adapted), adapted)
  assert.ok(injectExtensionShim('<p>bare</p>').startsWith('<script'))
})

test('stages a copy without _metadata and with the shim, wrapper, and identity key', () => {
  const root = mkdtempSync(join(tmpdir(), 'surffish-web-store-stage-'))
  try {
    const source = join(root, 'source')
    mkdirSync(join(source, '_metadata'), { recursive: true })
    writeFileSync(join(source, 'manifest.json'), JSON.stringify(manifest))
    writeFileSync(join(source, '_metadata', 'verified_contents.json'), '[]')
    writeFileSync(join(source, 'background.js'), "importScripts('lib.js')")
    writeFileSync(join(source, 'content.js'), '')
    writeFileSync(join(source, 'popup.html'), '<html><head><script src="popup.js"></script></head></html>')
    const staged = stageWebStoreExtension(source, join(root, 'staged'), 'PUBKEY')
    assert.equal(staged.version, '1.14')
    assert.equal(existsSync(join(staged.stagedDirectory, '_metadata')), false)
    assert.equal(readFileSync(join(staged.stagedDirectory, EXTENSION_SHIM_FILE), 'utf8'), EXTENSION_SHIM_SOURCE)
    assert.equal(readFileSync(join(staged.stagedDirectory, EXTENSION_BACKGROUND_WRAPPER_FILE), 'utf8'), `importScripts('/${EXTENSION_SHIM_FILE}', './background.js');\n`)
    assert.match(readFileSync(join(staged.stagedDirectory, 'popup.html'), 'utf8'), new RegExp(EXTENSION_SHIM_FILE))
    assert.equal(JSON.parse(readFileSync(join(staged.stagedDirectory, 'manifest.json'), 'utf8')).key, 'PUBKEY')
    assert.deepEqual(extensionWorkerFiles(staged.stagedDirectory), [EXTENSION_BACKGROUND_WRAPPER_FILE, EXTENSION_SHIM_FILE, 'background.js'])
    assert.equal(readFileSync(join(source, 'popup.html'), 'utf8').includes(EXTENSION_SHIM_FILE), false, 'the source stays untouched')
    // A newer Surffish refreshes the shim in place.
    writeFileSync(join(staged.stagedDirectory, EXTENSION_SHIM_FILE), 'old')
    writeExtensionShimFiles(staged.stagedDirectory)
    assert.equal(readFileSync(join(staged.stagedDirectory, EXTENSION_SHIM_FILE), 'utf8'), EXTENSION_SHIM_SOURCE)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function fakeChrome() {
  const store: Record<string, unknown> = {}
  const local = {
    get: async (keys?: string | string[] | null) => {
      if (keys == null) return { ...store }
      const list = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(list.filter((key) => key in store).map((key) => [key, store[key]]))
    },
    set: async (items: Record<string, unknown>) => { Object.assign(store, items) },
    remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key] },
    clear: async () => { for (const key of Object.keys(store)) delete store[key] }
  }
  const brokenSync: Record<string, (...args: unknown[]) => unknown> = { get: () => { throw new Error('"sync" is not available in this instance of Chrome') } }
  const chrome = {
    runtime: {
      id: ID,
      getManifest: () => ({ name: 'Fixture', version: '1.14', permissions: ['storage', 'https://x.test/*'], host_permissions: ['*://news.ycombinator.com/*'] }),
      getURL: (path: string) => `chrome-extension://${ID}/${path.replace(/^\//, '')}`,
      openOptionsPage: () => { throw new Error('native') }
    },
    storage: { local, sync: brokenSync },
    tabs: { query: async (..._args: unknown[]) => [] as unknown[] }
  }
  return { chrome, store }
}

/** Values created inside the vm realm have foreign prototypes; compare their JSON shape. */
function plain(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function runShim(context: Record<string, unknown>): void {
  runInNewContext(EXTENSION_SHIM_SOURCE, { console, URL, Promise, setTimeout, ...context })
}

test('shim: storage.sync is stored in storage.local (promise and callback forms)', async () => {
  const { chrome, store } = fakeChrome()
  const globalObject: Record<string, unknown> = { chrome }
  globalObject.globalThis = globalObject
  runShim(globalObject)
  await chrome.storage.sync.set!({ extensionpay_api_key: 'k' })
  assert.equal(store.extensionpay_api_key, 'k')
  assert.deepEqual(plain(await chrome.storage.sync.get!('extensionpay_api_key')), { extensionpay_api_key: 'k' })
  const viaCallback = await new Promise((resolve) => (chrome.storage.sync.get as (k: string, cb: (v: unknown) => void) => void)('extensionpay_api_key', resolve))
  assert.deepEqual(plain(viaCallback), { extensionpay_api_key: 'k' })
})

test('shim: management.getSelf/get return minimal self info and never pro/paid state', async () => {
  const { chrome } = fakeChrome()
  const globalObject: Record<string, unknown> = { chrome }
  globalObject.globalThis = globalObject
  runShim(globalObject) // worker context: no document
  const management = (chrome as unknown as { management: { getSelf(): Promise<Record<string, unknown>>; get(id: string): Promise<unknown> } }).management
  const self = plain(await management.getSelf()) as Record<string, unknown>
  assert.equal(self.id, ID)
  assert.equal(self.installType, 'normal')
  assert.equal(self.enabled, true)
  assert.deepEqual(self.permissions, ['storage'])
  assert.deepEqual(plain(await management.get(ID)), self)
  await assert.rejects(management.get('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'))
  assert.equal(/\bpro\b/i.test(EXTENSION_SHIM_SOURCE), false, 'the shim never sets paid/pro flags')
  assert.equal(/\bpaid\b/i.test(EXTENSION_SHIM_SOURCE), false)
})

test('shim: popup tabs calls route to the Surffish host bridge; content scripts are not given tabs', async () => {
  const { chrome } = fakeChrome()
  const calls: Array<[string, unknown]> = []
  const host = {
    tabs: async (op: string, payload: unknown) => {
      calls.push([op, payload])
      return op === 'query' ? [{ id: 5, url: 'https://news.ycombinator.com/news' }] : op === 'create' ? { id: 9 } : undefined
    },
    openOptionsPage: async () => true
  }
  const globalObject: Record<string, unknown> = { chrome, document: {}, location: { protocol: 'chrome-extension:' }, surffishExtensionHost: host }
  globalObject.globalThis = globalObject
  runShim(globalObject)
  const tabs = chrome.tabs as unknown as Record<string, (...args: unknown[]) => unknown>
  const queried = await new Promise((resolve) => tabs.query!({ active: true, currentWindow: true }, resolve))
  assert.deepEqual(plain(queried), [{ id: 5, url: 'https://news.ycombinator.com/news' }])
  assert.deepEqual(plain(await tabs.create!({ url: 'https://news.ycombinator.com/news', active: true })), { id: 9 })
  await tabs.update!(9, { active: true })
  await tabs.reload!()
  await tabs.create!({ url: 'options.html' })
  await (chrome.runtime.openOptionsPage as () => Promise<unknown>)()
  assert.deepEqual(calls.map(([op]) => op), ['query', 'create', 'update', 'reload', 'create'])
  assert.deepEqual(plain(calls[2]?.[1]), { tabId: 9, active: true })
  assert.deepEqual(plain(calls[3]?.[1]), { bypassCache: false })
  assert.equal((calls[4]?.[1] as { url: string }).url, `chrome-extension://${ID}/options.html`)

  const content = fakeChrome()
  const contentGlobal: Record<string, unknown> = { chrome: content.chrome, document: {}, location: { protocol: 'https:' }, surffishExtensionHost: host }
  contentGlobal.globalThis = contentGlobal
  runShim(contentGlobal)
  assert.deepEqual(plain(await content.chrome.tabs.query()), [], 'content scripts keep Electron’s own tabs')
  assert.equal((content.chrome as Record<string, unknown>).management, undefined, 'content scripts get no management stub')
  await content.chrome.storage.sync.set!({ a: 1 })
  assert.equal(content.store.a, 1)
})
