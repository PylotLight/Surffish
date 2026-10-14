import { app, webContents as allWebContents, type WebContents } from 'electron'
import { createConnection } from 'node:net'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BrowserProxySettings, BrowserProxyTestResult } from '../shared/types'
import { DEFAULT_BROWSER_PROXY_SETTINGS, parseBrowserProxySettings } from '../shared/persistence'
import { listPageSessions, onPageSessionCreated, pageSessionInfoFor, type PageSessionInfo } from './browser-session'
import { spaceRoutingInput, type SpaceProxyChoice } from '../shared/spaces'
import { getBrowserSiteSettings } from './browser-persistence'
import { isAlwaysAllowedPermission } from '../shared/site-permissions'
import { screenShareAllowedFor } from '../shared/screen-share'
import { sendToMainWindowRenderers } from './browser-shell'
import {
  activeProxyEndpoints,
  anyProxyActive,
  buildRoutingProxyConfig,
  effectiveRouteForUrl,
  isProxyRoute,
  parseProxyRouting,
  resolutionMatches,
  routingSelfTestCases,
  siteRouteState,
  validateProxyRouting,
  withRuleForPattern,
  type EffectiveRoute,
  type ProxyRoutingInput,
  type ProxyRoutingSettings,
  type ProxyRoutingState,
  type RoutingProxyConfig,
  type SiteRouteState
} from '../shared/proxy-routing'
import { getDomain } from 'tldts-experimental'
import { readSettingsFile, writeSettingsFile } from './safety-store'

export const DEFAULT_PROXY_SETTINGS: BrowserProxySettings = DEFAULT_BROWSER_PROXY_SETTINGS

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
let currentSettings: BrowserProxySettings = { ...DEFAULT_PROXY_SETTINGS }
/** Per-site rules and extra named proxies (Settings → Network rules). */
const ROUTING_FILE = 'browser-proxy-routes.json'
let currentRouting: ProxyRoutingSettings = { proxies: [], rules: [] }
/** Set when the rules couldn't be applied and the fail-closed config is in force instead. */
let routingError: string | null = null

function siteAllowsPermission(origin: string, permission: string): boolean {
  if (isAlwaysAllowedPermission(permission)) return true
  // Screen sharing: the picker (system or ours, see screen-share.ts) is the consent, as in Chrome.
  if (permission === 'display-capture') return screenShareAllowedFor(origin)
  const settings = getBrowserSiteSettings(origin)
  if (!settings) return false
  if (permission === 'media') return settings.allowMedia
  if (permission === 'geolocation' || permission === 'geolocation-approximate') return settings.allowGeolocation
  if (permission === 'notifications') return settings.allowNotifications
  if (permission === 'clipboard-read') return settings.allowClipboardRead
  return false
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'browser-proxy.json')
}

function validateSettings(input: unknown): BrowserProxySettings {
  if (typeof input !== 'object' || input === null) throw new Error('Proxy settings must be an object.')
  const candidate = input as Partial<BrowserProxySettings>
  const host = typeof candidate.host === 'string' ? candidate.host.trim().toLowerCase() : ''
  const port = Number(candidate.port)
  if (typeof candidate.enabled !== 'boolean') throw new Error('Choose whether the SOCKS5 proxy is enabled.')
  if (!LOOPBACK_HOSTS.has(host)) throw new Error('For safety, this sample accepts only localhost SOCKS proxies.')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a port between 1 and 65535.')
  return { enabled: candidate.enabled, host, port, bypassLocalNetwork: candidate.bypassLocalNetwork !== false }
}

function readSettings(): BrowserProxySettings {
  try {
    return parseBrowserProxySettings(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    return { ...DEFAULT_PROXY_SETTINGS }
  }
}

function persistSettings(settings: BrowserProxySettings): void {
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
}

function routingInput(settings: BrowserProxySettings = currentSettings, routing: ProxyRoutingSettings = currentRouting): ProxyRoutingInput {
  return { primary: { ...settings }, proxies: routing.proxies.map((proxy) => ({ ...proxy })), rules: routing.rules.map((rule) => ({ ...rule })) }
}

/**
 * Used when a rules config can't be verified: everything through one proxy (the main one if it's
 * on, else the first proxy a rule uses). Direct rules are lost until it's fixed; nothing leaks.
 */
function failClosedConfig(input: ProxyRoutingInput): RoutingProxyConfig {
  const proxied = activeProxyEndpoints(input)[0]
  if (!proxied) return { mode: 'direct' }
  return buildRoutingProxyConfig({ primary: { enabled: true, host: proxied.host, port: proxied.port, bypassLocalNetwork: input.primary.bypassLocalNetwork }, proxies: [], rules: [] })
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then((value) => { clearTimeout(timer); resolve(value) }, (error: unknown) => { clearTimeout(timer); reject(error) })
  })
}

