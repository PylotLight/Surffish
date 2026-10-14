/**
 * State machine behind Surffish's Bramble quick unlock: enrolment, PIN attempts with lockout, the
 * Touch ID slot, memory-only vs persisted mode, and wiping. Electron-free: the file store and the
 * OS key protector (safeStorage) are injected, so it is unit-tested directly.
 *
 * On disk (bramble-quick-unlock.json, 0600) there is never a plaintext secret or device key:
 *   { v, enabled, touchId, requireMasterAfterRestart, restartModeChosen?, failedAttempts,
 *     deviceKey?: <safeStorage ciphertext, base64>, pin?: WrappedSecret, touch?: WrappedSecret,
 *     rearm?: WrappedSecret }
 *
 * Two modes:
 * - Persisted (the default, like Bitwarden's PIN without "lock with master password on restart"):
 *   deviceKey/pin/touch are written, the device key protected by safeStorage (macOS Keychain), so
 *   PIN and Touch ID keep working after Surffish restarts.
 * - Memory-only ("Require master password after Surffish restarts"): the slots live in this process
 *   and die with it. `rearm` is persisted instead: the PIN wrapped under the master password. After
 *   a restart the user unlocks once in Bramble's own form, Surffish sees the master password it was
 *   given (bramble-quick-unlock.ts) and, if it opens `rearm`, re-arms the PIN. It holds the PIN,
 *   never the master password.
 *
 * Migration: memory-only used to be the default and was only chosen at setup. A memory-only file
 * without `restartModeChosen` (written before the mode was switchable) moves to persisted the next
 * time it is armed with the master password, when safeStorage is available. Choosing memory-only
 * explicitly (at setup or in Settings) sets `restartModeChosen`, which is never migrated.
 */
import {
  beginPinAttempt,
  finishPinAttempt,
  generateDeviceKey,
  isLockedOut,
  isValidPin,
  isWrappedSecret,
  MAX_PIN_ATTEMPTS,
  pinsMatch,
  unwrapWithDeviceKey,
  unwrapPinWithMaster,
  unwrapWithPin,
  wrapPinWithMaster,
  wrapWithDeviceKey,
  wrapWithPin,
  type KdfParams,
  type WrappedSecret
} from './bramble-quick-unlock-crypto'

export interface QuickUnlockPersistence {
  read(): unknown
  write(value: StoredQuickUnlock): void
  remove(): void
}

/** Electron safeStorage in the app; a fake in tests. */
export interface DeviceKeyProtector {
  available(): Promise<boolean>
  protect(key: Buffer): Promise<string>
  unprotect(protectedKey: string): Promise<Buffer>
}

export interface StoredQuickUnlock {
  v: 1
  enabled: boolean
  touchId: boolean
  requireMasterAfterRestart: boolean
  /** The user picked the restart mode (setup or Settings). Absent on pre-switchable files: see Migration. */
  restartModeChosen?: boolean
  failedAttempts: number
  deviceKey?: string
  pin?: WrappedSecret
  touch?: WrappedSecret
  rearm?: WrappedSecret
}

export interface QuickUnlockStatus {
  enabled: boolean
  armed: boolean
  /** Enabled but not armed, and the master password can re-arm it (memory-only mode after a restart). */
  canRearm: boolean
  /** Re-arming with the master password will also move this enrolment to persisted mode (see Migration). */
  migratesOnRearm: boolean
  touchIdEnabled: boolean
  touchIdArmed: boolean
  requireMasterAfterRestart: boolean
  failedAttempts: number
  maxAttempts: number
  notice: string | null
}

export type PinUnlockResult =
  | { status: 'ok'; secret: Buffer }
  | { status: 'wrong'; attemptsLeft: number }
  | { status: 'locked-out' }
  | { status: 'unavailable' }

export const LOCKED_OUT_NOTICE = `Quick unlock was turned off after ${MAX_PIN_ATTEMPTS} wrong PINs. Unlock with your master password, then set up a PIN again in Settings → Integrations.`
export const MASTER_CHANGED_NOTICE = 'Bramble did not accept the saved master password (did it change?). Quick unlock was turned off; set it up again in Settings → Integrations.'
export const NEEDS_ARMED_TO_PERSIST = 'Unlock Bramble once (PIN, Touch ID or master password) to change this.'
export const NO_SECURE_STORAGE = 'This system has no secure key storage, so quick unlock cannot survive a restart here.'

export interface EnrolOptions {
  masterPassword: string
  pin: string
  confirmPin: string
  touchId: boolean
  requireMasterAfterRestart: boolean
  /** Test hook: cheaper KDF. */
  kdf?: KdfParams
}

