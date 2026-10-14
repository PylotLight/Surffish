import assert from 'node:assert/strict'
import test from 'node:test'
import type { KdfParams } from './bramble-quick-unlock-crypto.ts'
import {
  BrambleQuickUnlockVault,
  LOCKED_OUT_NOTICE,
  MASTER_CHANGED_NOTICE,
  RESTART_NOTICE,
  type DeviceKeyProtector,
  type QuickUnlockPersistence,
  type StoredQuickUnlock
} from './bramble-quick-unlock-vault.ts'

const FAST: KdfParams = { id: 'scrypt', N: 1024, r: 8, p: 1 }
const MASTER = 'my long Bramble master password'

class MemoryFile implements QuickUnlockPersistence {
  value: StoredQuickUnlock | null = null
  writes = 0
  read(): unknown { return this.value ? structuredClone(this.value) : null }
  write(value: StoredQuickUnlock): void { this.value = structuredClone(value); this.writes++ }
  remove(): void { this.value = null }
}

/** Stand-in for safeStorage: XOR with a "keychain" secret that a copied file does not include. */
function fakeKeychain(available = true): DeviceKeyProtector & { keychain: Buffer } {
  const keychain = Buffer.alloc(32, 7)
  return {
    keychain,
    available: async () => available,
    protect: async (key) => Buffer.from(key.map((byte, i) => byte ^ (keychain[i] ?? 0))).toString('base64'),
    unprotect: async (stored) => Buffer.from(Buffer.from(stored, 'base64').map((byte, i) => byte ^ (keychain[i] ?? 0)))
  }
}

async function enrolled(options: { persist?: boolean; touchId?: boolean } = {}): Promise<{ vault: BrambleQuickUnlockVault; file: MemoryFile; keychain: ReturnType<typeof fakeKeychain> }> {
  const file = new MemoryFile()
  const keychain = fakeKeychain()
  const vault = new BrambleQuickUnlockVault(file, keychain)
  await vault.enrol({ masterPassword: MASTER, pin: '135790', confirmPin: '135790', touchId: options.touchId ?? false, requireMasterAfterRestart: !options.persist, kdf: FAST })
  return { vault, file, keychain }
}

test('memory-only (default): nothing that can unlock Bramble is written to disk', async () => {
  const { vault, file } = await enrolled()
  assert.equal(vault.status().armed, true)
  const onDisk = JSON.stringify(file.value)
  assert.equal(onDisk.includes(MASTER), false)
  assert.equal(file.value?.pin, undefined)
  assert.equal(file.value?.deviceKey, undefined)
  assert.equal(file.value?.rearm?.kind, 'master', 'only the PIN-under-master slot is persisted')
  const result = await vault.attemptPin('135790')
  assert.equal(result.status, 'ok')
  assert.equal(result.status === 'ok' && result.secret.toString(), MASTER)
})

test('memory-only after a restart: not armed until the master password re-arms the same PIN', async () => {
  const { file, keychain } = await enrolled({ touchId: true })
  const restarted = new BrambleQuickUnlockVault(file, keychain)
  await restarted.load()
  assert.deepEqual([restarted.status().armed, restarted.status().canRearm, restarted.status().notice], [false, true, RESTART_NOTICE])
  assert.equal((await restarted.attemptPin('135790')).status, 'unavailable')
  assert.equal(await restarted.rearmWithMasterPassword('wrong master', FAST), null)
  assert.equal((await restarted.rearmWithMasterPassword(MASTER, FAST))?.toString(), MASTER)
  assert.equal(restarted.status().armed, true)
  assert.equal(restarted.status().touchIdArmed, true)
  const result = await restarted.attemptPin('135790')
  assert.equal(result.status === 'ok' && result.secret.toString(), MASTER)
  assert.equal((await restarted.unlockWithDeviceKey())?.toString(), MASTER)
})

test('persisted mode survives a restart through the keychain-protected device key', async () => {
  const { file, keychain } = await enrolled({ persist: true, touchId: true })
  assert.ok(file.value?.deviceKey && file.value.pin && file.value.touch)
  assert.equal(JSON.stringify(file.value).includes(MASTER), false)
  const restarted = new BrambleQuickUnlockVault(file, keychain)
  await restarted.load()
  assert.equal(restarted.status().armed, true)
  const result = await restarted.attemptPin('135790')
  assert.equal(result.status === 'ok' && result.secret.toString(), MASTER)
  assert.equal((await restarted.unlockWithDeviceKey())?.toString(), MASTER)
})

test('persisted mode: a copied file without the keychain item is useless and gets wiped', async () => {
  const { file } = await enrolled({ persist: true })
  const otherMachine = new BrambleQuickUnlockVault(file, { ...fakeKeychain(), unprotect: async () => { throw new Error('no keychain item') } })
  await otherMachine.load()
  assert.equal(otherMachine.status().enabled, false)
  assert.equal(file.value?.pin, undefined)
})