/** Ask Chromium how it will route a few hosts; a PAC it didn't load would answer DIRECT. */
async function verifyRouting(target: Electron.Session, input: ProxyRoutingInput): Promise<void> {
  for (const check of routingSelfTestCases(input)) {
    const actual = await withTimeout(target.resolveProxy(check.url), 5000, 'Chromium did not answer the proxy self-check in time.')
    if (!resolutionMatches(check.expected, actual)) {
      throw new Error(`Network rules self-check failed for ${new URL(check.url).hostname}: expected “${check.expected}”, Chromium said “${actual}”.`)
    }
  }
}

type ProxySettingsListener = (settings: BrowserProxySettings) => void
const proxySettingsListeners = new Set<ProxySettingsListener>()

/** Hear about the applied proxy settings (at startup and after every change). */
export function onProxySettingsChanged(listener: ProxySettingsListener): () => void {
  proxySettingsListeners.add(listener)
  return () => { proxySettingsListeners.delete(listener) }
}

function notifyProxySettings(): void {
  for (const listener of proxySettingsListeners) listener({ ...currentSettings })
  notifyRouting()
}

type ProxyRoutingListener = (input: ProxyRoutingInput) => void
const routingListeners = new Set<ProxyRoutingListener>()

/** Hear about the applied main proxy + rules together (the kill switch watches every proxy in use). */
export function onProxyRoutingChanged(listener: ProxyRoutingListener): () => void {
  routingListeners.add(listener)
  return () => { routingListeners.delete(listener) }
}

function notifyRouting(): void {
  const input = routingInput()
  for (const listener of routingListeners) listener(input)
  sendToMainWindowRenderers('browser:proxy:routing-changed', getProxyRoutingState())
}

async function applyToSession(target: Electron.Session, input: ProxyRoutingInput): Promise<void> {
  const config = buildRoutingProxyConfig(input)
  await target.setProxy(config as Electron.ProxyConfig)
  if (config.mode === 'pac_script') {
    try {
      await verifyRouting(target, input)
    } catch (error) {
      // Never leave an unverified PAC in place: switch to the leak-free config before reporting.
      await target.setProxy(failClosedConfig(input) as Electron.ProxyConfig)
      await target.closeAllConnections()
      throw error
    }
  }
  await target.closeAllConnections()
}

// ---------------------------------------------------------------------------
// Per-Space routing: a Space with its own partition can force its default route (spaces.ts has
// the precedence). The spaces module tells us which choice a partition has.

type PartitionRouteResolver = (partition: string) => SpaceProxyChoice
let partitionRouteResolver: PartitionRouteResolver = () => 'inherit'

export function setPartitionRouteResolver(resolver: PartitionRouteResolver | null): void {
  partitionRouteResolver = resolver ?? (() => 'inherit')
}

function choiceFor(info: PageSessionInfo | null): SpaceProxyChoice {
  // The profile and private sessions always follow Settings.
  if (!info || info.isDefault || info.isPrivate) return 'inherit'
  try {
    return partitionRouteResolver(info.partition)
  } catch {
    return 'inherit'
  }
}

/** The routing a page session uses for `input` (Settings), with its Space's forced route layered on. */
function inputForSession(info: PageSessionInfo | null, input: ProxyRoutingInput): ProxyRoutingInput {
  return spaceRoutingInput(input, choiceFor(info))
}

/** Every distinct routing in force (Settings + each Space override); the kill switch watches them all. */
export function getAllRoutingInputs(): ProxyRoutingInput[] {
  const base = routingInput()
  const inputs = [base]
  for (const { info } of listPageSessions()) {
    if (choiceFor(info) !== 'inherit') inputs.push(inputForSession(info, base))
  }
  return inputs
}