function emptyStored(): StoredQuickUnlock {
  return { v: 1, enabled: false, touchId: false, requireMasterAfterRestart: false, failedAttempts: 0 }
}

function parseStored(value: unknown): StoredQuickUnlock {
  const base = emptyStored()
  if (typeof value !== 'object' || value === null) return base
  const raw = value as Record<string, unknown>
  if (raw.v !== 1) return base
  const stored: StoredQuickUnlock = {
    v: 1,
    enabled: raw.enabled === true,
    touchId: raw.touchId === true,
    // Pre-switchable files always wrote the flag; only a missing file defaults to persisted.
    requireMasterAfterRestart: raw.requireMasterAfterRestart !== false,
    failedAttempts: typeof raw.failedAttempts === 'number' && Number.isInteger(raw.failedAttempts) && raw.failedAttempts >= 0
      ? Math.min(raw.failedAttempts, MAX_PIN_ATTEMPTS)
      // An unreadable counter is treated as exhausted rather than reset: never a free retry.
      : raw.failedAttempts === undefined ? 0 : MAX_PIN_ATTEMPTS
  }
  if (raw.restartModeChosen === true) stored.restartModeChosen = true
  if (stored.requireMasterAfterRestart) {
    if (isWrappedSecret(raw.rearm, 'master')) stored.rearm = raw.rearm
  } else {
    if (typeof raw.deviceKey === 'string' && raw.deviceKey) stored.deviceKey = raw.deviceKey
    if (isWrappedSecret(raw.pin, 'pin')) stored.pin = raw.pin
    if (isWrappedSecret(raw.touch, 'touch-id')) stored.touch = raw.touch
  }
  return stored
}

export class BrambleQuickUnlockVault {
  private stored: StoredQuickUnlock
  private deviceKey: Buffer | null = null
  private pinBlob: WrappedSecret | null = null
  private touchBlob: WrappedSecret | null = null
  private notice: string | null = null
  private loaded: Promise<void> | null = null
  /** Serialises PIN attempts: a second guess waits for the first to be counted and checked. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly persistence: QuickUnlockPersistence, private readonly protector: DeviceKeyProtector) {
    this.stored = parseStored(persistence.read())
  }

  /** Restore the persisted slots (persisted mode only). Idempotent. */
  load(): Promise<void> {
    this.loaded ??= this.restore()
    return this.loaded
  }

  private async restore(): Promise<void> {
    const stored = this.stored
    if (!stored.enabled) return
    if (isLockedOut(stored)) {
      this.wipe(LOCKED_OUT_NOTICE)
      return
    }
    // Memory-only after a restart: not armed until Bramble's own form is used (Settings explains it
    // from canRearm; no notice, so it is never said twice).
    if (stored.requireMasterAfterRestart) return
    if (!stored.deviceKey || !stored.pin) return
    try {
      if (!await this.protector.available()) throw new Error('OS key storage is unavailable.')
      const key = await this.protector.unprotect(stored.deviceKey)
      if (key.length !== 32) throw new Error('bad device key')
      this.deviceKey = key
      this.pinBlob = stored.pin
      this.touchBlob = stored.touchId && stored.touch ? stored.touch : null
    } catch {
      // Keychain item gone or different machine: the blobs are useless now.
      this.wipe('Surffish could not read its quick unlock key from the system keychain. Set up a PIN again in Settings → Integrations.')
    }
  }

  status(): QuickUnlockStatus {
    return {
      enabled: this.stored.enabled,
      armed: this.stored.enabled && this.pinBlob !== null && this.deviceKey !== null,
      canRearm: this.stored.enabled && (this.pinBlob === null || this.deviceKey === null) && this.stored.rearm !== undefined,
      migratesOnRearm: this.stored.enabled && this.stored.requireMasterAfterRestart && this.stored.restartModeChosen !== true,
      touchIdEnabled: this.stored.enabled && this.stored.touchId,
      touchIdArmed: this.stored.enabled && this.stored.touchId && this.touchBlob !== null && this.deviceKey !== null,
      requireMasterAfterRestart: this.stored.requireMasterAfterRestart,
      failedAttempts: this.stored.failedAttempts,
      maxAttempts: MAX_PIN_ATTEMPTS,
      notice: this.notice
    }
  }

