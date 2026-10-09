import { app } from 'electron'
import { createConnection } from 'node:net'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BrowserProxySettings, BrowserProxyTestResult } from '../shared/types'
import { getBrowserSession } from './browser-session'

export const DEFAULT_PROXY_SETTINGS: BrowserProxySettings = {
  enabled: true,
  host: '127.0.0.1',
  port: 1080
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
let currentSettings: BrowserProxySettings = { ...DEFAULT_PROXY_SETTINGS }

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
    return validateSettings(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    return { ...DEFAULT_PROXY_SETTINGS }
  }
}

function persistSettings(settings: BrowserProxySettings): void {
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
}

async function configureSession(settings: BrowserProxySettings): Promise<void> {
  if (settings.enabled) {
    await getBrowserSession().setProxy({
      mode: 'fixed_servers',
      proxyRules: `socks5://${settings.host.includes(':') ? `[${settings.host}]` : settings.host}:${settings.port}`,
      proxyBypassRules: '<local>'
    })
  } else {
    await getBrowserSession().setProxy({ mode: 'direct' })
  }
  await getBrowserSession().closeAllConnections()
}

/** Called after app.whenReady and before any browser content is created. */
export async function initializeBrowserProxy(): Promise<BrowserProxySettings> {
  currentSettings = readSettings()
  await configureSession(currentSettings)
  getBrowserSession().setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  return { ...currentSettings }
}

export function getBrowserProxySettings(): BrowserProxySettings {
  return { ...currentSettings }
}

export async function setBrowserProxySettings(input: unknown): Promise<BrowserProxySettings> {
  const settings = validateSettings(input)
  await configureSession(settings)
  persistSettings(settings)
  currentSettings = settings
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