/** The routing for requests from one page (by its WebContents' session). */
export function routingInputForSession(target: Electron.Session | null | undefined): ProxyRoutingInput {
  return inputForSession(pageSessionInfoFor(target), routingInput())
}

/** A Space's proxy choice changed: re-apply that partition (fail closed on error). */
export async function reapplyPartitionRouting(partition: string): Promise<void> {
  const entry = listPageSessions().find(({ info }) => info.partition === partition)
  if (entry) {
    await configureSessionFailClosed(entry.session, inputForSession(entry.info, routingInput()))
    applyWebRTCPolicyToAll(routingInput())
  }
  notifyRouting()
}

async function configureSession(input: ProxyRoutingInput): Promise<void> {
  // Every page session (private tabs and Spaces too) must never bypass the user's proxy.
  for (const { session: target, info } of listPageSessions()) await applyToSession(target, inputForSession(info, input))
}

/** Apply at startup / for a new session; a rules config that fails its self-check falls back closed. */
async function configureSessionFailClosed(target: Electron.Session, input: ProxyRoutingInput): Promise<void> {
  try {
    await applyToSession(target, input)
  } catch (error) {
    routingError = error instanceof Error ? error.message : String(error)
    console.error('[proxy] network rules could not be applied; using the fail-closed config:', error)
  }
}

/**
 * WebRTC talks UDP straight to peers/STUN servers and would reveal the real IP even with the SOCKS5
 * proxy on. While the proxy is enabled, only let it use proxied paths ('disable_non_proxied_udp');
 * restore the default when it is off. Applied to every WebContents (tabs, extension pages, popups);
 * the local shell surfaces never use WebRTC, so the policy is harmless there.
 */
function webRTCPolicy(input: ProxyRoutingInput): 'default' | 'disable_non_proxied_udp' {
  // Any proxied route at all (main proxy on, a rule sending some site through a proxy, or a Space forced through one).
  const spaceProxied = getAllRoutingInputs().slice(1).some(anyProxyActive)
  return anyProxyActive(input) || spaceProxied ? 'disable_non_proxied_udp' : 'default'
}

function applyWebRTCPolicy(contents: WebContents, input: ProxyRoutingInput = routingInput()): void {
  if (contents.isDestroyed()) return
  try {
    contents.setWebRTCIPHandlingPolicy(webRTCPolicy(input))
  } catch (error) {
    console.warn('Could not apply the WebRTC IP handling policy:', error)
  }
}

function applyWebRTCPolicyToAll(input: ProxyRoutingInput): void {
  for (const contents of allWebContents.getAllWebContents()) applyWebRTCPolicy(contents, input)
}

let webRTCHookInstalled = false
function installWebRTCPolicyHook(): void {
  if (webRTCHookInstalled) return
  webRTCHookInstalled = true
  // Runs before the new page loads anything, so a fresh tab never gets a window without the policy.
  app.on('web-contents-created', (_event, contents) => applyWebRTCPolicy(contents))
}

function applyPermissionPolicy(target: Electron.Session): void {
  target.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => siteAllowsPermission(requestingOrigin, permission))
  target.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL()
    const allowed = siteAllowsPermission(requestingUrl, permission)
    callback(allowed)
    if (!allowed) for (const listener of permissionDeniedListeners) listener(webContents, permission, requestingUrl)
  })
}

type PermissionDeniedListener = (contents: WebContents, permission: string, requestingUrl: string) => void
const permissionDeniedListeners = new Set<PermissionDeniedListener>()

/** Hear about permission requests the site policy turned down (not silent permission checks). */
export function onPermissionDenied(listener: PermissionDeniedListener): () => void {
  permissionDeniedListeners.add(listener)
  return () => { permissionDeniedListeners.delete(listener) }
}