  async enrol(options: EnrolOptions): Promise<void> {
    await this.load()
    if (!isValidPin(options.pin)) throw new Error('Use a PIN of 4 to 8 digits.')
    if (!pinsMatch(options.pin, options.confirmPin)) throw new Error('The PINs do not match.')
    if (!options.masterPassword) throw new Error('Enter your Bramble master password.')
    const persist = !options.requireMasterAfterRestart
    if (persist && !await this.protector.available()) {
      throw new Error(`${NO_SECURE_STORAGE} Turn on “Require master password after Surffish restarts”.`)
    }
    const secret = Buffer.from(options.masterPassword, 'utf8')
    const deviceKey = generateDeviceKey()
    try {
      const pinBlob = await wrapWithPin(secret, options.pin, deviceKey, options.kdf)
      const touchBlob = options.touchId ? wrapWithDeviceKey(secret, deviceKey) : null
      const next: StoredQuickUnlock = {
        v: 1,
        enabled: true,
        touchId: options.touchId,
        requireMasterAfterRestart: options.requireMasterAfterRestart,
        restartModeChosen: true,
        failedAttempts: 0
      }
      if (persist) {
        next.deviceKey = await this.protector.protect(deviceKey)
        next.pin = pinBlob
        if (touchBlob) next.touch = touchBlob
      } else {
        next.rearm = await wrapPinWithMaster(options.pin, options.masterPassword, options.kdf)
      }
      this.persistence.write(next)
      this.deviceKey?.fill(0)
      this.stored = next
      this.deviceKey = deviceKey
      this.pinBlob = pinBlob
      this.touchBlob = touchBlob
      this.notice = null
      this.loaded = Promise.resolve()
    } catch (error) {
      deviceKey.fill(0)
      throw error
    } finally {
      secret.fill(0)
    }
  }

  /** Turn quick unlock off and forget everything. */
  disable(): void {
    this.wipe(null)
  }

  /** Called when Bramble rejects the filled password. */
  masterPasswordRejected(): void {
    this.wipe(MASTER_CHANGED_NOTICE)
  }

  /**
   * Switch the restart mode after setup. To persisted: needs the slots armed in memory (they are
   * what gets written). To memory-only: needs the PIN, checked like any PIN attempt (counted, so
   * this is no side door for guessing), because the re-arm slot is the PIN wrapped under the master
   * password. Either way the choice is marked as the user's, so it is never migrated again.
   */
  async setRequireMasterAfterRestart(require: boolean, pin?: string, kdf?: KdfParams): Promise<void> {
    await this.load()
    if (!this.stored.enabled) {
      const next: StoredQuickUnlock = { ...this.stored, requireMasterAfterRestart: require, restartModeChosen: true }
      this.stored = next
      return
    }
    if (require === this.stored.requireMasterAfterRestart) {
      if (this.stored.restartModeChosen !== true) this.writeStored({ ...this.stored, restartModeChosen: true })
      return
    }
    if (!require) {
      if (!await this.protector.available()) throw new Error(NO_SECURE_STORAGE)
      if (!this.deviceKey || !this.pinBlob) throw new Error(NEEDS_ARMED_TO_PERSIST)
      await this.persistArmedSlots(true)
      return
    }
    if (typeof pin !== 'string' || !pin) throw new Error('Enter your PIN to turn this on.')
    const outcome = await this.attemptPin(pin)
    if (outcome.status === 'wrong') throw new Error(outcome.attemptsLeft === 1 ? 'Wrong PIN. 1 try left before quick unlock is turned off.' : `Wrong PIN. ${outcome.attemptsLeft} tries left.`)
    if (outcome.status === 'locked-out') throw new Error(LOCKED_OUT_NOTICE)
    if (outcome.status === 'unavailable') throw new Error(NEEDS_ARMED_TO_PERSIST)
    const secret = outcome.secret
    try {
      const rearm = await wrapPinWithMaster(pin, secret.toString('utf8'), kdf)
      const next: StoredQuickUnlock = { ...this.stored, requireMasterAfterRestart: true, restartModeChosen: true, rearm }
      delete next.deviceKey
      delete next.pin
      delete next.touch
      this.writeStored(next)
    } finally {
      secret.fill(0)
    }
  }

  /** Write the in-memory slots to disk (device key via safeStorage) and drop the re-arm slot. */
  private async persistArmedSlots(chosen: boolean): Promise<void> {
    if (!this.deviceKey || !this.pinBlob) throw new Error(NEEDS_ARMED_TO_PERSIST)
    const next: StoredQuickUnlock = { ...this.stored, requireMasterAfterRestart: false }
    if (chosen) next.restartModeChosen = true
    delete next.rearm
    next.deviceKey = await this.protector.protect(this.deviceKey)
    next.pin = this.pinBlob
    if (this.touchBlob) next.touch = this.touchBlob
    else delete next.touch
    this.writeStored(next)
  }

