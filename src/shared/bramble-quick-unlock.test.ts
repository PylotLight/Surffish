import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BRAMBLE_VAULT_PROBE_SCRIPT,
  buildUnlockFillScript,
  classifyBrambleVaultProbe,
  QUICK_UNLOCK_NEEDS_VAULT,
  QUICK_UNLOCK_VAULT_UNKNOWN,
  quickUnlockSetupBlocker,
  classifyBrambleUnlockScreen,
  classifyFillOutcome,
  isBrambleUnlockPageUrl,
  quickUnlockPinError,
  type UnlockPageSnapshot
} from './bramble-quick-unlock.ts'

const EXTENSION = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'

function unlockScreen(patch: Partial<UnlockPageSnapshot> = {}, field: Partial<NonNullable<UnlockPageSnapshot['field']>> = {}): UnlockPageSnapshot {
  return {
    href: `${EXTENSION}popup.html`,
    passwordInputs: 1,
    field: { name: 'masterPassword', type: 'password', visible: true, disabled: false, readOnly: false, inForm: true, formPasswordInputs: 1, hasSubmit: true, invalid: false, busy: false, ...field },
    ...patch
  }
}

test('fill target: Bramble popup / options pages on its own origin only', () => {
  assert.ok(isBrambleUnlockPageUrl(`${EXTENSION}popup.html`, EXTENSION))
  assert.ok(isBrambleUnlockPageUrl(`${EXTENSION}options.html#/auth`, EXTENSION))
  assert.equal(isBrambleUnlockPageUrl(`${EXTENSION}offscreen.html`, EXTENSION), false)
  assert.equal(isBrambleUnlockPageUrl('chrome-extension://otherextensionidotherextensionid/popup.html', EXTENSION), false)
  assert.equal(isBrambleUnlockPageUrl('https://bramble.sh/popup.html', EXTENSION), false)
  assert.equal(isBrambleUnlockPageUrl('not a url', EXTENSION), false)
})

test('fill target: Bramble’s master-password unlock form is detected', () => {
  assert.equal(classifyBrambleUnlockScreen(unlockScreen(), EXTENSION), 'unlock')
  // The show-password toggle switches the field to type=text; still the unlock form.
  assert.equal(classifyBrambleUnlockScreen(unlockScreen({}, { type: 'text' }), EXTENSION), 'unlock')
  assert.equal(classifyBrambleUnlockScreen(unlockScreen({ href: `${EXTENSION}options.html` }), EXTENSION), 'unlock')
})

test('fill target: setup, change-password, busy, hidden and foreign screens are not', () => {
  // Vault setup / change master password carry a confirm field.
  assert.equal(classifyBrambleUnlockScreen(unlockScreen({ passwordInputs: 2 }, { formPasswordInputs: 2 }), EXTENSION), 'other')
  assert.equal(classifyBrambleUnlockScreen(unlockScreen({ passwordInputs: 2 }), EXTENSION), 'other', 'a second password field elsewhere on the page')
  assert.equal(classifyBrambleUnlockScreen(unlockScreen({}, { name: 'password' }), EXTENSION), 'other')
  assert.equal(classifyBrambleUnlockScreen(unlockScreen({}, { type: 'email' }), EXTENSION), 'other')
  assert.equal(classifyBrambleUnlockScreen(unlockScreen({}, { visible: false }), EXTENSION), 'other')
  assert.equal(classifyBrambleUnlockScreen(unlockScreen({}, { disabled: true }), EXTENSION), 'other')
  assert.equal(classifyBrambleUnlockScreen(unlockScreen({}, { readOnly: true }), EXTENSION), 'other')
  assert.equal(classifyBrambleUnlockScreen(unlockScreen({}, { inForm: false }), EXTENSION), 'other')
  assert.equal(classifyBrambleUnlockScreen(unlockScreen({}, { hasSubmit: false }), EXTENSION), 'other')
  assert.equal(classifyBrambleUnlockScreen(unlockScreen({ field: null, passwordInputs: 0 }), EXTENSION), 'other', 'unlocked vault')
  assert.equal(classifyBrambleUnlockScreen(unlockScreen({ href: 'https://example.com/login' }), EXTENSION), 'other', 'a web page with a masterPassword field')
  assert.equal(classifyBrambleUnlockScreen(null, EXTENSION), 'other')
  assert.equal(classifyBrambleUnlockScreen('unlock', EXTENSION), 'other')
})

