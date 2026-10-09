import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getBrowserSession } from './browser-session'

const SESSION_COOKIE_FILE = 'session-cookies.enc'
const COOKIE_SAVE_DELAY_MS = 400
let saveTimer: ReturnType<typeof setTimeout> | undefined
let quitFlushInstalled = false
let persistQueue: Promise<void> = Promise.resolve()

interface StoredSessionCookie {
  url: string
  name: string
  value: string
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: Electron.Cookie['sameSite']
}

function cookieFilePath(): string {
  return join(app.getPath('userData'), SESSION_COOKIE_FILE)
}

async function hasSecureStorage(): Promise<boolean> {
  try {
    if (!await safeStorage.isAsyncEncryptionAvailable()) return false
    if (process.platform === 'linux') {
      const backend = safeStorage.getSelectedStorageBackend()
      return backend !== 'basic_text' && backend !== 'unknown'
    }
    return true
  } catch (error) {
    console.warn('Secure storage is unavailable for session cookies:', error)
    return false
  }
}

function serializableCookie(cookie: Electron.Cookie): StoredSessionCookie | null {
  const domain = cookie.domain?.replace(/^\./, '')
  if (!domain || !cookie.session) return null
  const path = cookie.path?.startsWith('/') ? cookie.path : `/${cookie.path ?? ''}`
  const urlHost = domain.includes(':') && !domain.startsWith('[') ? `[${domain}]` : domain
  return {
    url: `${cookie.secure ? 'https' : 'http'}://${urlHost}${path}`,
    name: cookie.name,
    value: cookie.value,
    ...(!cookie.hostOnly && cookie.domain ? { domain: cookie.domain } : {}),
    path,
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    sameSite: cookie.sameSite
  }
}

function parseStoredCookie(value: unknown): StoredSessionCookie | null {
  if (typeof value !== 'object' || value === null) return null
  const cookie = value as Partial<StoredSessionCookie>
  if (typeof cookie.url !== 'string' || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') return null
  if (typeof cookie.path !== 'string' || typeof cookie.secure !== 'boolean' || typeof cookie.httpOnly !== 'boolean') return null
  if (!['unspecified', 'no_restriction', 'lax', 'strict'].includes(cookie.sameSite ?? '')) return null
  try {
    const url = new URL(cookie.url)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null
  } catch {
    return null
  }
  if (cookie.domain !== undefined && typeof cookie.domain !== 'string') return null
  return cookie as StoredSessionCookie
}

async function persistSessionCookies(): Promise<void> {
  const canEncrypt = await hasSecureStorage()
  if (!canEncrypt) return

  const cookies = await getBrowserSession().cookies.get({})
  const snapshot = cookies.map(serializableCookie).filter((cookie): cookie is StoredSessionCookie => cookie !== null)
  const path = cookieFilePath()
  if (snapshot.length === 0) {
    rmSync(path, { force: true })
    return
  }

  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(snapshot))
  const temporaryPath = `${path}.tmp`
  try {
    const directory = app.getPath('userData')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(temporaryPath, encrypted, { mode: 0o600 })
    renameSync(temporaryPath, path)
  } catch (error) {
    console.error('Could not save encrypted session cookies:', error)
    try { rmSync(temporaryPath, { force: true }) } catch { /* ignore cleanup failures */ }
  }
}

async function restoreSessionCookies(): Promise<void> {
  const path = cookieFilePath()
  if (!existsSync(path)) return
  if (!await hasSecureStorage()) {
    console.warn('Saved session cookies were not restored because OS-backed encryption is unavailable.')
    return
  }

  try {
    const decrypted = await safeStorage.decryptStringAsync(readFileSync(path))
    const parsed: unknown = JSON.parse(decrypted.result)
    if (!Array.isArray(parsed)) throw new Error('Encrypted session-cookie snapshot has an invalid format.')
    const cookies = parsed.map(parseStoredCookie).filter((cookie): cookie is StoredSessionCookie => cookie !== null)
    const store = getBrowserSession().cookies
    for (const cookie of cookies) {
      const { url, ...details } = cookie
      await store.set({ url, ...details })
    }
    if (decrypted.shouldReEncrypt) await persistSessionCookies()
  } catch (error) {
    console.error('Could not restore encrypted session cookies:', error)
  }
}

function queueSessionCookieSave(): Promise<void> {
  persistQueue = persistQueue.then(persistSessionCookies).catch((error: unknown) => {
    console.error('Could not update encrypted session cookies:', error)
  })
  return persistQueue
}

function scheduleSessionCookieSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    void queueSessionCookieSave()
  }, COOKIE_SAVE_DELAY_MS)
}

export async function initializeSessionCookiePersistence(): Promise<void> {
  await restoreSessionCookies()
  getBrowserSession().cookies.on('changed', scheduleSessionCookieSave)

  if (quitFlushInstalled) return
  quitFlushInstalled = true
  let saving = false
  let proceedToQuit = false
  app.on('before-quit', (event) => {
    if (proceedToQuit) return
    event.preventDefault()
    if (saving) return
    saving = true
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = undefined
    void queueSessionCookieSave()
      .then(() => getBrowserSession().cookies.flushStore())
      .catch((error: unknown) => console.error('Could not flush browser cookies on exit:', error))
      .finally(() => {
        proceedToQuit = true
        app.quit()
      })
  })
}
