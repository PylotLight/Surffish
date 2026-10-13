import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeExtensionCompatibility } from './extension-compat.ts'
import { summarizeDnrRulesets } from './dnr.ts'

// Shaped like Modern for Hacker News 1.14 (manifest + the API calls it makes); no extension code is vendored.
const MHN_LIKE_MANIFEST = {
  manifest_version: 3,
  name: 'Modern for Hacker News',
  version: '1.14',
  action: { default_popup: 'popup.html' },
  permissions: ['activeTab', 'storage', 'unlimitedStorage'],
  host_permissions: ['*://news.ycombinator.com/*'],
  background: { service_worker: 'background.js' },
  content_scripts: [{ matches: ['*://news.ycombinator.com/*'], js: ['content.js'] }],
  web_accessible_resources: [{ resources: ['content.css', 'images/*'], matches: ['*://news.ycombinator.com/*'] }]
}
const MHN_LIKE_SOURCES = [
  { path: 'content.js', content: 'chrome.storage.local.get(["settings"]); chrome.storage.local.set({a:1}); chrome.storage.local.remove("a"); chrome.runtime.getURL("x"); chrome.runtime.onMessage.addListener(() => {})' },
  { path: 'popup.js', content: 'chrome.tabs.query({active:true}, cb); chrome.tabs.reload(); chrome.tabs.update(1, {active:true}); chrome.tabs.create({url:"https://news.ycombinator.com"})' },
  { path: 'ExtPay.js', content: 'const b = browserPolyfill; b.storage.sync.get(k); b.management.getSelf(); if (chrome.devtools) {} // see browser.Backup docs' }
]

test('an MHN-shaped extension is Supported, with Surffish shims listed', () => {
  const result = analyzeExtensionCompatibility(MHN_LIKE_MANIFEST, MHN_LIKE_SOURCES)
  assert.equal(result.level, 'supported')
  assert.deepEqual(result.blockers, [])
  assert.deepEqual(result.gaps, [])
  assert.ok(result.shimmed.some((entry) => entry.startsWith('storage.sync')))
  assert.ok(result.shimmed.some((entry) => entry.startsWith('management.getSelf')))
  assert.ok(result.shimmed.some((entry) => entry.startsWith('tabs.create')))
  assert.equal(result.manifestVersion, 3)
})

test('missing APIs make an extension Partial with the gaps listed', () => {
  const result = analyzeExtensionCompatibility(
    { ...MHN_LIKE_MANIFEST, permissions: ['storage', 'contextMenus', 'notifications'], commands: { open: {} } },
    [{ path: 'bg.js', content: 'chrome.contextMenus.create({}); chrome.windows.create({}); chrome.action.setBadgeText({text:"1"})' }]
  )
  assert.equal(result.level, 'partial')
  assert.deepEqual(result.blockers, [])
  assert.ok(result.gaps.some((gap) => gap.includes('contextMenus')))
  assert.ok(result.gaps.some((gap) => gap.includes('notifications')))
  assert.ok(result.gaps.some((gap) => gap.includes('keyboard shortcuts')))
  assert.ok(result.gaps.some((gap) => gap.includes('chrome.windows')))
  assert.ok(result.gaps.some((gap) => gap.includes('badge')))
})

test('hard blockers make an extension Unsupported', () => {
  assert.equal(analyzeExtensionCompatibility({ manifest_version: 3, name: 'Dark', version: '1', theme: { colors: {} } }).level, 'unsupported')
  assert.equal(analyzeExtensionCompatibility({ ...MHN_LIKE_MANIFEST, permissions: ['proxy'] }).level, 'unsupported')
  assert.equal(analyzeExtensionCompatibility({ ...MHN_LIKE_MANIFEST, background: { scripts: ['bg.js'] } }).level, 'unsupported')
  assert.equal(analyzeExtensionCompatibility({ name: 'No version' }).level, 'unsupported')
  const debuggerUse = analyzeExtensionCompatibility(MHN_LIKE_MANIFEST, [{ path: 'bg.js', content: 'chrome.debugger.attach({tabId:1})' }])
  assert.equal(debuggerUse.level, 'unsupported')
  assert.ok(debuggerUse.blockers[0]?.includes('chrome.debugger'))
})

