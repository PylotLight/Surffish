import { createConnection } from 'node:net'
import type { BrowserProxySettings } from '../shared/types'
import {
  INITIAL_PROXY_HEALTH,
  isKillSwitchExemptUrl,
  isProxyConnectionError,
  nextProxyHealth,
  probeIntervalFor,
  PROBE_TIMEOUT_MS,
  proxyHealthBlocksTraffic,
  type ProxyGuardStatus,
  type ProxyHealth,
  type ProxyHealthEvent
} from '../shared/proxy-guard'
import { addRequestGate, onRequestError } from './request-gate'
import { readSettingsFile, writeSettingsFile } from './safety-store'
import { getBrowserProxySettings, onProxySettingsChanged } from './proxy'
import { sendToMainWindowRenderers } from './browser-shell'
import { setUpdateNetworkGuard } from './updates'

/**
 * Proxy kill switch. With the SOCKS5 proxy on and the switch enabled, a lightweight TCP probe
 * watches the proxy's host:port (sooner after a proxy connection error). While it is down every
 * off-machine page request is cancelled, so nothing can go out another way, and the toolbar
 * shows "Proxy down – traffic blocked". Traffic resumes on the first good probe.
 */
const FILE = 'browser-proxy-guard.json'
let killSwitch = false
let proxy: BrowserProxySettings = getBrowserProxySettings()
let health: ProxyHealth = { ...INITIAL_PROXY_HEALTH }
let timer: ReturnType<typeof setTimeout> | null = null
let probing = false
let probeQueued = false
const statusListeners = new Set<(status: ProxyGuardStatus) => void>()

function armed(): boolean {
  return killSwitch && proxy.enabled
}

export function getProxyGuardStatus(): ProxyGuardStatus {
  return {
    killSwitch,
    armed: armed(),
    state: health.state,
    blocking: proxyHealthBlocksTraffic(health),
    endpoint: proxy.enabled ? `${proxy.host}:${proxy.port}` : null
  }
}

/** Hear when traffic starts or stops being blocked (and other status changes). */
export function onProxyGuardStatus(listener: (status: ProxyGuardStatus) => void): () => void {
  statusListeners.add(listener)
  return () => { statusListeners.delete(listener) }
}

function publish(): void {
  const status = getProxyGuardStatus()
  sendToMainWindowRenderers('browser:proxy-guard:changed', status)
  for (const listener of statusListeners) listener(status)
}

function dispatch(event: ProxyHealthEvent): void {
  const before = health
  const step = nextProxyHealth(health, event)
  health = step.health
  if (before.state !== health.state) {
    if (health.state === 'down') console.warn(`[kill switch] proxy ${proxy.host}:${proxy.port} unreachable; blocking page traffic`)
    else if (before.state === 'down') console.info('[kill switch] proxy reachable again; traffic resumed')
    publish()
  }
  if (step.probeNow) runProbe()
  else schedule()
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (!armed()) return
  timer = setTimeout(runProbe, probeIntervalFor(health))
  timer.unref?.()
}

function probe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    const done = (ok: boolean): void => {
      clearTimeout(timeout)
      socket.destroy()
      resolve(ok)
    }
    const timeout = setTimeout(() => done(false), PROBE_TIMEOUT_MS)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

function runProbe(): void {
  if (!armed()) return
  if (probing) {
    probeQueued = true
    return
  }
  probing = true
  if (timer) clearTimeout(timer)
  timer = null
  const target = { host: proxy.host, port: proxy.port }
  void probe(target.host, target.port).then((ok) => {
    probing = false
    // Settings changed mid-probe: the result is about the old endpoint.
    if (!armed() || target.host !== proxy.host || target.port !== proxy.port) {
      if (armed()) runProbe()
      return
    }
    dispatch({ type: 'probe', ok })
    if (probeQueued) {
      probeQueued = false
      if (health.state !== 'down') runProbe()
    }
  })
}

function rearm(): void {
  if (armed()) dispatch(health.state === 'off' ? { type: 'arm' } : { type: 'proxy-error' })
  else {
    if (timer) clearTimeout(timer)
    timer = null
    const wasOff = health.state === 'off'
    health = nextProxyHealth(health, { type: 'disarm' }).health
    if (!wasOff) publish()
  }
}

export function initializeProxyKillSwitch(): void {
  const saved = readSettingsFile(FILE) as { killSwitch?: unknown } | null
  killSwitch = saved?.killSwitch === true
  proxy = getBrowserProxySettings()
  addRequestGate((details) => proxyHealthBlocksTraffic(health) && !isKillSwitchExemptUrl(details.url) ? { cancel: true } : null)
  onRequestError((details) => {
    if (armed() && isProxyConnectionError(details.error)) dispatch({ type: 'proxy-error' })
  })
  onProxySettingsChanged((settings) => {
    const endpointChanged = settings.host !== proxy.host || settings.port !== proxy.port || settings.enabled !== proxy.enabled
    proxy = settings
    if (!endpointChanged) return
    // New endpoint: start over so an old "down" doesn't linger (or an old "up" doesn't hide a dead one).
    health = nextProxyHealth(health, { type: 'disarm' }).health
    rearm()
    publish()
  })
  setUpdateNetworkGuard(() => proxyHealthBlocksTraffic(health) ? 'The proxy kill switch is blocking traffic (proxy unreachable).' : null)
  rearm()
}

export function setProxyKillSwitch(enabled: unknown): ProxyGuardStatus {
  if (typeof enabled !== 'boolean') return getProxyGuardStatus()
  killSwitch = enabled
  writeSettingsFile(FILE, { killSwitch })
  rearm()
  publish()
  return getProxyGuardStatus()
}

/** Probe now (the banner's Retry button). */
export function checkProxyNow(): ProxyGuardStatus {
  if (armed()) runProbe()
  return getProxyGuardStatus()
}
