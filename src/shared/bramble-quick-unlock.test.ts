import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildUnlockFillScript,
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
