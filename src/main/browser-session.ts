import { session } from 'electron'
import { chromeUserAgent } from './adblock-policy.ts'

export const BROWSER_SESSION_PARTITION = 'persist:surffish-browser'
/** No `persist:` prefix: Chromium keeps this partition's cookies, cache and storage in memory only. */
export const PRIVATE_SESSION_PARTITION = 'surffish-private'

/**
 * Page sessions: every session web pages load in, keyed by partition. The profile partition
 * (`persist:surffish-browser`), the in-memory private partition, and one persistent partition per
 * Space with separate logins (`persist:surffish-space-<id>`, see shared/spaces.ts).
 *
 * Feature modules register their per-session setup once with onPageSessionCreated (ad blocking,
 * permission handler, proxy, request gates / webRequest hooks, downloads, spellcheck, cookie
 * snapshot); it runs for every page session that exists and every one created later, so a new
 * partition gets exactly what the profile session has. Pages in a non-profile session must wait
 * for whenPageSessionReady (the proxy is applied asynchronously and nothing may go out direct).
 * Extensions and the Google WebKit sign-in hand-off stay on the profile session.
 */
export interface PageSessionInfo {
  partition: string
  /** The profile partition (`persist:surffish-browser`). */
  isDefault: boolean
  /** The in-memory private partition. */
  isPrivate: boolean
  /** Persistent (on-disk) partition: the profile one or a Space's. */
  persistent: boolean
}

type PageSessionSetup = (target: Electron.Session, info: PageSessionInfo) => void | Promise<void>

interface PageSessionEntry {
  session: Electron.Session
  info: PageSessionInfo
  ready: Promise<void>
}

const setups: PageSessionSetup[] = []
const pageSessions = new Map<string, PageSessionEntry>()
const createdListeners = new Set<(info: PageSessionInfo) => void>()

function infoFor(partition: string): PageSessionInfo {
  return {
    partition,
    isDefault: partition === BROWSER_SESSION_PARTITION,
    isPrivate: partition === PRIVATE_SESSION_PARTITION,
    persistent: partition.startsWith('persist:')
  }
}

function runSetup(entry: PageSessionEntry, setup: PageSessionSetup): Promise<void> {
  return Promise.resolve().then(() => setup(entry.session, entry.info))
}

/**
 * The session for a page partition, created and set up on first use. Only the profile, private
 * and `persist:surffish-space-*` partitions are page sessions (reader/PDF editor keep their own).
 */
export function getPageSession(partition: string = BROWSER_SESSION_PARTITION): Electron.Session {
  const existing = pageSessions.get(partition)
  if (existing) return existing.session
  const info = infoFor(partition)
  const created = info.isPrivate ? session.fromPartition(partition, { cache: false }) : session.fromPartition(partition)
  // YouTube and Google serve different player/ad code paths to unknown clients; uBO's YouTube
  // fixes target real Chrome, so look like Chrome (every page session the same). It must equal
  // app.userAgentFallback (set in index.ts), which workers use: bot checks compare the two.
  const base = info.isDefault ? created.getUserAgent() : getPageSession(BROWSER_SESSION_PARTITION).getUserAgent()
  created.setUserAgent(info.isDefault ? chromeUserAgent(base) : base)
  if (info.isPrivate) created.setSpellCheckerEnabled(false)
  const entry: PageSessionEntry = { session: created, info, ready: Promise.resolve() }
  pageSessions.set(partition, entry)
  if (!info.isDefault) {
    // A failed setup (e.g. the proxy) rejects this, and pages there then refuse to load rather than go direct.
    entry.ready = Promise.all(setups.map((setup) => runSetup(entry, setup))).then(() => undefined)
    entry.ready.catch((error: unknown) => console.error(`Page session setup failed (${partition}):`, error))
  } else {
    // The profile session exists from the first getBrowserSession() call, before modules register;
    // they configure it as they register (same order as before the refactor).
    for (const setup of setups) entry.ready = Promise.all([entry.ready, runSetup(entry, setup)]).then(() => undefined)
  }
  for (const listener of createdListeners) listener(info)
  return created
}

/**
 * Register setup every page session needs. Runs now for each existing page session (the profile
 * session is created first if needed) and later for every new one. The returned promise settles
 * when it has run on the sessions that exist now.
 */
export function onPageSessionCreated(setup: PageSessionSetup): Promise<void> {
  getPageSession(BROWSER_SESSION_PARTITION)
  setups.push(setup)
  const runs: Promise<void>[] = []
  for (const entry of pageSessions.values()) {
    const run = runSetup(entry, setup)
    entry.ready = Promise.all([entry.ready, run]).then(() => undefined)
    entry.ready.catch(() => undefined)
    runs.push(run)
  }
  return Promise.all(runs).then(() => undefined)
}

/** Hear when a page session is created (diagnostics, etc). */
export function onPageSessionAdded(listener: (info: PageSessionInfo) => void): () => void {
  createdListeners.add(listener)
  return () => { createdListeners.delete(listener) }
}

/** Resolves once async setup (notably the proxy) is applied; pages in that session must not load before it. */
export function whenPageSessionReady(partition: string): Promise<void> {
  return pageSessions.get(partition)?.ready ?? Promise.resolve()
}

export function hasPageSession(partition: string): boolean {
  return pageSessions.has(partition)
}

/** Every page session created so far, with its info. */
export function listPageSessions(): { session: Electron.Session; info: PageSessionInfo }[] {
  return [...pageSessions.values()].map((entry) => ({ session: entry.session, info: entry.info }))
}

/** The page session info for a session object (null for reader/PDF/shell sessions). */
export function pageSessionInfoFor(target: Electron.Session | null | undefined): PageSessionInfo | null {
  if (!target) return null
  for (const entry of pageSessions.values()) if (entry.session === target) return entry.info
  return null
}

/** Profile session: cookies and site storage in the user-data profile (unchanged since before Spaces). */
export function getBrowserSession(): Electron.Session {
  return getPageSession(BROWSER_SESSION_PARTITION)
}

export function whenPrivateSessionReady(): Promise<void> {
  return whenPageSessionReady(PRIVATE_SESSION_PARTITION)
}

/** In-memory session for private tabs: no profile cookies, history, extensions or saved state. */
export function getPrivateSession(): Electron.Session {
  return getPageSession(PRIVATE_SESSION_PARTITION)
}

export function hasPrivateSession(): boolean {
  return pageSessions.has(PRIVATE_SESSION_PARTITION)
}

/** Last private tab closed: wipe everything the in-memory session picked up so the next one starts clean. */
export async function clearPrivateSession(): Promise<void> {
  const privateSession = pageSessions.get(PRIVATE_SESSION_PARTITION)?.session
  if (!privateSession) return
  await privateSession.clearStorageData().catch(() => undefined)
  await privateSession.clearCache().catch(() => undefined)
  await privateSession.clearAuthCache().catch(() => undefined)
  await privateSession.clearHostResolverCache().catch(() => undefined)
  privateSession.closeAllConnections().catch(() => undefined)
}

/** A Space was deleted: wipe its partition's cookies, storage and cache (the directory stays, empty). */
export async function clearPageSessionData(partition: string): Promise<void> {
  if (partition === BROWSER_SESSION_PARTITION || partition === PRIVATE_SESSION_PARTITION) return
  const target = getPageSession(partition)
  await target.clearStorageData().catch(() => undefined)
  await target.clearCache().catch(() => undefined)
  await target.clearAuthCache().catch(() => undefined)
  target.closeAllConnections().catch(() => undefined)
}
