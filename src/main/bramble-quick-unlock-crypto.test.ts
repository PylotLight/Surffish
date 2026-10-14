import assert from 'node:assert/strict'
import test from 'node:test'
import {
  beginPinAttempt,
  finishPinAttempt,
  generateDeviceKey,
  isLockedOut,
  isValidPin,
  isWrappedSecret,
  MAX_PIN_ATTEMPTS,
  pinsMatch,
  unwrapPinWithMaster,
  unwrapWithDeviceKey,
  unwrapWithPin,
  wrapPinWithMaster,
  wrapWithDeviceKey,
  wrapWithPin,
  type KdfParams
} from './bramble-quick-unlock-crypto.ts'

// Cheap parameters so the suite stays fast; production uses defaultKdf().
const FAST: KdfParams = { id: 'scrypt', N: 1024, r: 8, p: 1 }
const MASTER = 'a very long master password ✓ with unicode'

test('PIN slot round-trips the master password and refuses a wrong PIN', async () => {
  const deviceKey = generateDeviceKey()
  const blob = await wrapWithPin(Buffer.from(MASTER), '4826', deviceKey, FAST)
  assert.equal(blob.kind, 'pin')
  assert.deepEqual(blob.kdf, FAST)
  assert.ok(isWrappedSecret(blob, 'pin'))
  assert.equal(JSON.stringify(blob).includes(MASTER), false, 'no plaintext in the blob')
  assert.equal((await unwrapWithPin(blob, '4826', deviceKey))?.toString(), MASTER)
  assert.equal(await unwrapWithPin(blob, '4827', deviceKey), null)
  assert.equal(await unwrapWithPin(blob, '48260', deviceKey), null)
})

test('the PIN slot needs the device key too: a copied blob plus the right PIN is not enough', async () => {
  const blob = await wrapWithPin(Buffer.from(MASTER), '123456', generateDeviceKey(), FAST)
  assert.equal(await unwrapWithPin(blob, '123456', generateDeviceKey()), null)
})

test('each wrap uses a fresh salt and IV', async () => {
  const deviceKey = generateDeviceKey()
  const a = await wrapWithPin(Buffer.from(MASTER), '1111', deviceKey, FAST)
  const b = await wrapWithPin(Buffer.from(MASTER), '1111', deviceKey, FAST)
  assert.notEqual(a.salt, b.salt)
  assert.notEqual(a.iv, b.iv)
  assert.notEqual(a.data, b.data)
})

test('tampering with any field, or swapping slot kinds, fails closed', async () => {
  const deviceKey = generateDeviceKey()
  const blob = await wrapWithPin(Buffer.from(MASTER), '2468', deviceKey, FAST)
  const flip = (b64: string): string => {
    const bytes = Buffer.from(b64, 'base64')
    bytes[0] = (bytes[0] ?? 0) ^ 1
    return bytes.toString('base64')
  }
  for (const field of ['data', 'tag', 'iv', 'salt'] as const) {
    assert.equal(await unwrapWithPin({ ...blob, [field]: flip(blob[field]) }, '2468', deviceKey), null, field)
  }
  // A touch-id blob relabelled as a PIN slot is rejected as malformed (no KDF), never decrypted.
  const touch = wrapWithDeviceKey(Buffer.from(MASTER), deviceKey)
  await assert.rejects(unwrapWithPin({ ...touch, kind: 'pin' }, '2468', deviceKey), /malformed/)
  // A PIN blob relabelled as a Touch ID slot does not open with the device key alone (AAD binds the kind).
  assert.equal(unwrapWithDeviceKey({ ...blob, kind: 'touch-id' }, deviceKey), null)
})

test('Touch ID slot round-trips with the device key only', () => {
  const deviceKey = generateDeviceKey()
  const blob = wrapWithDeviceKey(Buffer.from(MASTER), deviceKey)
  assert.equal(blob.kind, 'touch-id')
  assert.equal(blob.kdf, undefined)
  assert.equal(unwrapWithDeviceKey(blob, deviceKey)?.toString(), MASTER)
  assert.equal(unwrapWithDeviceKey(blob, generateDeviceKey()), null)
})

test('the master slot gives back the PIN only for the enrolled master password', async () => {
  const blob = await wrapPinWithMaster('908172', MASTER, FAST)
  assert.equal(blob.kind, 'master')
  assert.equal(await unwrapPinWithMaster(blob, MASTER), '908172')
  assert.equal(await unwrapPinWithMaster(blob, `${MASTER} `), null)
  assert.equal(await unwrapPinWithMaster(blob, ''), null)
})

test('PIN validation: 4-8 ASCII digits only', async () => {
  for (const pin of ['1234', '12345678', '0000']) assert.ok(isValidPin(pin), pin)
  for (const pin of ['123', '123456789', '12a4', ' 1234', '１２３４', '', 1234]) assert.equal(isValidPin(pin), false, String(pin))
  await assert.rejects(wrapWithPin(Buffer.from(MASTER), '12', generateDeviceKey(), FAST), /4–8 digits/)
  await assert.rejects(wrapWithPin(Buffer.alloc(0), '1234', generateDeviceKey(), FAST), /empty/)
  await assert.rejects(wrapWithPin(Buffer.from(MASTER), '1234', Buffer.alloc(16), FAST), /device key/)
  assert.ok(pinsMatch('1234', '1234'))
  assert.equal(pinsMatch('1234', '12345'), false)
  assert.equal(pinsMatch('1234', '1235'), false)
})

test('blobs with unknown versions, kinds or absurd KDF parameters are rejected', async () => {
  const blob = await wrapWithPin(Buffer.from(MASTER), '1234', generateDeviceKey(), FAST)
  assert.equal(isWrappedSecret({ ...blob, v: 2 }), false)
  assert.equal(isWrappedSecret({ ...blob, kind: 'other' }), false)
  assert.equal(isWrappedSecret({ ...blob, kdf: { id: 'scrypt', N: 1000, r: 8, p: 1 } }), false, 'N must be a power of two')
  assert.equal(isWrappedSecret({ ...blob, kdf: { id: 'scrypt', N: 2 ** 30, r: 8, p: 1 } }), false, 'N capped')
  assert.equal(isWrappedSecret({ ...blob, data: 'not base64!' }), false)
  assert.equal(isWrappedSecret(null), false)
})

test('lockout: the attempt is counted before the check and refunded on success', () => {
  let state = { failedAttempts: 0 }
  for (let attempt = 1; attempt < MAX_PIN_ATTEMPTS; attempt++) {
    const counted = beginPinAttempt(state)
    assert.equal(counted.failedAttempts, attempt, 'persisted before the PIN is checked')
    const outcome = finishPinAttempt(counted, false)
    assert.equal(outcome.status, 'wrong')
    assert.equal(outcome.status === 'wrong' && outcome.attemptsLeft, MAX_PIN_ATTEMPTS - attempt)
    state = outcome.state
  }
  const counted = beginPinAttempt(state)
  assert.ok(isLockedOut(counted))
  assert.equal(finishPinAttempt(counted, false).status, 'locked-out')
  // A correct PIN on the last attempt still works and resets the counter.
  assert.deepEqual(finishPinAttempt(counted, true), { status: 'ok', state: { failedAttempts: 0 } })
  assert.equal(beginPinAttempt({ failedAttempts: 99 }).failedAttempts, MAX_PIN_ATTEMPTS)
})
