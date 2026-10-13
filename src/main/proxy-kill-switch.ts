import { createConnection } from 'node:net'
import { webContents as allWebContents } from 'electron'
import {
  aggregateProxyHealthState,
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
import { activeProxyEndpoints, effectiveRouteForUrl, endpointKey, type ActiveProxyEndpoint, type ProxyRoutingInput } from '../shared/proxy-routing'
import { addRequestGate, onRequestError } from './request-gate'
import { readSettingsFile, writeSettingsFile } from './safety-store'
import { getAllRoutingInputs, getProxyRoutingInput, onProxyRoutingChanged, routingInputForSession } from './proxy'
import { sendToMainWindowRenderers } from './browser-shell'
import { setUpdateNetworkGuard } from './updates'
import { setBackgroundNetworkGuard } from './background-network'

/**
 * Proxy kill switch. With the switch on, a lightweight TCP probe watches every SOCKS5 proxy in
 * use: the main one and any proxy a per-site rule routes through (sooner after a proxy connection
 * error). While one is down, every off-machine request whose route goes through it is cancelled,
 * so nothing can go out another way; sites with an explicit Direct rule keep working. The toolbar
 * shows "Proxy down – traffic blocked". Traffic resumes on the first good probe.
 */
const FILE = 'browser-proxy-guard.json'
const UPDATE_FEED_URL = 'https://github.com/'

interface Watched {
  endpoint: ActiveProxyEndpoint
  health: ProxyHealth
  timer: ReturnType<typeof setTimeout> | null
  probing: boolean
  probeQueued: boolean
}

let killSwitch = false
let routing: ProxyRoutingInput = getProxyRoutingInput()
const watched = new Map<string, Watched>()
const statusListeners = new Set<(status: ProxyGuardStatus) => void>()

function armed(): boolean {
  return killSwitch && watched.size > 0
}

function anyBlocking(): boolean {
  for (const entry of watched.values()) if (proxyHealthBlocksTraffic(entry.health)) return true
  return false
}

export function getProxyGuardStatus(): ProxyGuardStatus {
  const entries = [...watched.values()]
  const down = entries.filter((entry) => proxyHealthBlocksTraffic(entry.health))
  const primary = routing.primary.enabled ? endpointKey(routing.primary.host, routing.primary.port) : (entries[0]?.endpoint.key ?? null)
  return {
    killSwitch,
    armed: armed(),
    state: armed() ? aggregateProxyHealthState(entries.map((entry) => entry.health.state)) : 'off',
    blocking: down.length > 0,
    endpoint: down.length > 0 ? down.map((entry) => entry.endpoint.key).join(', ') : primary,
    endpoints: entries.map((entry) => ({ key: entry.endpoint.key, name: entry.endpoint.name, state: entry.health.state }))
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

function dispatch(entry: Watched, event: ProxyHealthEvent): void {
  if (watched.get(entry.endpoint.key) !== entry) return
  const before = entry.health
  const step = nextProxyHealth(entry.health, event)
  entry.health = step.health
  if (before.state !== entry.health.state) {
    if (entry.health.state === 'down') console.warn(`[kill switch] proxy ${entry.endpoint.key} unreachable; blocking traffic routed through it`)
    else if (before.state === 'down') console.info(`[kill switch] proxy ${entry.endpoint.key} reachable again; traffic resumed`)
    publish()
  }
  if (step.probeNow) runProbe(entry)
  else schedule(entry)
}

function clearTimer(entry: Watched): void {
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = null
}

function schedule(entry: Watched): void {
  clearTimer(entry)
  if (!killSwitch || watched.get(entry.endpoint.key) !== entry) return
  entry.timer = setTimeout(() => runProbe(entry), probeIntervalFor(entry.health))
  entry.timer.unref?.()
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

function runProbe(entry: Watched): void {
  if (!killSwitch || watched.get(entry.endpoint.key) !== entry) return
  if (entry.probing) {
    entry.probeQueued = true
    return
  }
  entry.probing = true
  clearTimer(entry)
  void probe(entry.endpoint.host, entry.endpoint.port).then((ok) => {
    entry.probing = false
    // Removed or switched off mid-probe: the result no longer matters.
    if (!killSwitch || watched.get(entry.endpoint.key) !== entry) return
    dispatch(entry, { type: 'probe', ok })
    if (entry.probeQueued) {
      entry.probeQueued = false
      if (entry.health.state !== 'down') runProbe(entry)
    }
  })
}

/** Match the watched set to the proxies currently in use, starting fresh for any new one. */
function syncEndpoints(): boolean {
  // Settings' proxies plus any proxy a Space forces its partition through.
  const seen = new Set<string>()
  const next = getAllRoutingInputs().flatMap(activeProxyEndpoints).filter((endpoint) => !seen.has(endpoint.key) && seen.add(endpoint.key))
  const keys = new Set(next.map((endpoint) => endpoint.key))
  let changed = false
  for (const [key, entry] of watched) {
    if (keys.has(key)) continue
    clearTimer(entry)
    watched.delete(key)
    changed = true
  }
  for (const endpoint of next) {
    const existing = watched.get(endpoint.key)
    if (existing) {
      existing.endpoint = endpoint
      continue
    }
    watched.set(endpoint.key, { endpoint, health: { ...INITIAL_PROXY_HEALTH }, timer: null, probing: false, probeQueued: false })
    changed = true
  }
  return changed
}

function rearm(): void {
  for (const entry of watched.values()) {
    if (killSwitch) dispatch(entry, entry.health.state === 'off' ? { type: 'arm' } : { type: 'proxy-error' })
    else {
      clearTimer(entry)
      entry.health = nextProxyHealth(entry.health, { type: 'disarm' }).health
    }
  }
}

/** The routing a request uses: its page's session (a Space may force a proxy), else Settings. */
function routingFor(webContentsId: number | undefined): ProxyRoutingInput {
  if (typeof webContentsId !== 'number') return routing
  const contents = allWebContents.fromId(webContentsId)
  return contents && !contents.isDestroyed() ? routingInputForSession(contents.session) : routing
}

/** The watched proxy a URL's requests go through, or null when they go direct. */
function entryForUrl(url: string, input: ProxyRoutingInput = routing): Watched | null {
  const route = effectiveRouteForUrl(url, input)
  if (!route || route.kind === 'direct') return null
  return watched.get(endpointKey(route.host, route.port)) ?? null
}

/** Should this request be cancelled right now? */
function blocksUrl(url: string, input: ProxyRoutingInput = routing): boolean {
  if (!anyBlocking() || isKillSwitchExemptUrl(url)) return false
  const entry = entryForUrl(url, input)
  if (entry) return proxyHealthBlocksTraffic(entry.health)
  const route = effectiveRouteForUrl(url, input)
  // Unroutable web URL while something is down: err on the blocking side.
  return route === null && /^(https?|wss?):/i.test(url)
}

export function initializeProxyKillSwitch(): void {
  const saved = readSettingsFile(FILE) as { killSwitch?: unknown } | null
  killSwitch = saved?.killSwitch === true
  routing = getProxyRoutingInput()
  syncEndpoints()
  addRequestGate((details) => blocksUrl(details.url, routingFor(details.webContentsId)) ? { cancel: true } : null)
  onRequestError((details) => {
    if (!armed() || !isProxyConnectionError(details.error)) return
    const entry = entryForUrl(details.url, routingFor(details.webContentsId))
    if (entry) dispatch(entry, { type: 'proxy-error' })
    else for (const candidate of watched.values()) dispatch(candidate, { type: 'proxy-error' })
  })
  onProxyRoutingChanged((next) => {
    routing = next
    // New endpoints start over so an old "down" doesn't linger (or an old "up" doesn't hide a dead one).
    if (!syncEndpoints()) return
    rearm()
    publish()
  })
  setUpdateNetworkGuard(() => blocksUrl(UPDATE_FEED_URL) ? 'The proxy kill switch is blocking traffic (proxy unreachable).' : null)
  // Watchers/reader images are untargeted background work: hold them while any watched proxy is down.
  setBackgroundNetworkGuard(() => armed() && anyBlocking() ? 'The proxy kill switch is blocking traffic (proxy unreachable).' : null)
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
  if (armed()) for (const entry of watched.values()) runProbe(entry)
  return getProxyGuardStatus()
}
