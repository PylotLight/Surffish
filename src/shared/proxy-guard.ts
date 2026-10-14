/**
 * Proxy kill switch: config building (never a DIRECT fallback) and the reachability state
 * machine that decides when page traffic is blocked. Pure, so it is unit-testable.
 */

export interface ProxyEndpoint {
  enabled: boolean
  host: string
  port: number
  /**
   * Local-network addresses (private / link-local IPs, `*.local`) connect directly instead of
   * through the proxy, like other proxy-aware browsers. Absent means on (the default).
   */
  bypassLocalNetwork?: boolean
}

/**
 * Chromium bypass entries for the local network: private IPv4 (RFC 1918), link-local, IPv6 unique
 * local / link-local, and mDNS `.local` names. IP ranges only match IP literals (no DNS lookup).
 */
export const LOCAL_NETWORK_BYPASS_RULES = ['*.local', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', 'fc00::/7', 'fe80::/10'] as const

export function bypassesLocalNetwork(settings: Pick<ProxyEndpoint, 'bypassLocalNetwork'>): boolean {
  return settings.bypassLocalNetwork !== false
}

export interface ProxyConfigShape {
  mode: 'direct' | 'fixed_servers'
  proxyRules?: string
  proxyBypassRules?: string
}

/**
 * Chromium only falls back to a direct connection when the rules list DIRECT; a single
 * socks5:// server never does. Keep it that way: one server, no fallback entries.
 */
export function buildProxyConfig(settings: ProxyEndpoint): ProxyConfigShape {
  if (!settings.enabled) return { mode: 'direct' }
  const host = settings.host.includes(':') && !settings.host.startsWith('[') ? `[${settings.host}]` : settings.host
  const bypass = bypassesLocalNetwork(settings) ? ['<local>', ...LOCAL_NETWORK_BYPASS_RULES] : ['<local>']
  return { mode: 'fixed_servers', proxyRules: `socks5://${host}:${settings.port}`, proxyBypassRules: bypass.join(';') }
}

export function proxyRulesHaveDirectFallback(rules: string | undefined): boolean {
  return Boolean(rules && /(^|[;,\s=])direct(:\/\/)?($|[;,\s])/i.test(rules))
}

/** Errors that can mean the proxy itself is gone. SOCKS errors can also be the far side; a probe confirms. */
const PROXY_ERRORS = new Set(['ERR_PROXY_CONNECTION_FAILED', 'ERR_SOCKS_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED', 'ERR_NO_SUPPORTED_PROXIES', 'ERR_MANDATORY_PROXY_CONFIGURATION_FAILED'])

export function isProxyConnectionError(error: string): boolean {
  return PROXY_ERRORS.has(error.trim().replace(/^net::/, ''))
}

export type ProxyHealthState = 'off' | 'checking' | 'up' | 'down'

export interface ProxyHealth {
  state: ProxyHealthState
  consecutiveFailures: number
  /** A success has been seen since the guard was armed. */
  everUp: boolean
}

export type ProxyHealthEvent =
  | { type: 'arm' }
  | { type: 'disarm' }
  | { type: 'probe'; ok: boolean }
  | { type: 'proxy-error' }

/** Failed probes in a row before a proxy that was working is declared down (rides out one blip). */
export const FAILURES_BEFORE_DOWN = 2
export const PROBE_INTERVAL_UP_MS = 10_000
export const PROBE_INTERVAL_DOWN_MS = 2_000
export const PROBE_TIMEOUT_MS = 2_000

export const INITIAL_PROXY_HEALTH: ProxyHealth = { state: 'off', consecutiveFailures: 0, everUp: false }

export interface ProxyHealthStep {
  health: ProxyHealth
  /** Run a reachability probe right away (instead of waiting for the next tick). */
  probeNow: boolean
}

export function nextProxyHealth(health: ProxyHealth, event: ProxyHealthEvent): ProxyHealthStep {
  switch (event.type) {
    case 'arm':
      if (health.state !== 'off') return { health, probeNow: false }
      return { health: { state: 'checking', consecutiveFailures: 0, everUp: false }, probeNow: true }
    case 'disarm':
      return { health: { ...INITIAL_PROXY_HEALTH }, probeNow: false }
    case 'proxy-error':
      if (health.state === 'off' || health.state === 'down') return { health, probeNow: false }
      // Don't block on one failed request (it may be the destination); check the proxy now.
      return { health, probeNow: true }
    case 'probe': {
      if (health.state === 'off') return { health, probeNow: false }
      if (event.ok) return { health: { state: 'up', consecutiveFailures: 0, everUp: true }, probeNow: false }
      const consecutiveFailures = health.consecutiveFailures + 1
      // Never reached it since arming (proxy not started yet): block straight away.
      const threshold = health.everUp ? FAILURES_BEFORE_DOWN : 1
      if (health.state === 'down' || consecutiveFailures >= threshold) return { health: { ...health, state: 'down', consecutiveFailures }, probeNow: false }
      return { health: { ...health, consecutiveFailures }, probeNow: true }
    }
  }
}

export function proxyHealthBlocksTraffic(health: ProxyHealth): boolean {
  return health.state === 'down'
}

export function probeIntervalFor(health: ProxyHealth): number {
  return health.state === 'up' ? PROBE_INTERVAL_UP_MS : PROBE_INTERVAL_DOWN_MS
}

/** Requests the kill switch lets through even while blocking: nothing that leaves the machine. */
export function isKillSwitchExemptUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return true
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return true
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  // Loopback never goes through the proxy anyway (and the proxy itself lives there).
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host)
}

export interface ProxyGuardStatus {
  /** The user turned the kill switch on. */
  killSwitch: boolean
  /** Proxy is enabled and the kill switch is on, so the guard is watching. */
  armed: boolean
  state: ProxyHealthState
  /** Page traffic is being cancelled right now (for sites routed through a proxy that is down). */
  blocking: boolean
  /** The main proxy, or while blocking the proxy (or proxies) that are down. */
  endpoint: string | null
  /** Every proxy in use (main proxy and any per-site rule proxies), each watched on its own. */
  endpoints: ProxyGuardEndpointStatus[]
}

export interface ProxyGuardEndpointStatus {
  /** host:port */
  key: string
  /** null = the main proxy */
  name: string | null
  state: ProxyHealthState
}

/** One status for the whole guard: down if any proxy is down, up only when all are up. */
export function aggregateProxyHealthState(states: ProxyHealthState[]): ProxyHealthState {
  if (states.length === 0) return 'off'
  if (states.includes('down')) return 'down'
  if (states.includes('checking')) return 'checking'
  if (states.every((state) => state === 'up')) return 'up'
  return 'checking'
}
