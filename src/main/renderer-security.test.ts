import assert from 'node:assert/strict'
import test from 'node:test'
import { isAuthorizedShellIpcSender, isExpectedRendererDocument } from './renderer-security.ts'

const trustedUrl = 'file:///Applications/Surffish/resources/app/renderer/index.html?surface=toolbar'

test('allows the exact trusted app document and harmless fragment changes only', () => {
  assert.equal(isExpectedRendererDocument(trustedUrl, trustedUrl), true)
  assert.equal(isExpectedRendererDocument(`${trustedUrl}#local-anchor`, trustedUrl), true)
  assert.equal(isExpectedRendererDocument('http://127.0.0.1:4321/index.html?surface=toolbar', trustedUrl), false)
  assert.equal(isExpectedRendererDocument(trustedUrl.replace('surface=toolbar', 'surface=content'), trustedUrl), false)
  assert.equal(isExpectedRendererDocument('file:///Applications/Surffish/other.html?surface=toolbar', trustedUrl), false)
})

test('privileged shell IPC requires a registered main-frame sender at its expected document', () => {
  const allowed = {
    registered: true,
    senderIsMainFrame: true,
    currentDocumentUrl: trustedUrl,
    expectedDocumentUrl: trustedUrl
  }
  assert.equal(isAuthorizedShellIpcSender(allowed), true)
  assert.equal(isAuthorizedShellIpcSender({ ...allowed, registered: false }), false, 'foreign WebContents are rejected')
  assert.equal(isAuthorizedShellIpcSender({ ...allowed, senderIsMainFrame: false }), false, 'subframes are rejected')
  assert.equal(isAuthorizedShellIpcSender({ ...allowed, currentDocumentUrl: 'http://127.0.0.1:4321/fixture' }), false, 'navigated documents are rejected')
})
