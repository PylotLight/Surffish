import assert from 'node:assert/strict'
import test from 'node:test'
import { findExtensionApiReferences, inspectPasswordExtensionCompatibility } from './password-extension-compat.ts'

const issueText = (result: ReturnType<typeof inspectPasswordExtensionCompatibility>) =>
  result.issues.map((issue) => `${issue.severity}: ${issue.message}`).join('\n')

test('identifies Bitwarden MV2 permissions, popup, webRequest conflict, and commands', () => {
  const result = inspectPasswordExtensionCompatibility('bitwarden', {
    manifest_version: 2,
    name: '__MSG_extName__',
    short_name: 'Bitwarden',
    background: { page: 'background.html', persistent: true },
    browser_action: { default_popup: 'popup/index.html' },
    permissions: ['alarms', 'contextMenus', 'storage', 'tabs', 'webNavigation', 'webRequest', 'webRequestBlocking'],
    commands: { autofill_login: {} }
  }, [
    { path: 'background.js', content: 'chrome.contextMenus.create({}); chrome.alarms.create("tick");' },
    { path: 'content.js', content: 'chrome.webRequest.onBeforeRequest.addListener(() => {});' }
  ])

  assert.equal(result.extensionName, 'Bitwarden')
  assert.equal(result.manifestVersion, 2)
  assert.equal(result.noDeclaredBlockers, false)
  assert.match(issueText(result), /contextMenus/)
  assert.ok(result.issues.some((issue) => issue.severity === 'warning' && /alarms/.test(issue.message)))
  assert.ok(!result.issues.some((issue) => issue.severity === 'blocker' && /alarms/.test(issue.message)))
  assert.match(issueText(result), /browser_action declared/)
  assert.match(issueText(result), /keyboard commands/)
  assert.match(issueText(result), /webRequest.*conflict/)
  assert.deepEqual(result.observedApis, [
    'chrome.alarms.create',
    'chrome.contextMenus.create',
    'chrome.webRequest.onBeforeRequest.addListener'
  ])
})

test('identifies Bramble MV3 worker, missing runtime APIs, action UI, and broad host access', () => {
  const result = inspectPasswordExtensionCompatibility('bramble', {
    manifest_version: 3,
    name: 'Bramble',
    background: { service_worker: 'background.js', type: 'module' },
    action: { default_popup: 'popup.html' },
    host_permissions: ['<all_urls>'],
    permissions: ['storage', 'alarms', 'idle', 'offscreen', 'webAuthenticationProxy', 'identity'],
    commands: { 'lock-vault': {} }
  }, [
    { path: 'background.js', content: 'chrome.storage.session.get("key"); chrome.webAuthenticationProxy.onRequest.addListener(() => {});' }
  ])

  assert.equal(result.manifestVersion, 3)
  assert.equal(result.noDeclaredBlockers, false)
  assert.match(issueText(result), /service worker/)
  assert.match(issueText(result), /offscreen/)
  assert.match(issueText(result), /action declared/)
  assert.match(issueText(result), /keyboard commands/)
  assert.match(issueText(result), /<all_urls>/)
  assert.match(issueText(result), /storage.session/)
  assert.match(issueText(result), /webAuthenticationProxy/)
})

test('flags Firefox MV3 background scripts, Gecko metadata, browser namespace, and MAIN-world injection', () => {
  const result = inspectPasswordExtensionCompatibility('bramble', {
    manifest_version: 3,
    name: 'Bramble Firefox build',
    browser_specific_settings: { gecko: { id: 'bramble@example.invalid' } },
    background: { scripts: ['background.js'] },
    content_scripts: [{ matches: ['https://*/*'], js: ['hook.js'], world: 'MAIN' }]
  }, [
    { path: 'background.js', content: 'browser.storage.session.get("vault"); browser.runtime.onMessage.addListener(() => {});' }
  ])

  assert.equal(result.noDeclaredBlockers, false)
  assert.match(issueText(result), /Firefox-style background form/)
  assert.match(issueText(result), /browser_specific_settings\.gecko/)
  assert.match(issueText(result), /world: "MAIN"/)
  assert.match(issueText(result), /browser\.\* namespace/)
  assert.ok(result.observedApis.includes('browser.storage.session.get'))
})

test('source scanner finds API paths across files and deduplicates them without executing code', () => {
  const references = findExtensionApiReferences([
    { path: 'one.js', content: 'chrome.storage.local.get("a"); chrome.storage.local.set({ a: 1 });' },
    { path: 'two.js', content: 'browser.identity.getAuthToken({}); browser.storage?.session?.get("key"); chrome.storage.local.get("b");' }
  ])
  assert.deepEqual(references, [
    'browser.identity.getAuthToken',
    'browser.storage.session.get',
    'chrome.storage.local.get',
    'chrome.storage.local.set'
  ])
})

test('optional permission requests and undeclared source-only APIs are not missed', () => {
  const result = inspectPasswordExtensionCompatibility('bitwarden', {
    manifest_version: 2,
    name: 'Optional API probe',
    optional_permissions: ['notifications']
  }, [
    { path: 'lazy.js', content: 'chrome.notifications.create({}); chrome.idle.onStateChanged.addListener(() => {});' }
  ])

  assert.equal(result.noDeclaredBlockers, false)
  assert.match(issueText(result), /notifications/)
  assert.match(issueText(result), /optional permissions/)
  assert.match(issueText(result), /idle/)
})

test('webRequest is treated as documented but may conflict with the existing blocker', () => {
  const result = inspectPasswordExtensionCompatibility('bitwarden', {
    manifest_version: 2,
    name: 'Request observer',
    permissions: ['webRequest']
  }, [
    { path: 'background.js', content: 'chrome.webRequest.onCompleted.addListener(() => {});' }
  ])

  assert.equal(result.noDeclaredBlockers, true)
  assert.equal(result.issues.length, 1)
  assert.equal(result.issues[0]?.severity, 'warning')
  assert.match(result.issues[0]?.message ?? '', /conflict/)
})

test('supported Electron surface is a clean static result, not runtime verification', () => {
  const result = inspectPasswordExtensionCompatibility('bitwarden', {
    manifest_version: 2,
    name: 'Bitwarden',
    permissions: ['storage', 'tabs']
  }, [
    { path: 'background.js', content: 'chrome.storage.local.get("x"); chrome.runtime.getURL("popup.html");' }
  ])

  assert.equal(result.noDeclaredBlockers, true)
  assert.deepEqual(result.issues, [])
  assert.equal(result.staticOnly, true)
  assert.deepEqual(result.observedApis, ['chrome.runtime.getURL', 'chrome.storage.local.get'])
})

test('MV3 service-worker APIs measured in the current Electron runtime are warnings, not unsupported blockers', () => {
  const result = inspectPasswordExtensionCompatibility('bramble', {
    manifest_version: 3,
    name: 'Measured MV3 APIs',
    permissions: ['storage', 'alarms', 'idle', 'offscreen'],
    background: { service_worker: 'background.js' }
  }, [
    { path: 'background.js', content: 'chrome.storage.session.get("probe"); chrome.alarms.create("probe"); chrome.idle.queryState(15, () => {}); chrome.offscreen.createDocument({});' }
  ])

  assert.equal(result.noDeclaredBlockers, true)
  assert.ok(result.issues.every((issue) => issue.severity === 'warning'))
  assert.match(issueText(result), /runtime probe exposed/)
  assert.match(issueText(result), /storage\.session/)
})
