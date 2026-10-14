/**
 * Crypto for Surffish's Bramble quick unlock (PIN / Touch ID). Pure node:crypto, no Electron, so
 * it is unit-tested directly (bramble-quick-unlock-crypto.test.ts).
 *
 * What is protected: the user's Bramble master password, which Surffish types into Bramble's own
 * unlock form. Bramble's vault crypto is never touched.
 *
 * PIN slot:      key = HKDF-SHA256(KDF(PIN, salt) ‖ deviceKey, salt, "…/pin")  →  AES-256-GCM
 * Touch ID slot: key = HKDF-SHA256(deviceKey, salt, "…/touch-id")              →  AES-256-GCM
 *
 * KDF is Argon2id (64 MiB, 3 passes) when the runtime supports crypto.argon2 (Node ≥ 24.7 with
 * OpenSSL ≥ 3.2), otherwise scrypt (N=2^17, r=8, ~128 MiB). Electron 44's BoringSSL has no Argon2,
 * so Surffish uses scrypt today. The device key is 32 random bytes that only
 * ever leave memory encrypted by Electron safeStorage (the macOS Keychain), so a copied blob
 * alone cannot be brute-forced over the small PIN space: the attacker also needs the Keychain item.
 * The KDF id and parameters travel in the blob, so they can change without breaking old blobs.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import * as nodeCrypto from 'node:crypto'

export const QUICK_UNLOCK_BLOB_VERSION = 1
export const MAX_PIN_ATTEMPTS = 5
export const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 8
/** Bramble master passwords are long, but nothing sane is longer than this. */
export const MAX_SECRET_BYTES = 4096

const PIN_INFO = 'surffish/bramble-quick-unlock/v1/pin'
const TOUCH_ID_INFO = 'surffish/bramble-quick-unlock/v1/touch-id'
const MASTER_INFO = 'surffish/bramble-quick-unlock/v1/master'

/** pin: master password under PIN+device key. touch-id: master password under the device key.
 * master: the PIN under the master password (memory-only mode re-arms from it after a restart). */
export type SlotKind = 'pin' | 'touch-id' | 'master'

export type KdfParams =
  | { id: 'argon2id'; memoryKiB: number; passes: number; parallelism: number }
  | { id: 'scrypt'; N: number; r: number; p: number }

export interface WrappedSecret {
  v: typeof QUICK_UNLOCK_BLOB_VERSION
  kind: SlotKind
  /** Present on PIN and master slots. */
  kdf?: KdfParams
  salt: string
  iv: string
  tag: string
  data: string
}

export const ARGON2ID_DEFAULT: KdfParams = { id: 'argon2id', memoryKiB: 64 * 1024, passes: 3, parallelism: 1 }
export const SCRYPT_DEFAULT: KdfParams = { id: 'scrypt', N: 2 ** 17, r: 8, p: 1 }

type Argon2 = (algorithm: string, parameters: Record<string, unknown>, callback: (error: Error | null, result: Buffer) => void) => void

function argon2Function(): Argon2 | null {
  const candidate = (nodeCrypto as unknown as { argon2?: unknown }).argon2
  return typeof candidate === 'function' ? candidate as Argon2 : null
}

let argon2Supported: boolean | null = null

/**
 * Electron's BoringSSL build exposes crypto.argon2 but throws ERR_CRYPTO_ARGON2_NOT_SUPPORTED, so
 * probe it once with tiny parameters rather than trusting the function's presence.
 */
export function argon2Available(): boolean {
  if (argon2Supported !== null) return argon2Supported
  const sync = (nodeCrypto as unknown as { argon2Sync?: (algorithm: string, parameters: Record<string, unknown>) => Buffer }).argon2Sync
  try {
    argon2Supported = argon2Function() !== null && typeof sync === 'function' &&
      sync('argon2id', { message: Buffer.from('probe'), nonce: Buffer.alloc(16), parallelism: 1, tagLength: 32, memory: 8, passes: 1 }).length === 32
  } catch {
    argon2Supported = false
  }
  return argon2Supported
}

/** Strongest KDF this runtime offers. */
export function defaultKdf(): KdfParams {
  return argon2Available() ? ARGON2ID_DEFAULT : SCRYPT_DEFAULT
}

