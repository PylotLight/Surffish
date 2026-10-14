/**
 * Per-site proxy routing: rules that send a domain through the main SOCKS5 proxy, a named
 * extra SOCKS5 proxy, or directly. Compiled into a PAC script for Chromium.
 *
 * The one guarantee that matters: a host routed to a proxy only ever gets that proxy's
 * "SOCKS5 host:port" back. No "; DIRECT" fallback, ever, so a dead proxy means a failed
 * request (and the kill switch), never a silent direct connection. Pure, so it's unit-testable.
 */
import { buildProxyConfig, bypassesLocalNetwork, type ProxyEndpoint } from './proxy-guard'

export interface NamedProxy {
  name: string
  host: string
  port: number
}

/** 'proxy' is the main proxy from Settings → SOCKS5 proxy; 'proxy:<name>' an extra one. */
export type ProxyRoute = 'proxy' | 'direct' | `proxy:${string}`

export interface ProxyRule {
  /** `example.com` (that host only) or `*.example.com` (the domain and every subdomain). */
  pattern: string
  route: ProxyRoute
}

export interface ProxyRoutingSettings {
  proxies: NamedProxy[]
  rules: ProxyRule[]
}

export interface ProxyRoutingInput extends ProxyRoutingSettings {
  /** The main proxy. `enabled` decides where sites without a rule go. */
  primary: ProxyEndpoint
}

/** What Settings → Network rules shows: the main proxy, extra proxies and rules as applied. */
export interface ProxyRoutingState extends ProxyRoutingInput {
  /** Non-null when the rules failed their self-check and the fail-closed config is in force. */
  error: string | null
}

/** 'local' = loopback / single-label names; 'lan' = local-network addresses (private IPs, `.local`). */
export type EffectiveRouteSource = 'rule' | 'default' | 'local' | 'lan'

export type EffectiveRoute =
  | { kind: 'direct'; source: EffectiveRouteSource; pattern: string | null }
  | { kind: 'proxy'; source: EffectiveRouteSource; pattern: string | null; name: string | null; host: string; port: number }

export const MAX_NAMED_PROXIES = 16
export const MAX_PROXY_RULES = 500
export const PROXY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,31}$/
const LOOPBACK_PROXY_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Lower-case, no trailing dot, IPv6 without brackets (PAC and URL disagree on those). */
export function normalizeHost(host: string): string {
  let value = host.trim().toLowerCase()
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  while (value.endsWith('.')) value = value.slice(0, -1)
  return value
}

export function isLoopbackHost(host: string): boolean {
  const value = normalizeHost(host)
  return value === 'localhost' || value.endsWith('.localhost') || value === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
}

/** Dotless, non-IP names (`intranet`, `nas`): Chromium's `<local>` bypass, kept from the fixed-servers config. */
export function isPlainHostName(host: string): boolean {
  const value = normalizeHost(host)
  return value.length > 0 && !value.includes('.') && !value.includes(':')
}

function ipv4Octets(host: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null
  const parts = host.split('.').map(Number)
  return parts.every((part) => part <= 255) ? parts : null
}

/**
 * A local-network address that connects directly (when the main proxy's local-network bypass is
 * on): RFC 1918 and link-local IPv4, IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
 * literals, and mDNS `.local` names. Literal checks only, never a DNS lookup. Matches Chromium's
 * bypass list (`LOCAL_NETWORK_BYPASS_RULES`) and the PAC script below.
 */
