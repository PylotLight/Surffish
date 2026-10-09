import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectPasswordExtensionCompatibility } from './password-extension-compat.ts'

test('identifies Bitwarden manifest and API gaps without assuming MV2 equals compatibility', () => {
  const result = inspectPasswordExtensionCompatibility('bitwarden', {
    manifest_version: 2,
    name: '__MSG_extName__',
    short_name: 'Bitwarden',
    background: { page: 'background.html', persistent: true },
    browser_action: { default_popup: 'popup/index.html' },
    permissions: ['alarms', 'contextMenus', 'storage', 'tabs', 'webNavigation', 'webRequest', 'webRequestBlocking'],
    commands: { autofill_login: {} }
  })

  assert.equal(result.extensionName, 'Bitwarden')
  assert.equal(result.manifestVersion, 2)
  assert.equal(result.noDeclaredBlockers, false)
  assert.match(result.issues.map((issue) => issue.message).join('\n'), /contextMenus/)
  assert.match(result.issues.map((issue) => issue.message).join('\n'), /browser_action popup/)
  assert.match(result.issues.map((issue) => issue.message).join('\n'), /keyboard commands/)
})

test('identifies Bramble MV3 service-worker and API gaps', () => {
  const result = inspectPasswordExtensionCompatibility('bramble', {
    manifest_version: 3,
    name: 'Bramble',
    background: { service_worker: 'background.js', type: 'module' },
    action: { default_popup: 'popup.html' },
    permissions: ['storage', 'alarms', 'idle', 'offscreen', 'webAuthenticationProxy', 'identity'],
    commands: { 'lock-vault': {} }
  })

  assert.equal(result.manifestVersion, 3)
  assert.equal(result.noDeclaredBlockers, false)
  assert.match(result.issues.map((issue) => issue.message).join('\n'), /service worker/)
  assert.match(result.issues.map((issue) => issue.message).join('\n'), /offscreen/)
  assert.match(result.issues.map((issue) => issue.message).join('\n'), /action popup/)
})

test('reports a clean documented-surface manifest as having no declared blockers, not as runtime-verified', () => {
  const result = inspectPasswordExtensionCompatibility('bitwarden', {
    manifest_version: 2,
    name: 'Bitwarden',
    permissions: ['storage', 'tabs']
  })

  assert.equal(result.noDeclaredBlockers, true)
  assert.deepEqual(result.issues, [])
})