  private writeStored(next: StoredQuickUnlock): void {
    this.persistence.write(next)
    this.stored = next
  }

  async setTouchIdEnabled(enabled: boolean): Promise<void> {
    await this.load()
    if (!enabled) {
      const next: StoredQuickUnlock = { ...this.stored, touchId: false }
      delete next.touch
      this.persistence.write(next)
      this.stored = next
      this.touchBlob = null
      return
    }
    // Adding Touch ID needs the secret, which only a PIN unlock or enrolment provides.
    throw new Error('Set up quick unlock again to add Touch ID.')
  }

  /** Check a PIN. The attempt is persisted as a failure before the check and refunded on success. */
  attemptPin(pin: string): Promise<PinUnlockResult> {
    const run = this.queue.then(() => this.attemptPinNow(pin))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async attemptPinNow(pin: string): Promise<PinUnlockResult> {
    await this.load()
    if (!this.stored.enabled || !this.pinBlob || !this.deviceKey) return { status: 'unavailable' }
    if (isLockedOut(this.stored)) {
      this.wipe(LOCKED_OUT_NOTICE)
      return { status: 'locked-out' }
    }
    const counted = beginPinAttempt(this.stored)
    this.writeCounter(counted.failedAttempts)
    let secret: Buffer | null = null
    try {
      secret = await unwrapWithPin(this.pinBlob, pin, this.deviceKey)
    } catch {
      secret = null
    }
    const outcome = finishPinAttempt(counted, secret !== null)
    if (outcome.status === 'ok' && secret) {
      this.writeCounter(0)
      return { status: 'ok', secret }
    }
    if (outcome.status === 'locked-out') {
      this.wipe(LOCKED_OUT_NOTICE)
      return { status: 'locked-out' }
    }
    return { status: 'wrong', attemptsLeft: outcome.status === 'wrong' ? outcome.attemptsLeft : 0 }
  }

  /**
   * After a restart in memory-only mode: the master password (the one the user just gave Bramble's
   * own unlock form) opens the PIN, which re-arms the PIN and Touch ID slots in memory. A
   * pre-switchable enrolment is moved to persisted mode here (see Migration); if the keychain
   * write fails it simply stays memory-only. Returns the master password bytes, or null when it is
   * not the enrolled master password (nothing changes then).
   */
  async rearmWithMasterPassword(masterPassword: string, kdf?: KdfParams): Promise<Buffer | null> {
    await this.load()
    const rearm = this.stored.rearm
    if (!this.stored.enabled || !rearm) return null
    const pin = await unwrapPinWithMaster(rearm, masterPassword)
    if (!pin) return null
    const secret = Buffer.from(masterPassword, 'utf8')
    const deviceKey = generateDeviceKey()
    try {
      this.pinBlob = await wrapWithPin(secret, pin, deviceKey, kdf ?? rearm.kdf)
      this.touchBlob = this.stored.touchId ? wrapWithDeviceKey(secret, deviceKey) : null
      this.deviceKey?.fill(0)
      this.deviceKey = deviceKey
      this.notice = null
      if (this.status().migratesOnRearm) {
        try {
          if (await this.protector.available()) await this.persistArmedSlots(false)
        } catch {
          // Keychain refused: armed for this session, still memory-only on disk.
        }
      }
      return secret
    } catch (error) {
      deviceKey.fill(0)
      secret.fill(0)
      throw error
    }
  }

  /** Touch ID slot: the caller has already passed systemPreferences.promptTouchID. */
  async unlockWithDeviceKey(): Promise<Buffer | null> {
    await this.load()
    if (!this.stored.enabled || !this.stored.touchId || !this.touchBlob || !this.deviceKey) return null
    try {
      return unwrapWithDeviceKey(this.touchBlob, this.deviceKey)
    } catch {
      return null
    }
  }

  private writeCounter(failedAttempts: number): void {
    const next = { ...this.stored, failedAttempts }
    this.persistence.write(next)
    this.stored = next
  }

  private wipe(notice: string | null): void {
    this.deviceKey?.fill(0)
    this.deviceKey = null
    this.pinBlob = null
    this.touchBlob = null
    this.notice = notice
    const next: StoredQuickUnlock = { ...emptyStored(), requireMasterAfterRestart: this.stored.requireMasterAfterRestart }
    try {
      if (notice === null) this.persistence.remove()
      else this.persistence.write(next)
    } catch {
      // Keep going: the in-memory slots are already gone.
    }
    this.stored = next
    this.loaded = Promise.resolve()
  }
}