test('fill outcome: unlocked when the form goes away, rejected when Bramble flags the field', () => {
  assert.equal(classifyFillOutcome(unlockScreen({ field: null, passwordInputs: 0 }), EXTENSION), 'unlocked')
  assert.equal(classifyFillOutcome(unlockScreen({}, { invalid: true }), EXTENSION), 'rejected')
  assert.equal(classifyFillOutcome(unlockScreen({}, { invalid: true, busy: true }), EXTENSION), 'pending', 'still unlocking')
  assert.equal(classifyFillOutcome(unlockScreen({}, { busy: true }), EXTENSION), 'pending')
  assert.equal(classifyFillOutcome(unlockScreen(), EXTENSION), 'pending')
  assert.equal(classifyFillOutcome(null, EXTENSION), 'pending', 'page mid-navigation')
  assert.equal(classifyFillOutcome(unlockScreen({ href: 'https://example.com/' }), EXTENSION), 'pending')
})

test('the fill script embeds the secret as a JSON string literal (no script injection)', () => {
  const nasty = `x"; alert(1); "\n</script>\u2028\\`
  const script = buildUnlockFillScript(nasty)
  assert.ok(script.includes(`const secret = ${JSON.stringify(nasty)};`))
  // The literal parses back to exactly the secret.
  const literal = script.slice(script.indexOf('const secret = ') + 'const secret = '.length, script.indexOf(';\n  const input'))
  assert.equal(JSON.parse(literal), nasty)
  assert.ok(script.includes(`input[name="masterPassword"]`))
  assert.ok(script.includes('requestSubmit'))
})

test('settings PIN validation', () => {
  assert.equal(quickUnlockPinError('1234', '1234'), null)
  assert.match(quickUnlockPinError('123', '123') ?? '', /4 to 8/)
  assert.match(quickUnlockPinError('12345', '12346') ?? '', /do not match/)
})

// ---------------------------------------------------------------------------
// Vault existence (Bramble 1.29 chrome.storage.local layout)

const VAULT_ID = '7f1c2d3e-0000-4000-8000-000000000001'
const BLOB = 'QlJBTUJMRS1WQVVMVC1CTE9C'

/** Run the probe script against a fake extension storage, the way the offscreen page would. */
async function probe(items: Record<string, unknown>, options: { promiseOnly?: boolean; noStorage?: boolean } = {}): Promise<unknown> {
  const requested: unknown[] = []
  const local = {
    get(keys: string | string[], callback?: (items: Record<string, unknown>) => void) {
      requested.push(keys)
      const list = typeof keys === 'string' ? [keys] : keys
      const picked = Object.fromEntries(list.filter((key) => key in items).map((key) => [key, items[key]]))
      if (options.promiseOnly) return Promise.resolve(picked)
      queueMicrotask(() => callback?.(picked))
      return undefined
    }
  }
  const api = options.noStorage ? { runtime: {} } : { runtime: {}, storage: { local } }
  const run = new Function('globalThis', `return ${BRAMBLE_VAULT_PROBE_SCRIPT}`) as (scope: unknown) => Promise<unknown>
  const result = await run(options.promiseOnly ? { browser: api } : { chrome: api })
  return { result, requested }
}