test('MV2 extensions are allowed with a warning', () => {
  const result = analyzeExtensionCompatibility({ manifest_version: 2, name: 'Old', version: '1', background: { scripts: ['bg.js'] } })
  assert.equal(result.level, 'partial')
  assert.ok(result.gaps.some((gap) => gap.includes('Manifest V2')))
})

// Shaped like "I still don't care about cookies" 1.1.9 (manifest + the API calls it makes); no extension code is vendored.
const COOKIES_LIKE_MANIFEST = {
  manifest_version: 3,
  name: '__MSG_extensionName__',
  version: '1.1.9',
  permissions: ['tabs', 'storage', 'notifications', 'webRequest', 'declarativeNetRequestWithHostAccess', 'webNavigation', 'scripting'],
  host_permissions: ['http://*/*', 'https://*/*'],
  background: { service_worker: 'data/background.js', type: 'module' },
  options_ui: { page: 'data/options.html' },
  action: { default_popup: 'data/menu/index.html' },
  declarative_net_request: { rule_resources: [{ id: 'ruleset_1', enabled: true, path: 'rules.json' }] }
}
const COOKIES_LIKE_SOURCES = [{
  path: 'data/background.js',
  content: 'chrome.declarativeNetRequest.getDynamicRules(); chrome.declarativeNetRequest.updateDynamicRules({}); chrome.webNavigation.onCommitted.addListener(f); chrome.webNavigation.onCompleted.addListener(f); chrome.scripting.insertCSS({}); chrome.scripting.executeScript({}); chrome.tabs.onCreated.addListener(f); chrome.notifications.create("r", {}); chrome.runtime.onInstalled.addListener(f)'
}]

test('declarativeNetRequest + webNavigation extensions install (Surffish enforces the rules)', () => {
  const rules = [{ id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: '/iubenda_cs', resourceTypes: ['script'], excludedInitiatorDomains: ['skuola.net'] } }]
  const result = analyzeExtensionCompatibility(COOKIES_LIKE_MANIFEST, COOKIES_LIKE_SOURCES, summarizeDnrRulesets([{ id: 'ruleset_1', rules }]))
  assert.deepEqual(result.blockers, [])
  assert.equal(result.level, 'partial')
  assert.ok(result.shimmed.some((entry) => entry.startsWith('declarativeNetRequest')))
  assert.ok(result.shimmed.some((entry) => entry.startsWith('webNavigation')))
  assert.ok(!result.gaps.some((gap) => gap.includes('webNavigation') || gap.includes('declarativeNetRequest')))
  // The only remaining gap: notifications are not shown.
  assert.deepEqual(result.gaps, ['Desktop notifications from the extension are not shown'])
})

test('declarativeNetRequest gaps are precise: unenforceable rules and feedback APIs', () => {
  const rules = [
    { id: 1, action: { type: 'block' }, condition: { urlFilter: 'a' } },
    { id: 2, action: { type: 'block' }, condition: { responseHeaders: [{ header: 'content-type', values: ['text/html'] }] } }
  ]
  const result = analyzeExtensionCompatibility({ ...MHN_LIKE_MANIFEST, permissions: ['declarativeNetRequest', 'declarativeNetRequestFeedback'], declarative_net_request: { rule_resources: [{ id: 'r', enabled: true, path: 'r.json' }, { id: 'broken', path: 'b.json' }] } },
    [{ path: 'bg.js', content: 'chrome.declarativeNetRequest.getMatchedRules({}); chrome.declarativeNetRequest.updateSessionRules({})' }],
    summarizeDnrRulesets([{ id: 'r', rules }, { id: 'broken', rules: null }]))
  assert.equal(result.level, 'partial')
  assert.ok(result.gaps.some((gap) => gap.startsWith('1 of 2 declarativeNetRequest rules')))
  assert.ok(result.gaps.some((gap) => gap.includes('ruleset broken could not be read')))
  assert.ok(result.gaps.some((gap) => gap.includes('getMatchedRules')))
})
