import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { onPageSessionCreated, listPageSessions } from './browser-session'
import { SPACE_PARTITION_PREFIX } from '../shared/spaces'

const SESSION_COOKIE_FILE = 'session-cookies.enc'
const COOKIE_SAVE_DELAY_MS = 400
let quitFlushInstalled = false

/**
 * Session (non-persistent) cookies survive a restart through an encrypted snapshot, one per
 * persistent page session: the profile partition (session-cookies.enc) and each Space with
 * separate logins (session-cookies-<space id>.enc). Private sessions are never snapshotted.
 */
interface CookieTarget {
  session: Electron.Session
  file: string
  saveTimer: ReturnType<typeof setTimeout> | undefined
  queue: Promise<void>
}
const targets = new Map<string, CookieTarget>()

function cookieFileFor(partition: string): string | null {
  if (!partition.startsWith('persist:')) return null
  if (!partition.startsWith(SPACE_PARTITION_PREFIX)) return SESSION_COOKIE_FILE
  const id = partition.slice(SPACE_PARTITION_PREFIX.length)
  return /^[a-z0-9-]+$/.test(id) ? `session-cookies-${id}.enc` : null
}

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

function cookieFilePath(file: string): string {
  return join(app.getPath('userData'), file)
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

async function persistSessionCookies(target: CookieTarget): Promise<void> {
  const canEncrypt = await hasSecureStorage()
  if (!canEncrypt) return

  const cookies = await target.session.cookies.get({})
  const snapshot = cookies.map(serializableCookie).filter((cookie): cookie is StoredSessionCookie => cookie !== null)
  const path = cookieFilePath(target.file)
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

async function restoreSessionCookies(target: CookieTarget): Promise<void> {
  const path = cookieFilePath(target.file)
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
    const store = target.session.cookies
    for (const cookie of cookies) {
      const { url, ...details } = cookie
      await store.set({ url, ...details })
    }
    if (decrypted.shouldReEncrypt) await persistSessionCookies(target)
  } catch (error) {
    console.error('Could not restore encrypted session cookies:', error)
  }
}

function queueSessionCookieSave(target: CookieTarget): Promise<void> {
  target.queue = target.queue.then(() => persistSessionCookies(target)).catch((error: unknown) => {
    console.error('Could not update encrypted session cookies:', error)
  })
  return target.queue
}

function scheduleSessionCookieSave(target: CookieTarget): void {
  if (target.saveTimer) clearTimeout(target.saveTimer)
  target.saveTimer = setTimeout(() => {
    target.saveTimer = undefined
    void queueSessionCookieSave(target)
  }, COOKIE_SAVE_DELAY_MS)
}

async function attachCookieSnapshot(session: Electron.Session, partition: string): Promise<void> {
  const file = cookieFileFor(partition)
  if (!file || targets.has(partition)) return
  const target: CookieTarget = { session, file, saveTimer: undefined, queue: Promise.resolve() }
  targets.set(partition, target)
  await restoreSessionCookies(target)
  session.cookies.on('changed', () => scheduleSessionCookieSave(target))
}

/** A deleted Space: drop its snapshot file too. */
export function forgetSessionCookieSnapshot(partition: string): void {
  const file = cookieFileFor(partition)
  const target = targets.get(partition)
  if (target?.saveTimer) clearTimeout(target.saveTimer)
  targets.delete(partition)
  if (file && file !== SESSION_COOKIE_FILE) rmSync(cookieFilePath(file), { force: true })
}

/** Longest quit waits for the cookie snapshot and Chromium's cookie store flush. */
const QUIT_FLUSH_TIMEOUT_MS = 3_000

export async function initializeSessionCookiePersistence(): Promise<void> {
  await onPageSessionCreated((session, info) => info.persistent ? attachCookieSnapshot(session, info.partition) : undefined)

  if (quitFlushInstalled) return
  quitFlushInstalled = true
  let saving = false
  let proceedToQuit = false
  app.on('before-quit', (event) => {
    if (proceedToQuit) return
    event.preventDefault()
    if (saving) return
    saving = true
    const all = [...targets.values()]
    for (const target of all) {
      if (target.saveTimer) clearTimeout(target.saveTimer)
      target.saveTimer = undefined
    }
    const flush = Promise.all(all.map((target) => queueSessionCookieSave(target)))
      .then(() => Promise.all(listPageSessions().filter(({ info }) => info.persistent).map(({ session }) => session.cookies.flushStore())))
    // Bounded: a hung or restarting network service never answers flushStore(), and quit would wait
    // on it forever (Cmd+Q doing nothing). The periodic snapshot on disk is at most a moment old.
    let quitTimer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((resolve) => {
      quitTimer = setTimeout(() => {
        console.warn(`Cookie flush still running after ${QUIT_FLUSH_TIMEOUT_MS / 1000}s; quitting anyway.`)
        resolve()
      }, QUIT_FLUSH_TIMEOUT_MS)
    })
    void Promise.race([flush, deadline])
      .catch((error: unknown) => console.error('Could not flush browser cookies on exit:', error))
      .finally(() => {
        clearTimeout(quitTimer)
        proceedToQuit = true
        app.quit()
      })
  })
}