/** 4–8 ASCII digits. Anything else (spaces, letters, full-width digits) is refused. */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && new RegExp(`^[0-9]{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin)
}

function assertKdf(kdf: unknown): asserts kdf is KdfParams {
  const value = kdf as Record<string, unknown> | null
  const int = (n: unknown, min: number, max: number): boolean => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max
  if (value && value.id === 'argon2id' && int(value.memoryKiB, 8, 4 * 1024 * 1024) && int(value.passes, 1, 64) && int(value.parallelism, 1, 16)) return
  if (value && value.id === 'scrypt' && int(value.N, 2, 2 ** 22) && ((value.N as number) & ((value.N as number) - 1)) === 0 && int(value.r, 1, 32) && int(value.p, 1, 16)) return
  throw new Error('Unsupported quick unlock key derivation parameters.')
}

/** PIN → 32-byte key with the blob's KDF. */
export async function derivePinKey(pin: string, salt: Buffer, kdf: KdfParams): Promise<Buffer> {
  assertKdf(kdf)
  const message = Buffer.from(pin, 'utf8')
  try {
    if (kdf.id === 'argon2id') {
      const argon2 = argon2Function()
      if (!argon2) throw new Error('This Surffish build cannot read an Argon2id quick unlock slot.')
      return await new Promise<Buffer>((resolve, reject) => {
        argon2('argon2id', { message, nonce: salt, parallelism: kdf.parallelism, tagLength: 32, memory: kdf.memoryKiB, passes: kdf.passes }, (error, result) => {
          if (error) reject(error)
          else resolve(Buffer.from(result))
        })
      })
    }
    // scrypt needs ~128·N·r bytes; give it headroom above Node's 32 MiB default.
    const maxmem = 256 * kdf.N * kdf.r + 16 * 1024 * 1024
    return await new Promise<Buffer>((resolve, reject) => {
      scryptCallback(message, salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem }, (error, key) => {
        if (error) reject(error)
        else resolve(key)
      })
    })
  } finally {
    message.fill(0)
  }
}

function hkdf(ikm: Buffer, salt: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, 32))
}

function aad(kind: SlotKind): Buffer {
  return Buffer.from(`surffish-bramble-quick-unlock|v${QUICK_UNLOCK_BLOB_VERSION}|${kind}`, 'utf8')
}

function assertDeviceKey(deviceKey: Buffer): void {
  if (!Buffer.isBuffer(deviceKey) || deviceKey.length !== 32) throw new Error('The quick unlock device key is missing or invalid.')
}

function assertSecret(secret: Buffer): void {
  if (!Buffer.isBuffer(secret) || secret.length === 0 || secret.length > MAX_SECRET_BYTES) throw new Error('The master password is empty or too long.')
}

function seal(kind: SlotKind, key: Buffer, salt: Buffer, secret: Buffer, kdf?: KdfParams): WrappedSecret {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad(kind))
  const data = Buffer.concat([cipher.update(secret), cipher.final()])
  const tag = cipher.getAuthTag()
  key.fill(0)
  return {
    v: QUICK_UNLOCK_BLOB_VERSION,
    kind,
    ...(kdf ? { kdf } : {}),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64')
  }
}

/** Decrypt, or null when the key is wrong (GCM tag mismatch). Throws only on a malformed blob. */
function open(blob: WrappedSecret, key: Buffer): Buffer | null {
  const iv = Buffer.from(blob.iv, 'base64')
  const tag = Buffer.from(blob.tag, 'base64')
  const data = Buffer.from(blob.data, 'base64')
  if (iv.length !== 12 || tag.length !== 16 || data.length === 0 || data.length > MAX_SECRET_BYTES) {
    key.fill(0)
    throw new Error('The stored quick unlock secret is malformed.')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(aad(blob.kind))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()])
  } catch {
    return null
  } finally {
    key.fill(0)
  }
}

async function pinSlotKey(pin: string, deviceKey: Buffer, salt: Buffer, kdf: KdfParams): Promise<Buffer> {
  const pinKey = await derivePinKey(pin, salt, kdf)
  const ikm = Buffer.concat([pinKey, deviceKey])
  pinKey.fill(0)
  try {
    return hkdf(ikm, salt, PIN_INFO)
  } finally {
    ikm.fill(0)
  }
}

export async function wrapWithPin(secret: Buffer, pin: string, deviceKey: Buffer, kdf: KdfParams = defaultKdf()): Promise<WrappedSecret> {
  if (!isValidPin(pin)) throw new Error(`The PIN must be ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits.`)
  assertSecret(secret)
  assertDeviceKey(deviceKey)
  const salt = randomBytes(16)
  return seal('pin', await pinSlotKey(pin, deviceKey, salt, kdf), salt, secret, kdf)
}

/** The secret, or null for a wrong PIN (or a different device key). */
export async function unwrapWithPin(blob: WrappedSecret, pin: string, deviceKey: Buffer): Promise<Buffer | null> {
  assertWrappedSecret(blob, 'pin')
  assertDeviceKey(deviceKey)
  // A malformed PIN is a wrong PIN: same cost path, same answer.
  const candidate = isValidPin(pin) ? pin : '0000'
  const key = await pinSlotKey(candidate, deviceKey, Buffer.from(blob.salt, 'base64'), blob.kdf as KdfParams)
  const result = open(blob, key)
  if (!isValidPin(pin)) {
    result?.fill(0)
    return null
  }
  return result
}

/** Passphrase (any string) → slot key, without the device key: for the PIN-under-master slot. */
async function passphraseSlotKey(passphrase: string, salt: Buffer, kdf: KdfParams): Promise<Buffer> {
  const stretched = await derivePinKey(passphrase, salt, kdf)
  try {
    return hkdf(stretched, salt, MASTER_INFO)
  } finally {
    stretched.fill(0)
  }
}

/** Wrap the PIN under the master password, so typing the master password once re-arms the PIN. */
export async function wrapPinWithMaster(pin: string, masterPassword: string, kdf: KdfParams = defaultKdf()): Promise<WrappedSecret> {
  if (!isValidPin(pin)) throw new Error(`The PIN must be ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits.`)
  if (!masterPassword) throw new Error('The master password is empty.')
  const salt = randomBytes(16)
  const secret = Buffer.from(pin, 'utf8')
  try {
    return seal('master', await passphraseSlotKey(masterPassword, salt, kdf), salt, secret, kdf)
  } finally {
    secret.fill(0)
  }
}

/** The PIN, or null when the master password differs from the one enrolled. */
export async function unwrapPinWithMaster(blob: WrappedSecret, masterPassword: string): Promise<string | null> {
  assertWrappedSecret(blob, 'master')
  if (!masterPassword || Buffer.byteLength(masterPassword) > MAX_SECRET_BYTES) return null
  const result = open(blob, await passphraseSlotKey(masterPassword, Buffer.from(blob.salt, 'base64'), blob.kdf as KdfParams))
  if (!result) return null
  const pin = result.toString('utf8')
  result.fill(0)
  return isValidPin(pin) ? pin : null
}

export function wrapWithDeviceKey(secret: Buffer, deviceKey: Buffer): WrappedSecret {
  assertSecret(secret)
  assertDeviceKey(deviceKey)
  const salt = randomBytes(16)
  return seal('touch-id', hkdf(deviceKey, salt, TOUCH_ID_INFO), salt, secret)
}

export function unwrapWithDeviceKey(blob: WrappedSecret, deviceKey: Buffer): Buffer | null {
  assertWrappedSecret(blob, 'touch-id')
  assertDeviceKey(deviceKey)
  return open(blob, hkdf(deviceKey, Buffer.from(blob.salt, 'base64'), TOUCH_ID_INFO))
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

export function isWrappedSecret(value: unknown, kind?: SlotKind): value is WrappedSecret {
  if (typeof value !== 'object' || value === null) return false
  const blob = value as Record<string, unknown>
  if (blob.v !== QUICK_UNLOCK_BLOB_VERSION || (blob.kind !== 'pin' && blob.kind !== 'touch-id' && blob.kind !== 'master')) return false
  if (kind && blob.kind !== kind) return false
  for (const field of ['salt', 'iv', 'tag', 'data'] as const) {
    if (typeof blob[field] !== 'string' || !BASE64.test(blob[field] as string)) return false
  }
  if (blob.kind !== 'touch-id') {
    try { assertKdf(blob.kdf) } catch { return false }
  }
  return true
}

function assertWrappedSecret(blob: unknown, kind: SlotKind): asserts blob is WrappedSecret {
  if (!isWrappedSecret(blob, kind)) throw new Error('The stored quick unlock secret is malformed.')
}

export function generateDeviceKey(): Buffer {
  return randomBytes(32)
}

/** Constant-time equality for two PIN strings (used for the enrolment confirm field). */
export function pinsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

// ---------------------------------------------------------------------------
// Lockout. The attempt is counted (and persisted by the caller) BEFORE the PIN is checked, and
// only refunded on success, so killing Surffish mid-check never yields a free guess.

export interface LockoutState {
  failedAttempts: number
}

export type PinAttemptOutcome =
  | { status: 'ok'; state: LockoutState }
  | { status: 'wrong'; state: LockoutState; attemptsLeft: number }
  | { status: 'locked-out'; state: LockoutState }

/** State to persist before checking a PIN: the attempt counted as a failure. */
export function beginPinAttempt(state: LockoutState): LockoutState {
  return { failedAttempts: Math.min(MAX_PIN_ATTEMPTS, Math.max(0, state.failedAttempts) + 1) }
}

/** True when no further PIN attempt may be made (the slot must be wiped). */
export function isLockedOut(state: LockoutState): boolean {
  return state.failedAttempts >= MAX_PIN_ATTEMPTS
}

/** Outcome after the check; `counted` is what beginPinAttempt returned. */
export function finishPinAttempt(counted: LockoutState, correct: boolean): PinAttemptOutcome {
  if (correct) return { status: 'ok', state: { failedAttempts: 0 } }
  if (isLockedOut(counted)) return { status: 'locked-out', state: counted }
  return { status: 'wrong', state: counted, attemptsLeft: MAX_PIN_ATTEMPTS - counted.failedAttempts }
}
