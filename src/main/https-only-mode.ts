import { webContents as allWebContents, type WebContents } from 'electron'
import { httpsUpgradeTarget, isHttpsUpgradeFailure, normalizeHttpsExceptions } from '../shared/https-only'
import { addRequestGate, onRequestError } from './request-gate'
import { readUserJson, writeSettingsFile } from './user-json'
import { getTabInterstitial, setTabInterstitial } from './tab-interstitials'
import { urlHostname } from '../shared/url-host'

/**
 * HTTPS-only mode (off by default). Top-level http:// navigations are redirected to https://
 * before they leave the browser; if the https version fails (certificate or connection error)
 * the tab shows "This site doesn't support HTTPS" with Continue to HTTP, which adds a
 * per-host exception. Local and private hosts are never upgraded.
 */
export interface HttpsOnlyState {
  enabled: boolean
  exceptions: string[]
}

const FILE = 'browser-https-only.json'
const UPGRADE_MEMORY_MS = 2 * 60 * 1000
let state: HttpsOnlyState = { enabled: false, exceptions: [] }
let exceptionSet = new Set<string>()

interface PendingUpgrade {
  httpUrl: string
  httpsUrl: string
  host: string
  at: number
  source: 'https-only' | 'typed'
}
/** Upgrades in flight per WebContents id, so a failure can offer the original http:// URL. */
const upgrades = new Map<number, PendingUpgrade>()

function setState(next: HttpsOnlyState, persist: boolean): void {
  state = { enabled: next.enabled, exceptions: normalizeHttpsExceptions(next.exceptions) }
  exceptionSet = new Set(state.exceptions)
  if (persist) writeSettingsFile(FILE, state)
}

const watched = new Set<number>()
/** A committed page ends the upgrade attempt, so the next visit isn't mistaken for a redirect loop. */
function watchCommits(contentsId: number): void {
  if (watched.has(contentsId)) return
  const contents = allWebContents.fromId(contentsId)
  if (!contents) return
  watched.add(contentsId)
  contents.on('did-navigate', () => { upgrades.delete(contentsId) })
  contents.once('destroyed', () => {
    watched.delete(contentsId)
    upgrades.delete(contentsId)
  })
}

export function initializeHttpsOnly(): void {
  const saved = readUserJson(FILE) as Partial<HttpsOnlyState> | null
  setState({ enabled: saved?.enabled === true, exceptions: Array.isArray(saved?.exceptions) ? saved.exceptions : [] }, false)

  addRequestGate((details) => {
    if (!state.enabled || details.resourceType !== 'mainFrame' || typeof details.webContentsId !== 'number') return null
    const target = httpsUpgradeTarget(details.url, exceptionSet)
    if (!target) return null
    const previous = upgrades.get(details.webContentsId)
    // The https page sent us straight back to http: that's a redirect loop, not a site with HTTPS.
    if (previous && previous.httpUrl === details.url && Date.now() - previous.at < 3000 && previous.httpsUrl === target) {
      const contents = allWebContents.fromId(details.webContentsId)
      if (contents) showHttpsUnavailable(contents, previous, 'net::ERR_TOO_MANY_REDIRECTS')
      return { cancel: true }
    }
    upgrades.set(details.webContentsId, { httpUrl: details.url, httpsUrl: target, host: urlHostname(details.url), at: Date.now(), source: 'https-only' })
    watchCommits(details.webContentsId)
    return { redirectURL: target }
  })

  onRequestError((details) => {
    if (details.resourceType !== 'mainFrame' || typeof details.webContentsId !== 'number') return
    const upgrade = upgrades.get(details.webContentsId)
    if (!upgrade || Date.now() - upgrade.at > UPGRADE_MEMORY_MS) return
    if (urlHostname(details.url) !== upgrade.host || !details.url.startsWith('https:')) return
    if (!isHttpsUpgradeFailure(details.error)) return
    const contents = allWebContents.fromId(details.webContentsId)
    if (contents) showHttpsUnavailable(contents, upgrade, details.error)
  })
}

/**
 * The address bar resolved a typed bare host ("example.com") to https:// (Chrome's HTTPS-Upgrades
 * for typed navigations). If that secure load fails with a TLS, certificate or connection error,
 * the tab offers Continue to HTTP, exactly like an HTTPS-only upgrade. Local hosts never get here:
 * the address bar sends them straight to http://.
 */
export function noteTypedHttpsUpgrade(contents: WebContents, httpsUrl: string, httpUrl: string): void {
  if (contents.isDestroyed()) return
  upgrades.set(contents.id, { httpUrl, httpsUrl, host: urlHostname(httpsUrl), at: Date.now(), source: 'typed' })
  watchCommits(contents.id)
}

function showHttpsUnavailable(contents: WebContents, upgrade: PendingUpgrade, error: string): void {
  upgrades.delete(contents.id)
  setTabInterstitial(contents, { kind: 'https-unavailable', url: upgrade.httpUrl, host: upgrade.host, error: error.replace(/^net::/, ''), source: upgrade.source, remember: state.enabled })
  // Leave the notice once the user goes somewhere else.
  const clear = (_event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean): void => {
    if (!isMainFrame || isInPlace) return
    if (urlHostname(url) === upgrade.host && url.startsWith('https:')) return
    contents.removeListener('did-start-navigation', clear)
    if (getTabInterstitial(contents)?.kind === 'https-unavailable') setTabInterstitial(contents, null)
  }
  contents.on('did-start-navigation', clear)
}

export function getHttpsOnlyState(): HttpsOnlyState {
  return { enabled: state.enabled, exceptions: [...state.exceptions] }
}

export function setHttpsOnlyEnabled(enabled: unknown): HttpsOnlyState {
  if (typeof enabled !== 'boolean') return getHttpsOnlyState()
  setState({ ...state, enabled }, true)
  return getHttpsOnlyState()
}

export function removeHttpsOnlyException(host: unknown): HttpsOnlyState {
  if (typeof host !== 'string') return getHttpsOnlyState()
  setState({ ...state, exceptions: state.exceptions.filter((entry) => entry !== host.trim().toLowerCase()) }, true)
  return getHttpsOnlyState()
}

/** Continue to HTTP: remember the exception for this host and load the http:// page. */
export function continueToHttp(contents: WebContents): boolean {
  const shown = getTabInterstitial(contents)
  if (shown?.kind !== 'https-unavailable') return false
  // Typed-host fallbacks only remember the host when HTTPS-only mode would upgrade it again.
  if (state.enabled) setState({ ...state, exceptions: [...state.exceptions, shown.host] }, true)
  setTabInterstitial(contents, null)
  void contents.loadURL(shown.url).catch(() => undefined)
  return true
}