test('vault probe: a registered vault with a blob is present', async () => {
  const { result, requested } = await probe({ 'vault.registry': { vaults: [{ id: VAULT_ID, label: '', createdAt: 1 }] }, [`vault-blob-b64:${VAULT_ID}`]: BLOB }) as { result: unknown; requested: unknown[] }
  assert.deepEqual(result, { vaultIds: [VAULT_ID], blobs: { 'vault-blob-b64': false, [`vault-blob-b64:${VAULT_ID}`]: true } })
  assert.equal(classifyBrambleVaultProbe(result), 'present')
  // Only the registry and the blob keys are read, and no blob content comes back.
  assert.deepEqual(requested, ['vault.registry', ['vault-blob-b64', `vault-blob-b64:${VAULT_ID}`]])
  assert.equal(JSON.stringify(result).includes(BLOB), false)
})

test('vault probe: fresh Bramble (nothing stored, or an empty registry) is absent', async () => {
  for (const items of [{}, { 'vault.registry': { vaults: [] } }, { 'vault.registry': null }, { 'vault.registry': 'junk' }]) {
    const { result } = await probe(items) as { result: unknown }
    assert.equal(classifyBrambleVaultProbe(result), 'absent', JSON.stringify(items))
  }
})

test('vault probe: a registered id without a blob (setup abandoned / in progress) is absent', async () => {
  const registry = { vaults: [{ id: VAULT_ID, label: '', createdAt: 1 }] }
  for (const blob of [undefined, '', 42, null]) {
    const items: Record<string, unknown> = { 'vault.registry': registry }
    if (blob !== undefined) items[`vault-blob-b64:${VAULT_ID}`] = blob
    const { result } = await probe(items) as { result: unknown }
    assert.equal(classifyBrambleVaultProbe(result), 'absent', String(blob))
  }
  // A blob for an id the registry does not list is not counted (Bramble cannot open it either).
  const { result } = await probe({ 'vault.registry': { vaults: [] }, [`vault-blob-b64:${VAULT_ID}`]: BLOB }) as { result: unknown }
  assert.equal(classifyBrambleVaultProbe(result), 'absent')
})

test('vault probe: the pre-registry legacy blob key counts, and the browser.* promise API works', async () => {
  const { result } = await probe({ 'vault-blob-b64': BLOB }) as { result: unknown }
  assert.equal(classifyBrambleVaultProbe(result), 'present')
  const viaPromise = await probe({ 'vault.registry': { vaults: [{ id: VAULT_ID }] }, [`vault-blob-b64:${VAULT_ID}`]: BLOB }, { promiseOnly: true }) as { result: unknown }
  assert.equal(classifyBrambleVaultProbe(viaPromise.result), 'present')
})

test('vault probe: no extension storage or a malformed result is unknown, never present', async () => {
  const { result } = await probe({}, { noStorage: true }) as { result: unknown }
  assert.equal(result, null)
  assert.equal(classifyBrambleVaultProbe(result), 'unknown')
  assert.equal(classifyBrambleVaultProbe(undefined), 'unknown')
  assert.equal(classifyBrambleVaultProbe('present'), 'unknown')
  assert.equal(classifyBrambleVaultProbe({ vaultIds: 'x', blobs: {} }), 'unknown')
  assert.equal(classifyBrambleVaultProbe({ vaultIds: [], blobs: null }), 'unknown')
  assert.equal(classifyBrambleVaultProbe({ vaultIds: [VAULT_ID], blobs: { [`vault-blob-b64:${VAULT_ID}`]: 'yes' } }), 'absent', 'only a literal true counts')
})

test('setup blocker: PIN setup (UI and enrol IPC) needs Bramble to have a vault', () => {
  assert.equal(quickUnlockSetupBlocker('present'), null)
  assert.equal(quickUnlockSetupBlocker('absent'), QUICK_UNLOCK_NEEDS_VAULT)
  assert.match(QUICK_UNLOCK_NEEDS_VAULT, /Create your Bramble vault first/)
  assert.equal(quickUnlockSetupBlocker('unknown'), QUICK_UNLOCK_VAULT_UNKNOWN)
  assert.equal(quickUnlockSetupBlocker(undefined), QUICK_UNLOCK_VAULT_UNKNOWN)
  assert.equal(quickUnlockSetupBlocker(true), QUICK_UNLOCK_VAULT_UNKNOWN)
})