test('persisting is refused without secure OS key storage', async () => {
  const vault = new BrambleQuickUnlockVault(new MemoryFile(), fakeKeychain(false))
  await assert.rejects(vault.enrol({ masterPassword: MASTER, pin: '1234', confirmPin: '1234', touchId: false, requireMasterAfterRestart: false, kdf: FAST }), /no secure key storage/)
  await vault.enrol({ masterPassword: MASTER, pin: '1234', confirmPin: '1234', touchId: false, requireMasterAfterRestart: true, kdf: FAST })
  assert.equal(vault.status().armed, true)
})

test('enrolment validates the PIN and its confirmation', async () => {
  const vault = new BrambleQuickUnlockVault(new MemoryFile(), fakeKeychain())
  const base = { masterPassword: MASTER, touchId: false, requireMasterAfterRestart: true, kdf: FAST }
  await assert.rejects(vault.enrol({ ...base, pin: '123', confirmPin: '123' }), /4 to 8 digits/)
  await assert.rejects(vault.enrol({ ...base, pin: '1234', confirmPin: '1243' }), /do not match/)
  await assert.rejects(vault.enrol({ ...base, masterPassword: '', pin: '1234', confirmPin: '1234' }), /master password/)
  assert.equal(vault.status().enabled, false)
})

test('five wrong PINs wipe the slot; the counter is persisted on every attempt', async () => {
  const { vault, file } = await enrolled({ persist: true, touchId: true })
  for (let i = 1; i <= 4; i++) {
    const result = await vault.attemptPin('000000')
    assert.deepEqual(result, { status: 'wrong', attemptsLeft: 5 - i })
    assert.equal(file.value?.failedAttempts, i)
  }
  assert.deepEqual(await vault.attemptPin('000000'), { status: 'locked-out' })
  assert.equal(vault.status().enabled, false)
  assert.equal(vault.status().notice, LOCKED_OUT_NOTICE)
  assert.equal(file.value?.pin, undefined)
  assert.equal(file.value?.touch, undefined)
  assert.equal(file.value?.deviceKey, undefined)
  // Even the right PIN does nothing now, and Touch ID is gone too.
  assert.equal((await vault.attemptPin('135790')).status, 'unavailable')
  assert.equal(await vault.unlockWithDeviceKey(), null)
})

test('a correct PIN resets the counter', async () => {
  const { vault, file } = await enrolled()
  await vault.attemptPin('111111')
  await vault.attemptPin('222222')
  assert.equal(file.value?.failedAttempts, 2)
  assert.equal((await vault.attemptPin('135790')).status, 'ok')
  assert.equal(file.value?.failedAttempts, 0)
})

test('killing Surffish mid-check never refunds the attempt (counted before checking)', async () => {
  const { vault, file } = await enrolled({ persist: true })
  const counters: number[] = []
  const write = file.write.bind(file)
  file.write = (value) => { counters.push(value.failedAttempts); write(value) }
  assert.equal((await vault.attemptPin('135790')).status, 'ok')
  assert.deepEqual(counters, [1, 0], 'the attempt hits the disk as a failure, then is refunded')
  counters.length = 0
  // A crash between the count and the refund leaves the failure on disk.
  file.write = (value) => { counters.push(value.failedAttempts); if (counters.length > 1) throw new Error('crash'); write(value) }
  await assert.rejects(vault.attemptPin('135790'))
  assert.equal(file.value?.failedAttempts, 1)
})

test('a counter already at the limit on disk wipes on load; a corrupt counter counts as exhausted', async () => {
  const { file, keychain } = await enrolled({ persist: true })
  file.value = { ...file.value!, failedAttempts: 5 }
  const restarted = new BrambleQuickUnlockVault(file, keychain)
  await restarted.load()
  assert.equal(restarted.status().enabled, false)
  const corrupted = await enrolled({ persist: true })
  corrupted.file.value = { ...corrupted.file.value!, failedAttempts: 'zero' as unknown as number }
  const second = new BrambleQuickUnlockVault(corrupted.file, corrupted.keychain)
  await second.load()
  assert.equal(second.status().enabled, false)
})

test('concurrent guesses are serialised, so each one is counted', async () => {
  const { vault, file } = await enrolled()
  const results = await Promise.all([vault.attemptPin('1'), vault.attemptPin('000000'), vault.attemptPin('999999')])
  assert.deepEqual(results.map((result) => result.status), ['wrong', 'wrong', 'wrong'])
  assert.equal(file.value?.failedAttempts, 3)
})

test('Bramble rejecting the filled password clears everything and says why', async () => {
  const { vault, file } = await enrolled({ persist: true, touchId: true })
  vault.masterPasswordRejected()
  assert.equal(vault.status().enabled, false)
  assert.equal(vault.status().notice, MASTER_CHANGED_NOTICE)
  assert.equal(file.value?.pin, undefined)
  assert.equal(await vault.unlockWithDeviceKey(), null)
})

test('disable removes the file; turning Touch ID off keeps the PIN', async () => {
  const { vault, file } = await enrolled({ persist: true, touchId: true })
  await vault.setTouchIdEnabled(false)
  assert.equal(file.value?.touch, undefined)
  assert.equal(await vault.unlockWithDeviceKey(), null)
  assert.equal((await vault.attemptPin('135790')).status, 'ok')
  vault.disable()
  assert.equal(file.value, null)
  assert.equal(vault.status().enabled, false)
})