export function isLocalNetworkHost(host: string): boolean {
  const value = normalizeHost(host)
  if (!value) return false
  if (value.endsWith('.local')) return true
  const v4 = ipv4Octets(value)
  if (v4) {
    const [a, b] = v4 as [number, number, number, number]
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  if (value.includes(':')) return /^f[cd][0-9a-f]{2}:/.test(value) || /^fe[89ab][0-9a-f]:/.test(value)
  return false
}

function hostnameFromInput(raw: string): string | null {
  let value = raw.trim()
  if (!value) return null
  // Pasted URLs: keep only the host.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      value = new URL(value).hostname
    } catch {
      return null
    }
  } else {
    value = value.replace(/[/?#].*$/, '')
  }
  const host = normalizeHost(value)
  if (!host) return null
  if (host.includes(':')) {
    // IPv6 literal.
    return /^[0-9a-f:.]+$/.test(host) ? host : null
  }
  let ascii: string
  try {
    ascii = normalizeHost(new URL(`http://${host}/`).hostname)
  } catch {
    return null
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(ascii)) return null
  if (ascii.split('.').some((label) => label.length === 0 || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) return null
  return ascii
}

/**
 * Normalise what the user typed into a rule pattern: `example.com`, `*.example.com`, `.example.com`
 * (same as `*.`), or a pasted URL. Returns null when it isn't a usable host pattern.
 */
export function normalizeRulePattern(raw: string): string | null {
  let value = raw.trim()
  let wildcard = false
  if (value.startsWith('*.')) {
    wildcard = true
    value = value.slice(2)
  } else if (value.startsWith('.')) {
    wildcard = true
    value = value.slice(1)
  }
  if (value.includes('*')) return null
  const host = hostnameFromInput(value)
  if (!host) return null
  if (wildcard && host.includes(':')) return null
  return wildcard ? `*.${host}` : host
}

export function isProxyRoute(value: unknown): value is ProxyRoute {
  return value === 'proxy' || value === 'direct' || (typeof value === 'string' && value.startsWith('proxy:') && value.length > 'proxy:'.length)
}

function proxyNameOf(route: ProxyRoute): string | null {
  return route.startsWith('proxy:') ? route.slice('proxy:'.length) : null
}

function findNamedProxy(proxies: NamedProxy[], name: string): NamedProxy | undefined {
  const key = name.toLowerCase()
  return proxies.find((proxy) => proxy.name.toLowerCase() === key)
}

export interface RuleMatch {
  rule: ProxyRule
  /** 'exact' beats any wildcard; among wildcards the longest suffix wins. */
  kind: 'exact' | 'wildcard'
}

/**
 * The rule that applies to a host. Same algorithm as the generated PAC (exact table first, then
 * walk the suffixes from most to least specific), so the UI shows what Chromium will do.
 */
export function matchProxyRule(host: string, rules: ProxyRule[]): RuleMatch | null {
  const target = normalizeHost(host)
  if (!target) return null
  const exact = new Map<string, ProxyRule>()
  const suffix = new Map<string, ProxyRule>()
  for (const rule of rules) {
    if (rule.pattern.startsWith('*.')) suffix.set(rule.pattern.slice(2), rule)
    else exact.set(rule.pattern, rule)
  }
  const exactRule = exact.get(target)
  if (exactRule) return { rule: exactRule, kind: 'exact' }
  if (target.includes(':')) return null
  let candidate = target
  for (;;) {
    const rule = suffix.get(candidate)
    if (rule) return { rule, kind: 'wildcard' }
    const dot = candidate.indexOf('.')
    if (dot < 0) return null
    candidate = candidate.slice(dot + 1)
  }
}

function proxyRouteTarget(route: ProxyRoute, input: ProxyRoutingInput): { name: string | null; host: string; port: number } {
  const name = proxyNameOf(route)
  if (name !== null) {
    const named = findNamedProxy(input.proxies, name)
    if (named) return { name: named.name, host: named.host, port: named.port }
    // Dangling reference (proxy removed): fail closed onto the main proxy, never direct.
  }
  return { name: null, host: input.primary.host, port: input.primary.port }
}

/** Where a request to this host goes, and why. */
export function effectiveRouteForHost(host: string, input: ProxyRoutingInput): EffectiveRoute {
  const target = normalizeHost(host)
  if (isLoopbackHost(target)) return { kind: 'direct', source: 'local', pattern: null }
  const match = matchProxyRule(target, input.rules)
  if (match) {
    if (match.rule.route === 'direct') return { kind: 'direct', source: 'rule', pattern: match.rule.pattern }
    return { kind: 'proxy', source: 'rule', pattern: match.rule.pattern, ...proxyRouteTarget(match.rule.route, input) }
  }
  if (isPlainHostName(target)) return { kind: 'direct', source: 'local', pattern: null }
  if (bypassesLocalNetwork(input.primary) && isLocalNetworkHost(target)) return { kind: 'direct', source: 'lan', pattern: null }
  if (!input.primary.enabled) return { kind: 'direct', source: 'default', pattern: null }
  return { kind: 'proxy', source: 'default', pattern: null, name: null, host: input.primary.host, port: input.primary.port }
}

export function effectiveRouteForUrl(url: string, input: ProxyRoutingInput): EffectiveRoute | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return null
  return effectiveRouteForHost(parsed.hostname, input)
}

function hostPort(host: string, port: number): string {
  const value = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `${value}:${port}`
}

export function endpointKey(host: string, port: number): string {
  return hostPort(normalizeHost(host), port)
}

/** The PAC result string for a route: exactly one SOCKS5 entry, or DIRECT. */
export function pacResultFor(route: EffectiveRoute): string {
  return route.kind === 'direct' ? 'DIRECT' : `SOCKS5 ${hostPort(route.host, route.port)}`
}

/** True when a PAC / resolveProxy result string could ever go direct. */
export function pacResultAllowsDirect(result: string): boolean {
  return result.split(';').some((entry) => entry.trim().toUpperCase().startsWith('DIRECT'))
}

/** Rules are in effect, so the PAC script (not the legacy single-server config) is needed. */
export function needsPacScript(input: ProxyRoutingInput): boolean {
  return input.rules.length > 0
}

/**
 * The PAC script. Lookups only (no dnsResolve / isInNet / myIpAddress), so evaluating it never
 * triggers a DNS lookup outside the proxy.
 */
export function buildPacScript(input: ProxyRoutingInput): string {
  const exact: Record<string, string> = {}
  const suffix: Record<string, string> = {}
  for (const rule of input.rules) {
    const route = rule.route === 'direct'
      ? 'DIRECT'
      : pacResultFor({ kind: 'proxy', source: 'rule', pattern: rule.pattern, ...proxyRouteTarget(rule.route, input) })
    if (rule.pattern.startsWith('*.')) suffix[rule.pattern.slice(2)] = route
    else exact[rule.pattern] = route
  }
  const fallback = input.primary.enabled ? `SOCKS5 ${hostPort(input.primary.host, input.primary.port)}` : 'DIRECT'
  return [
    '// Generated by Surffish. Proxied routes return a single SOCKS5 entry with no DIRECT fallback.',
    `var EXACT = ${JSON.stringify(exact)};`,
    `var SUFFIX = ${JSON.stringify(suffix)};`,
    `var FALLBACK = ${JSON.stringify(fallback)};`,
    `var LAN_DIRECT = ${bypassesLocalNetwork(input.primary) ? 'true' : 'false'};`,
    'function own(map, key) { return Object.prototype.hasOwnProperty.call(map, key); }',
    // Literal checks only (no dnsResolve / isInNet): same set as isLocalNetworkHost.
    'function isLan(h) {',
    '  if (/\\.local$/.test(h)) return true;',
    '  var m = /^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/.exec(h);',
    '  if (m) {',
    '    var a = +m[1], b = +m[2];',
    '    if (a > 255 || b > 255 || +m[3] > 255 || +m[4] > 255) return false;',
    '    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);',
    '  }',
    '  if (h.indexOf(":") >= 0) return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);',
    '  return false;',
    '}',
    'function FindProxyForURL(url, host) {',
    '  var h = String(host).toLowerCase();',
    '  if (h.charAt(0) === "[" && h.charAt(h.length - 1) === "]") h = h.substring(1, h.length - 1);',
    '  while (h.length > 0 && h.charAt(h.length - 1) === ".") h = h.substring(0, h.length - 1);',
    '  if (h === "localhost" || /\\.localhost$/.test(h) || h === "::1" || /^127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$/.test(h)) return "DIRECT";',
    '  if (own(EXACT, h)) return EXACT[h];',
    '  if (h.indexOf(":") < 0) {',
    '    var s = h;',
    '    for (;;) {',
    '      if (own(SUFFIX, s)) return SUFFIX[s];',
    '      var i = s.indexOf(".");',
    '      if (i < 0) break;',
    '      s = s.substring(i + 1);',
    '    }',
    '  }',
    '  if (h.length > 0 && h.indexOf(".") < 0 && h.indexOf(":") < 0) return "DIRECT";',
    '  if (LAN_DIRECT && isLan(h)) return "DIRECT";',
    '  return FALLBACK;',
    '}',
    ''
  ].join('\n')
}

export function pacScriptDataUrl(script: string): string {
  // Hosts are punycoded and names never appear in the script, so it's ASCII.
  if (!/^[\x20-\x7e\n]*$/.test(script)) throw new Error('PAC script must be ASCII.')
  return `data:application/x-ns-proxy-autoconfig;base64,${btoa(script)}`
}

export type RoutingProxyConfig =
  | { mode: 'direct' }
  | { mode: 'fixed_servers'; proxyRules?: string; proxyBypassRules?: string }
  | { mode: 'pac_script'; pacScript: string }

/** No rules: the proven single-server config. Rules: a PAC script. */
export function buildRoutingProxyConfig(input: ProxyRoutingInput): RoutingProxyConfig {
  if (!needsPacScript(input)) return buildProxyConfig(input.primary) as RoutingProxyConfig
  return { mode: 'pac_script', pacScript: pacScriptDataUrl(buildPacScript(input)) }
}

export interface ActiveProxyEndpoint {
  key: string
  /** null = the main proxy. */
  name: string | null
  host: string
  port: number
}

/** Every proxy some traffic can go through right now (what the kill switch watches). */
export function activeProxyEndpoints(input: ProxyRoutingInput): ActiveProxyEndpoint[] {
  const endpoints = new Map<string, ActiveProxyEndpoint>()
  const add = (name: string | null, host: string, port: number): void => {
    const key = endpointKey(host, port)
    if (!endpoints.has(key)) endpoints.set(key, { key, name, host, port })
  }
  if (input.primary.enabled) add(null, input.primary.host, input.primary.port)
  for (const rule of input.rules) {
    if (rule.route === 'direct') continue
    const target = proxyRouteTarget(rule.route, input)
    add(target.name, target.host, target.port)
  }
  return [...endpoints.values()]
}

/** WebRTC's disable_non_proxied_udp applies whenever any traffic is proxied. */
export function anyProxyActive(input: ProxyRoutingInput): boolean {
  return activeProxyEndpoints(input).length > 0
}

/**
 * Hosts to check with session.resolveProxy after applying a config, with the PAC result each
 * must produce. Catches a PAC script Chromium didn't load (it would answer DIRECT).
 */
export function routingSelfTestCases(input: ProxyRoutingInput, limit = 12): Array<{ url: string; expected: string }> {
  // A private address too: proves the PAC's local-network branch matches isLocalNetworkHost.
  const hosts = new Set<string>(['surffish-route-check.invalid', '192.168.254.254'])
  for (const rule of input.rules) {
    hosts.add(rule.pattern.startsWith('*.') ? `surffish-check.${rule.pattern.slice(2)}` : rule.pattern)
    if (hosts.size >= limit) break
  }
  return [...hosts].map((host) => {
    const url = `https://${host.includes(':') ? `[${host}]` : host}/`
    return { url, expected: pacResultFor(effectiveRouteForHost(host, input)) }
  })
}

/** resolveProxy output vs expectation (Chromium may add spaces or a trailing ';'). */
export function resolutionMatches(expected: string, actual: string): boolean {
  const clean = (value: string): string => value.split(';').map((part) => part.trim().replace(/\s+/g, ' ').toUpperCase()).filter(Boolean).join(';')
  const actualClean = clean(actual)
  if (expected === 'DIRECT') return actualClean === 'DIRECT'
  return actualClean === clean(expected) && !pacResultAllowsDirect(actual)
}

export interface RoutingValidationOptions {
  /** Extra hosts allowed for named proxies (default: loopback only, like the main proxy). */
  allowedHosts?: ReadonlySet<string>
}

/** Strict validation for settings coming from the UI. Throws a user-facing message. */
export function validateProxyRouting(input: unknown, options: RoutingValidationOptions = {}): ProxyRoutingSettings {
  if (!isRecord(input)) throw new Error('Network rules must be an object.')
  const allowed = options.allowedHosts ?? LOOPBACK_PROXY_HOSTS
  const rawProxies = Array.isArray(input.proxies) ? input.proxies : []
  const rawRules = Array.isArray(input.rules) ? input.rules : []
  if (rawProxies.length > MAX_NAMED_PROXIES) throw new Error(`Up to ${MAX_NAMED_PROXIES} extra proxies are supported.`)
  if (rawRules.length > MAX_PROXY_RULES) throw new Error(`Up to ${MAX_PROXY_RULES} rules are supported.`)
  const proxies: NamedProxy[] = []
  for (const raw of rawProxies) {
    if (!isRecord(raw)) throw new Error('Each proxy needs a name, host and port.')
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const host = typeof raw.host === 'string' ? raw.host.trim().toLowerCase() : ''
    const port = Number(raw.port)
    if (!PROXY_NAME_PATTERN.test(name)) throw new Error(`“${name || '(blank)'}” isn't a usable proxy name: use up to 32 letters, numbers, spaces, dots, dashes or underscores.`)
    if (name.toLowerCase() === 'default') throw new Error('“Default” is reserved for the main proxy.')
    if (findNamedProxy(proxies, name)) throw new Error(`There are two proxies called “${name}”.`)
    if (!allowed.has(host)) throw new Error(`Proxy “${name}”: for safety only localhost SOCKS proxies are accepted.`)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Proxy “${name}”: enter a port between 1 and 65535.`)
    proxies.push({ name, host, port })
  }
  const rules: ProxyRule[] = []
  const seen = new Set<string>()
  for (const raw of rawRules) {
    if (!isRecord(raw)) throw new Error('Each rule needs a site and a route.')
    const rawPattern = typeof raw.pattern === 'string' ? raw.pattern : ''
    const pattern = normalizeRulePattern(rawPattern)
    if (!pattern) throw new Error(`“${rawPattern.trim() || '(blank)'}” isn't a site pattern. Use example.com or *.example.com.`)
    if (isLoopbackHost(pattern.replace(/^\*\./, ''))) throw new Error(`${pattern}: local addresses always connect directly.`)
    if (seen.has(pattern)) throw new Error(`${pattern} has more than one rule.`)
    if (!isProxyRoute(raw.route)) throw new Error(`${pattern}: choose Direct or a proxy.`)
    const name = proxyNameOf(raw.route)
    let route: ProxyRoute = raw.route
    if (name !== null) {
      const named = findNamedProxy(proxies, name)
      if (!named) throw new Error(`${pattern} uses a proxy called “${name}” that doesn't exist.`)
      route = `proxy:${named.name}`
    }
    seen.add(pattern)
    rules.push({ pattern, route })
  }
  return { proxies, rules }
}

/**
 * Lenient parse of the saved file. Bad entries are dropped, except that a rule's route can only
 * ever fail towards a proxy: an unknown route or a missing named proxy becomes 'proxy'.
 */
export function parseProxyRouting(value: unknown): ProxyRoutingSettings {
  if (!isRecord(value)) return { proxies: [], rules: [] }
  const proxies: NamedProxy[] = []
  for (const raw of Array.isArray(value.proxies) ? value.proxies : []) {
    if (!isRecord(raw) || proxies.length >= MAX_NAMED_PROXIES) continue
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const host = typeof raw.host === 'string' ? raw.host.trim().toLowerCase() : ''
    const port = Number(raw.port)
    if (!PROXY_NAME_PATTERN.test(name) || name.toLowerCase() === 'default' || findNamedProxy(proxies, name)) continue
    if (!LOOPBACK_PROXY_HOSTS.has(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue
    proxies.push({ name, host, port })
  }
  const rules: ProxyRule[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(value.rules) ? value.rules : []) {
    if (!isRecord(raw) || rules.length >= MAX_PROXY_RULES) continue
    const pattern = typeof raw.pattern === 'string' ? normalizeRulePattern(raw.pattern) : null
    if (!pattern || seen.has(pattern) || isLoopbackHost(pattern.replace(/^\*\./, ''))) continue
    let route: ProxyRoute = isProxyRoute(raw.route) ? raw.route : 'proxy'
    const name = proxyNameOf(route)
    if (name !== null) {
      const named = findNamedProxy(proxies, name)
      route = named ? `proxy:${named.name}` : 'proxy'
    }
    seen.add(pattern)
    rules.push({ pattern, route })
  }
  return { proxies, rules }
}

/** Set (or with null, remove) the rule for one pattern, keeping the rest in order. */
export function withRuleForPattern(settings: ProxyRoutingSettings, pattern: string, route: ProxyRoute | null): ProxyRoutingSettings {
  const rules = settings.rules.filter((rule) => rule.pattern !== pattern)
  if (route) {
    const index = settings.rules.findIndex((rule) => rule.pattern === pattern)
    const rule = { pattern, route }
    if (index >= 0) rules.splice(index, 0, rule)
    else rules.push(rule)
  }
  return { proxies: settings.proxies.map((proxy) => ({ ...proxy })), rules }
}

/** Human label for a route, e.g. in the rules table and site panel. */
export function routeLabel(route: EffectiveRoute): string {
  if (route.kind === 'direct') return route.source === 'local' ? 'Direct (local address)' : route.source === 'lan' ? 'Direct (local network)' : 'Direct'
  return `${route.name ? `Proxy ${route.name}` : 'Proxy'} (${hostPort(route.host, route.port)})`
}

/** What the site panel's "Route this site" control manages for a host. */
export interface SiteRouteState {
  host: string
  /** The rule pattern the quick toggle reads and writes (`*.example.com`, or the bare host for IPs). */
  pattern: string
  /** That pattern's own rule, or 'default' when it has none. */
  choice: ProxyRoute | 'default'
  effective: EffectiveRoute
  /** The rule actually deciding the route when it isn't the toggle's own (e.g. an exact-host rule). */
  overriddenBy: string | null
}

/** The registrable domain comes from the caller (tldts in main), so this file stays dependency-free. */
export function siteRulePattern(host: string, registrableDomain: string | null): string | null {
  const value = normalizeHost(host)
  if (!value || isLoopbackHost(value)) return null
  if (value.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return normalizeRulePattern(value)
  return normalizeRulePattern(`*.${registrableDomain ?? value}`)
}

export function siteRouteState(url: string, input: ProxyRoutingInput, registrableDomain: (host: string) => string | null): SiteRouteState | null {
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    host = normalizeHost(parsed.hostname)
  } catch {
    return null
  }
  const pattern = siteRulePattern(host, registrableDomain(host))
  if (!pattern) return null
  const own = input.rules.find((rule) => rule.pattern === pattern)
  const effective = effectiveRouteForHost(host, input)
  const overriddenBy = effective.source === 'rule' && effective.pattern !== pattern ? effective.pattern : null
  return { host, pattern, choice: own?.route ?? 'default', effective, overriddenBy }
}