/** Called after app.whenReady and before any browser content is created. */
export async function initializeBrowserProxy(): Promise<BrowserProxySettings> {
  currentSettings = readSettings()
  currentRouting = parseProxyRouting(readSettingsFile(ROUTING_FILE))
  installWebRTCPolicyHook()
  applyWebRTCPolicyToAll(routingInput())
  await onPageSessionCreated((target, info) => {
    applyPermissionPolicy(target)
    // Private and Space pages wait on this (whenPageSessionReady) before their first load.
    const forced = choiceFor(info) !== 'inherit'
    if (forced) applyWebRTCPolicyToAll(routingInput())
    // A Space forced through a proxy adds that proxy to what the kill switch watches.
    return configureSessionFailClosed(target, inputForSession(info, routingInput())).then(() => { if (forced) notifyRouting() })
  })
  return { ...currentSettings }
}

export function getBrowserProxySettings(): BrowserProxySettings {
  return { ...currentSettings }
}

export async function setBrowserProxySettings(input: unknown): Promise<BrowserProxySettings> {
  const settings = validateSettings(input)
  await applyRouting(routingInput(settings, currentRouting))
  persistSettings(settings)
  currentSettings = settings
  applyWebRTCPolicyToAll(routingInput())
  notifyProxySettings()
  return { ...currentSettings }
}

/** Apply a new main proxy / rules combination; on failure put the previous one back and rethrow. */
async function applyRouting(next: ProxyRoutingInput): Promise<void> {
  // Tighten WebRTC before any proxy switches on (and only relax it once it's really off).
  if (anyProxyActive(next)) applyWebRTCPolicyToAll(next)
  try {
    await configureSession(next)
    routingError = null
  } catch (error) {
    const previous = routingInput()
    try {
      await configureSession(previous)
    } catch (restoreError) {
      // applyToSession already left the fail-closed config in place.
      routingError = restoreError instanceof Error ? restoreError.message : String(restoreError)
    }
    applyWebRTCPolicyToAll(previous)
    throw error
  }
}

export function getProxyRoutingState(): ProxyRoutingState {
  return { ...routingInput(), error: routingError }
}

export function getProxyRoutingInput(): ProxyRoutingInput {
  return routingInput()
}

export async function setProxyRouting(input: unknown): Promise<ProxyRoutingState> {
  const routing = validateProxyRouting(input)
  await applyRouting(routingInput(currentSettings, routing))
  writeSettingsFile(ROUTING_FILE, routing)
  currentRouting = routing
  applyWebRTCPolicyToAll(routingInput())
  notifyRouting()
  return getProxyRoutingState()
}

/** Where a URL's requests go right now (site panel). Null for non-web URLs. */
export function getEffectiveRoute(url: string, target?: Electron.Session): EffectiveRoute | null {
  return effectiveRouteForUrl(url, target ? routingInputForSession(target) : routingInput())
}

export function testLocalProxy(input: unknown): Promise<BrowserProxyTestResult> {
  let settings: BrowserProxySettings
  try {
    settings = validateSettings(input)
  } catch (error) {
    return Promise.resolve({ reachable: false, message: error instanceof Error ? error.message : String(error) })
  }

  return new Promise((resolve) => {
    const socket = createConnection({ host: settings.host, port: settings.port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve({ reachable: false, message: 'No response from the local proxy before the 4-second timeout.' })
    }, 4000)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve({ reachable: true, message: `A SOCKS endpoint is listening at ${settings.host}:${settings.port}.` })
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      resolve({ reachable: false, message: `${error.code ?? 'Connection error'}: ${error.message}` })
    })
  })
}

function registrableDomain(host: string): string | null {
  return getDomain(host, { allowPrivateDomains: true }) ?? null
}

/** Site panel: the "Route this site" choice and the effective route for a page URL. */
export function getSiteRoute(url: string, target?: Electron.Session): SiteRouteState | null {
  return siteRouteState(url, target ? routingInputForSession(target) : routingInput(), registrableDomain)
}

/** Site panel quick toggle: Default removes this site's rule; anything else sets it. */
export async function setSiteRoute(url: unknown, choice: unknown): Promise<SiteRouteState | null> {
  if (typeof url !== 'string') throw new Error('Open a web page to route it.')
  const state = getSiteRoute(url)
  if (!state) throw new Error('Only web pages (not local addresses) can have a route.')
  if (choice !== 'default' && !isProxyRoute(choice)) throw new Error('Choose Default, Direct or a proxy.')
  await setProxyRouting(withRuleForPattern(currentRouting, state.pattern, choice === 'default' ? null : choice))
  return getSiteRoute(url)
}
