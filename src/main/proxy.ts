import { app, webContents as allWebContents, type WebContents } from 'electron'
import { createConnection } from 'node:net'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BrowserProxySettings, BrowserProxyTestResult } from '../shared/types'
import { DEFAULT_BROWSER_PROXY_SETTINGS, parseBrowserProxySettings } from '../shared/persistence'
import { getBrowserSession, getPrivateSession, hasPrivateSession, onPrivateSessionCreated } from './browser-session'
import { getBrowserSiteSettings } from './browser-persistence'
import { isAlwaysAllowedPermission } from '../shared/site-permissions'
import { buildProxyConfig } from '../shared/proxy-guard'

export const DEFAULT_PROXY_SETTINGS: BrowserProxySettings = DEFAULT_BROWSER_PROXY_SETTINGS

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
let currentSettings: BrowserProxySettings = { ...DEFAULT_PROXY_SETTINGS }

function siteAllowsPermission(origin: string, permission: string): boolean {
  if (isAlwaysAllowedPermission(permission)) return true
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
  return { enabled: candidate.enabled, host, port }
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

function proxyConfig(settings: BrowserProxySettings): Electron.ProxyConfig {
  // One socks5:// server and no DIRECT entry: Chromium never falls back to a direct connection.
  return buildProxyConfig(settings)
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
}

async function applyToSession(target: Electron.Session, settings: BrowserProxySettings): Promise<void> {
  await target.setProxy(proxyConfig(settings))
  await target.closeAllConnections()
}

async function configureSession(settings: BrowserProxySettings): Promise<void> {
  await applyToSession(getBrowserSession(), settings)
  // Private tabs must never bypass the user's proxy.
  if (hasPrivateSession()) await applyToSession(getPrivateSession(), settings)
}

/**
 * WebRTC talks UDP straight to peers/STUN servers and would reveal the real IP even with the SOCKS5
 * proxy on. While the proxy is enabled, only let it use proxied paths ('disable_non_proxied_udp');
 * restore the default when it is off. Applied to every WebContents (tabs, extension pages, popups);
 * the local shell surfaces never use WebRTC, so the policy is harmless there.
 */
function webRTCPolicy(settings: BrowserProxySettings): 'default' | 'disable_non_proxied_udp' {
  return settings.enabled ? 'disable_non_proxied_udp' : 'default'
}

function applyWebRTCPolicy(contents: WebContents, settings: BrowserProxySettings = currentSettings): void {
  if (contents.isDestroyed()) return
  try {
    contents.setWebRTCIPHandlingPolicy(webRTCPolicy(settings))
  } catch (error) {
    console.warn('Could not apply the WebRTC IP handling policy:', error)
  }
}

function applyWebRTCPolicyToAll(settings: BrowserProxySettings): void {
  for (const contents of allWebContents.getAllWebContents()) applyWebRTCPolicy(contents, settings)
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
  installWebRTCPolicyHook()
  applyWebRTCPolicyToAll(currentSettings)
  await configureSession(currentSettings)
  applyPermissionPolicy(getBrowserSession())
  onPrivateSessionCreated((privateSession) => {
    applyPermissionPolicy(privateSession)
    // Private tabs wait on this (whenPrivateSessionReady) before their first load.
    return applyToSession(privateSession, currentSettings)
  })
  return { ...currentSettings }
}

export function getBrowserProxySettings(): BrowserProxySettings {
  return { ...currentSettings }
}

export async function setBrowserProxySettings(input: unknown): Promise<BrowserProxySettings> {
  const settings = validateSettings(input)
  // Tighten WebRTC before the proxy switches on (and only relax it once the proxy is really off).
  if (settings.enabled) applyWebRTCPolicyToAll(settings)
  await configureSession(settings)
  persistSettings(settings)
  currentSettings = settings
  applyWebRTCPolicyToAll(settings)
  notifyProxySettings()
  return { ...currentSettings }
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
