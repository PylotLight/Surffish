import { session } from 'electron'
import { chromeUserAgent } from './adblock-policy.ts'

export const BROWSER_SESSION_PARTITION = 'persist:surffish-browser'
/** No `persist:` prefix: Chromium keeps this partition's cookies, cache and storage in memory only. */
export const PRIVATE_SESSION_PARTITION = 'surffish-private'

let userAgentApplied = false
let privateSession: Electron.Session | null = null
type PrivateSessionSetup = (privateSession: Electron.Session) => void | Promise<void>
const privateSessionSetups: PrivateSessionSetup[] = []
let privateSessionReady: Promise<void> = Promise.resolve()

export function getBrowserSession(): Electron.Session {
  // The named persistent partition stores cookies and site storage in the app's
  // user-data profile and reuses it across development and packaged launches.
  const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION)
  if (!userAgentApplied) {
    userAgentApplied = true
    // YouTube and Google serve different player/ad code paths to unknown
    // clients; uBO's YouTube fixes target real Chrome, so look like Chrome.
    browserSession.setUserAgent(chromeUserAgent(browserSession.getUserAgent()))
  }
  return browserSession
}

/**
 * Register setup that every session pages load in needs (proxy, permissions, ad blocking,
 * downloads). Runs now for the private session if it already exists, otherwise on first use.
 */
export function onPrivateSessionCreated(setup: PrivateSessionSetup): void {
  privateSessionSetups.push(setup)
  if (privateSession) privateSessionReady = Promise.all([privateSessionReady, setup(privateSession)]).then(() => undefined)
}

/** Resolves once async setup (notably the SOCKS proxy) is applied; private pages must not load before it. */
export function whenPrivateSessionReady(): Promise<void> {
  return privateSessionReady
}

/** In-memory session for private tabs: no profile cookies, history, extensions or saved state. */
export function getPrivateSession(): Electron.Session {
  if (privateSession) return privateSession
  privateSession = session.fromPartition(PRIVATE_SESSION_PARTITION, { cache: false })
  privateSession.setUserAgent(getBrowserSession().getUserAgent())
  privateSession.setSpellCheckerEnabled(false)
  const created = privateSession
  // A failed setup (e.g. the proxy) rejects this, and private pages then refuse to load rather than go direct.
  privateSessionReady = Promise.all(privateSessionSetups.map((setup) => Promise.resolve().then(() => setup(created)))).then(() => undefined)
  privateSessionReady.catch((error: unknown) => console.error('Private session setup failed:', error))
  return privateSession
}

export function hasPrivateSession(): boolean {
  return privateSession !== null
}

/** Last private tab closed: wipe everything the in-memory session picked up so the next one starts clean. */
export async function clearPrivateSession(): Promise<void> {
  if (!privateSession) return
  await privateSession.clearStorageData().catch(() => undefined)
  await privateSession.clearCache().catch(() => undefined)
  await privateSession.clearAuthCache().catch(() => undefined)
  await privateSession.clearHostResolverCache().catch(() => undefined)
  privateSession.closeAllConnections().catch(() => undefined)
}
