import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  BRAMBLE_BACKGROUND_WORKER_FILE,
  BRAMBLE_BACKGROUND_WORKER_SOURCE,
  BRAMBLE_BROWSER_ALIAS_FILE,
  BRAMBLE_BROWSER_ALIAS_SOURCE,
  adaptBramblePopupViewport,
  adaptBrambleFirefoxManifest,
  injectBrambleBrowserAlias,
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

test('provides extension-context browser alias and wraps the original worker after alias setup', () => {
  assert.match(BRAMBLE_BROWSER_ALIAS_SOURCE, /globalThis\.browser/)
  assert.match(BRAMBLE_BROWSER_ALIAS_SOURCE, /typeof globalThis\.document === 'undefined'/)
  assert.match(BRAMBLE_BROWSER_ALIAS_SOURCE, /sockfishBramble/)
  assert.match(BRAMBLE_BROWSER_ALIAS_SOURCE, /openOptionsPage/)
  assert.match(BRAMBLE_BROWSER_ALIAS_SOURCE, /hasDocument: async \(\) => true/)
  assert.match(BRAMBLE_BACKGROUND_WORKER_SOURCE, /import '\.\/sockfish-bramble-browser-alias\.js'/)
  assert.match(BRAMBLE_BACKGROUND_WORKER_SOURCE, /import '\.\/background\.js'/)
  assert.doesNotMatch(BRAMBLE_BACKGROUND_WORKER_SOURCE, /\bawait\b/)
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
  assert.match(adapted, /data-sockfish-bramble-viewport/)
  assert.match(adapted, /max-width: 500px/)
  assert.match(adapted, /overflow: auto/)
  assert.equal(adaptBramblePopupViewport(adapted), adapted)
  assert.equal(original.includes('data-sockfish-bramble-viewport'), false)
})

test('stages an adapted private copy and leaves the selected Firefox build unchanged', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'sockfish-bramble-adapter-test-'))
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
    assert.match(readFileSync(join(target, 'popup.html'), 'utf8'), /sockfish-bramble-browser-alias\.js/)
    assert.match(readFileSync(join(target, 'popup.html'), 'utf8'), /data-sockfish-bramble-viewport/)
    assert.equal(readFileSync(join(source, 'manifest.json'), 'utf8'), `${JSON.stringify(sourceManifest, null, 2)}\n`)
    assert.equal(readFileSync(join(source, 'popup.html'), 'utf8'), sourcePopup)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})
