import { describe, expect, test } from 'bun:test'
import {
  activeProxyEndpoints,
  anyProxyActive,
  buildPacScript,
  buildRoutingProxyConfig,
  effectiveRouteForHost,
  effectiveRouteForUrl,
  isLocalNetworkHost,
  matchProxyRule,
  normalizeRulePattern,
  pacResultAllowsDirect,
  pacResultFor,
  parseProxyRouting,
  resolutionMatches,
  routeLabel,
  siteRulePattern,
  siteRouteState,
  routingSelfTestCases,
  validateProxyRouting,
  withRuleForPattern,
  type ProxyRoutingInput
} from './proxy-routing.ts'

const PRIMARY_ON = { enabled: true, host: '127.0.0.1', port: 1080 }
const PRIMARY_OFF = { enabled: false, host: '127.0.0.1', port: 1080 }

const INPUT: ProxyRoutingInput = {
  primary: PRIMARY_ON,
  proxies: [{ name: 'Work', host: '127.0.0.1', port: 1081 }, { name: 'tor', host: '::1', port: 9050 }],
  rules: [
    { pattern: '*.bank.example', route: 'direct' },
    { pattern: 'secure.bank.example', route: 'proxy' },
    { pattern: '*.corp.example', route: 'proxy:Work' },
    { pattern: '*.onion', route: 'proxy:tor' },
    { pattern: 'nas', route: 'proxy:Work' },
    { pattern: '2001:db8::5', route: 'direct' }
  ]
}

/** Run the generated PAC like Chromium would (no PAC helpers are defined, so using one would throw). */
function pac(input: ProxyRoutingInput): (host: string) => string {
  const script = buildPacScript(input)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const find = new Function(`${script}\nreturn FindProxyForURL;`)() as (url: string, host: string) => string
  return (host) => find(`https://${host}/`, host)
}

const HOSTS = [
  'example.com', 'www.example.com', 'bank.example', 'www.bank.example', 'secure.bank.example', 'a.secure.bank.example',
  'corp.example', 'git.corp.example', 'deep.git.corp.example', 'xcorp.example', 'abc.onion', 'onion', 'nas', 'nas.lan',
  'intranet', 'localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', '2001:db8::5', '2001:db8::6',
  'EXAMPLE.COM', 'www.bank.example.', 'bank.example.evil.com', '10.0.0.1',
  '192.168.1.1', '172.16.0.1', '172.31.255.255', '172.32.0.1', '169.254.1.1', '192.169.1.1', '11.0.0.1', '100.64.0.1', 'unifi.local', 'printer.LOCAL.',
  'local', 'notlocal', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'fc::1', '999.168.1.1', '192.168.1.1.nip.io'
]

describe('rule patterns', () => {
  test('normalises domains, wildcards, pasted URLs and IDNs', () => {
    expect(normalizeRulePattern('Example.COM')).toBe('example.com')
    expect(normalizeRulePattern('  *.example.com ')).toBe('*.example.com')
    expect(normalizeRulePattern('.example.com')).toBe('*.example.com')
    expect(normalizeRulePattern('https://www.example.com/path?q=1')).toBe('www.example.com')
    expect(normalizeRulePattern('example.com/path')).toBe('example.com')
    expect(normalizeRulePattern('example.com.')).toBe('example.com')
    expect(normalizeRulePattern('bücher.de')).toBe('xn--bcher-kva.de')
    expect(normalizeRulePattern('[2001:DB8::1]')).toBe('2001:db8::1')
    expect(normalizeRulePattern('10.1.2.3')).toBe('10.1.2.3')
  })
  test('rejects unusable patterns', () => {
    for (const bad of ['', '*', '*.', 'exa*mple.com', 'a.*.com', 'foo bar.com', '-bad.com', 'a..b', '*.[::1]', 'javascript:alert(1)']) {
      expect(normalizeRulePattern(bad)).toBeNull()
    }
  })
})

describe('rule matching', () => {
  test('exact beats wildcard, longest wildcard suffix wins, apex matches *.domain', () => {
    expect(matchProxyRule('secure.bank.example', INPUT.rules)?.rule.route).toBe('proxy')
    expect(matchProxyRule('secure.bank.example', INPUT.rules)?.kind).toBe('exact')
    expect(matchProxyRule('a.secure.bank.example', INPUT.rules)?.rule.pattern).toBe('*.bank.example')
    expect(matchProxyRule('bank.example', INPUT.rules)?.rule.pattern).toBe('*.bank.example')
    expect(matchProxyRule('deep.git.corp.example', INPUT.rules)?.rule.route).toBe('proxy:Work')
    const nested = [{ pattern: '*.example.com', route: 'direct' as const }, { pattern: '*.api.example.com', route: 'proxy' as const }]
    expect(matchProxyRule('v1.api.example.com', nested)?.rule.pattern).toBe('*.api.example.com')
    expect(matchProxyRule('www.example.com', nested)?.rule.pattern).toBe('*.example.com')
  })
  test('no partial-label or suffix-of-other-domain matches', () => {
    expect(matchProxyRule('xcorp.example', INPUT.rules)).toBeNull()
    expect(matchProxyRule('bank.example.evil.com', INPUT.rules)).toBeNull()
    expect(matchProxyRule('example.com', INPUT.rules)).toBeNull()
  })
  test('case, trailing dot and brackets are ignored', () => {
    expect(matchProxyRule('WWW.Bank.Example.', INPUT.rules)?.rule.pattern).toBe('*.bank.example')
    expect(matchProxyRule('[2001:db8::5]', INPUT.rules)?.rule.route).toBe('direct')
  })
})

describe('effective route', () => {
  test('rules, default and local addresses', () => {
    expect(effectiveRouteForHost('example.com', INPUT)).toEqual({ kind: 'proxy', source: 'default', pattern: null, name: null, host: '127.0.0.1', port: 1080 })
    expect(effectiveRouteForHost('www.bank.example', INPUT)).toEqual({ kind: 'direct', source: 'rule', pattern: '*.bank.example' })
    expect(effectiveRouteForHost('git.corp.example', INPUT)).toMatchObject({ kind: 'proxy', name: 'Work', port: 1081 })
    expect(effectiveRouteForHost('abc.onion', INPUT)).toMatchObject({ kind: 'proxy', name: 'tor', host: '::1', port: 9050 })
    expect(effectiveRouteForHost('localhost', INPUT)).toEqual({ kind: 'direct', source: 'local', pattern: null })
    expect(effectiveRouteForHost('intranet', INPUT).kind).toBe('direct')
    expect(effectiveRouteForHost('nas', INPUT)).toMatchObject({ kind: 'proxy', name: 'Work' })
    expect(effectiveRouteForHost('example.com', { ...INPUT, primary: PRIMARY_OFF })).toEqual({ kind: 'direct', source: 'default', pattern: null })
    // 'proxy' rules use the main proxy even when the default route is direct.
    expect(effectiveRouteForHost('secure.bank.example', { ...INPUT, primary: PRIMARY_OFF })).toMatchObject({ kind: 'proxy', name: null, port: 1080 })
  })
  test('a rule pointing at a missing named proxy fails closed onto the main proxy', () => {
    const input: ProxyRoutingInput = { primary: PRIMARY_OFF, proxies: [], rules: [{ pattern: '*.corp.example', route: 'proxy:Gone' }] }
    expect(effectiveRouteForHost('git.corp.example', input)).toMatchObject({ kind: 'proxy', name: null, port: 1080 })
    expect(pac(input)('git.corp.example')).toBe('SOCKS5 127.0.0.1:1080')
  })
  test('URLs', () => {
    expect(effectiveRouteForUrl('https://git.corp.example:8443/x', INPUT)).toMatchObject({ name: 'Work' })
    expect(effectiveRouteForUrl('wss://abc.onion/socket', INPUT)).toMatchObject({ name: 'tor' })
    expect(effectiveRouteForUrl('http://[::1]:3000/', INPUT)?.kind).toBe('direct')
    expect(effectiveRouteForUrl('file:///etc/hosts', INPUT)).toBeNull()
    expect(effectiveRouteForUrl('not a url', INPUT)).toBeNull()
  })
  test('labels', () => {
    expect(routeLabel(effectiveRouteForHost('abc.onion', INPUT))).toBe('Proxy tor ([::1]:9050)')
    expect(routeLabel(effectiveRouteForHost('example.com', INPUT))).toBe('Proxy (127.0.0.1:1080)')
    expect(routeLabel(effectiveRouteForHost('www.bank.example', INPUT))).toBe('Direct')
  })
})

describe('PAC script', () => {
  test('agrees with the matcher for every host, with and without a default proxy', () => {
    for (const input of [INPUT, { ...INPUT, primary: PRIMARY_OFF }, { ...INPUT, primary: { ...PRIMARY_ON, bypassLocalNetwork: false } }]) {
      const find = pac(input)
      for (const host of HOSTS) expect(`${host} → ${find(host)}`).toBe(`${host} → ${pacResultFor(effectiveRouteForHost(host, input))}`)
    }
  })
  test('proxied routes never carry a DIRECT fallback', () => {
    const find = pac(INPUT)
    for (const host of HOSTS) {
      const route = effectiveRouteForHost(host, INPUT)
      const result = find(host)
      if (route.kind === 'proxy') {
        expect(result).toMatch(/^SOCKS5 \S+$/)
        expect(pacResultAllowsDirect(result)).toBe(false)
        expect(result).not.toContain(';')
      } else {
        expect(result).toBe('DIRECT')
      }
    }
    // No result string in the script itself combines a proxy with DIRECT.
    const script = buildPacScript(INPUT)
    for (const literal of script.match(/"(SOCKS5[^"]*)"/g) ?? []) expect(literal.toUpperCase()).not.toContain('DIRECT')
    expect(script).not.toMatch(/;\s*DIRECT/i)
  })
  test('the default is a single SOCKS5 entry when the main proxy is on', () => {
    expect(pac(INPUT)('anything.example.org')).toBe('SOCKS5 127.0.0.1:1080')
    expect(pac({ ...INPUT, primary: PRIMARY_OFF })('anything.example.org')).toBe('DIRECT')
  })
  test('never calls DNS-resolving PAC helpers', () => {
    const script = buildPacScript(INPUT)
    for (const helper of ['dnsResolve', 'isInNet', 'isResolvable', 'myIpAddress', 'dnsDomainIs', 'shExpMatch']) expect(script).not.toContain(helper)
  })
  test('hostile patterns cannot break out of the generated script', () => {
    // Validation rejects them, but even a hand-edited rule only lands inside a JSON string key.
    const input: ProxyRoutingInput = { primary: PRIMARY_ON, proxies: [], rules: [{ pattern: 'x"};return "DIRECT";//', route: 'proxy' }] }
    expect(pac(input)('example.com')).toBe('SOCKS5 127.0.0.1:1080')
    // __proto__ / prototype keys don't leak through the lookup tables.
    expect(pac({ ...INPUT, primary: PRIMARY_ON })('__proto__')).toBe('DIRECT')
    expect(pac(INPUT)('constructor.example')).toBe('SOCKS5 127.0.0.1:1080')
  })
})

describe('local network bypass', () => {
  test('private, link-local and .local hosts are local network; public, CGNAT and lookalikes are not', () => {
    for (const host of ['192.168.1.1', '10.1.2.3', '172.16.0.1', '172.31.9.9', '169.254.10.10', 'unifi.local', 'NAS.Local.', 'fd00::1', 'fdab:1::2', '[fe80::1]', 'fe9a:1::1']) expect(`${host} ${isLocalNetworkHost(host)}`).toBe(`${host} true`)
    for (const host of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '100.64.0.1', '127.0.0.1', 'example.com', 'local', 'evil.local.example.com', '192.168.1.1.nip.io', '2001:db8::1', 'fc::1', 'fec0::1', '256.168.1.1', '']) expect(`${host} ${isLocalNetworkHost(host)}`).toBe(`${host} false`)
  })
  test('go direct by default even with the main proxy on; a rule still wins; the setting turns it off', () => {
    const input: ProxyRoutingInput = { primary: PRIMARY_ON, proxies: [], rules: [] }
    expect(effectiveRouteForUrl('https://192.168.1.1/', input)).toEqual({ kind: 'direct', source: 'lan', pattern: null })
    expect(effectiveRouteForUrl('https://unifi.local:8443/', input)).toEqual({ kind: 'direct', source: 'lan', pattern: null })
    expect(effectiveRouteForUrl('https://example.com/', input)?.kind).toBe('proxy')
    const ruled: ProxyRoutingInput = { ...input, rules: [{ pattern: '192.168.1.1', route: 'proxy' }] }
    expect(effectiveRouteForUrl('https://192.168.1.1/', ruled)).toMatchObject({ kind: 'proxy', source: 'rule' })
    expect(pac(ruled)('192.168.1.1')).toBe('SOCKS5 127.0.0.1:1080')
    expect(pac(ruled)('192.168.1.2')).toBe('DIRECT')
    const off: ProxyRoutingInput = { ...input, primary: { ...PRIMARY_ON, bypassLocalNetwork: false } }
    expect(effectiveRouteForUrl('https://192.168.1.1/', off)).toMatchObject({ kind: 'proxy', source: 'default' })
    expect(pac({ ...off, rules: [{ pattern: 'x.example', route: 'direct' }] })('192.168.1.1')).toBe('SOCKS5 127.0.0.1:1080')
    expect(routeLabel(effectiveRouteForHost('192.168.1.1', input))).toBe('Direct (local network)')
  })
  test('the self-test checks a private address so a PAC without the branch is caught', () => {
    expect(routingSelfTestCases(INPUT)).toContainEqual({ url: 'https://192.168.254.254/', expected: 'DIRECT' })
    expect(routingSelfTestCases({ ...INPUT, primary: { ...PRIMARY_ON, bypassLocalNetwork: false } })).toContainEqual({ url: 'https://192.168.254.254/', expected: 'SOCKS5 127.0.0.1:1080' })
  })
})

describe('proxy config', () => {
  test('no rules keeps the single-server config', () => {
    expect(buildRoutingProxyConfig({ primary: PRIMARY_ON, proxies: [], rules: [] })).toEqual({ mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:1080', proxyBypassRules: '<local>;*.local;10.0.0.0/8;172.16.0.0/12;192.168.0.0/16;169.254.0.0/16;fc00::/7;fe80::/10' })
    expect(buildRoutingProxyConfig({ primary: { ...PRIMARY_ON, bypassLocalNetwork: false }, proxies: [], rules: [] })).toEqual({ mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:1080', proxyBypassRules: '<local>' })
    expect(buildRoutingProxyConfig({ primary: PRIMARY_OFF, proxies: [{ name: 'Work', host: '127.0.0.1', port: 1081 }], rules: [] })).toEqual({ mode: 'direct' })
  })
  test('rules produce a base64 data: PAC URL holding the script', () => {
    const config = buildRoutingProxyConfig(INPUT)
    expect(config.mode).toBe('pac_script')
    if (config.mode !== 'pac_script') return
    const prefix = 'data:application/x-ns-proxy-autoconfig;base64,'
    expect(config.pacScript.startsWith(prefix)).toBe(true)
    expect(atob(config.pacScript.slice(prefix.length))).toBe(buildPacScript(INPUT))
  })
})

describe('active endpoints', () => {
  test('main proxy when on, plus every proxy a rule uses', () => {
    expect(activeProxyEndpoints(INPUT).map((endpoint) => endpoint.key)).toEqual(['127.0.0.1:1080', '127.0.0.1:1081', '[::1]:9050'])
    const offWithRules: ProxyRoutingInput = { primary: PRIMARY_OFF, proxies: INPUT.proxies, rules: [{ pattern: 'a.example', route: 'proxy:Work' }, { pattern: 'b.example', route: 'direct' }] }
    expect(activeProxyEndpoints(offWithRules)).toEqual([{ key: '127.0.0.1:1081', name: 'Work', host: '127.0.0.1', port: 1081 }])
    expect(anyProxyActive(offWithRules)).toBe(true)
    expect(anyProxyActive({ primary: PRIMARY_OFF, proxies: INPUT.proxies, rules: [{ pattern: 'b.example', route: 'direct' }] })).toBe(false)
  })
})

describe('self-test', () => {
  test('expected resolutions for the default and each rule', () => {
    const cases = routingSelfTestCases(INPUT)
    expect(cases[0]).toEqual({ url: 'https://surffish-route-check.invalid/', expected: 'SOCKS5 127.0.0.1:1080' })
    expect(cases).toContainEqual({ url: 'https://surffish-check.bank.example/', expected: 'DIRECT' })
    expect(cases).toContainEqual({ url: 'https://[2001:db8::5]/', expected: 'DIRECT' })
    expect(cases).toContainEqual({ url: 'https://surffish-check.onion/', expected: 'SOCKS5 [::1]:9050' })
  })
  test('resolveProxy output comparison', () => {
    expect(resolutionMatches('SOCKS5 127.0.0.1:1080', 'SOCKS5 127.0.0.1:1080')).toBe(true)
    expect(resolutionMatches('SOCKS5 127.0.0.1:1080', 'socks5  127.0.0.1:1080;')).toBe(true)
    expect(resolutionMatches('SOCKS5 127.0.0.1:1080', 'SOCKS5 127.0.0.1:1080;DIRECT')).toBe(false)
    expect(resolutionMatches('SOCKS5 127.0.0.1:1080', 'DIRECT')).toBe(false)
    expect(resolutionMatches('DIRECT', 'DIRECT')).toBe(true)
    expect(resolutionMatches('DIRECT', 'SOCKS5 127.0.0.1:1080')).toBe(false)
  })
})

describe('validation and parsing', () => {
  test('valid settings are normalised', () => {
    expect(validateProxyRouting({
      proxies: [{ name: ' Work ', host: 'LOCALHOST', port: '1081' }],
      rules: [{ pattern: 'https://Git.Corp.Example/x', route: 'proxy:work' }, { pattern: '.bank.example', route: 'direct' }]
    })).toEqual({
      proxies: [{ name: 'Work', host: 'localhost', port: 1081 }],
      rules: [{ pattern: 'git.corp.example', route: 'proxy:Work' }, { pattern: '*.bank.example', route: 'direct' }]
    })
  })
  test('rejects bad input with a message', () => {
    expect(() => validateProxyRouting({ proxies: [{ name: 'X', host: '10.0.0.2', port: 1080 }], rules: [] })).toThrow(/localhost/)
    expect(() => validateProxyRouting({ proxies: [{ name: 'Default', host: '127.0.0.1', port: 1080 }], rules: [] })).toThrow(/reserved/)
    expect(() => validateProxyRouting({ proxies: [{ name: 'a', host: '127.0.0.1', port: 1 }, { name: 'A', host: '127.0.0.1', port: 2 }], rules: [] })).toThrow(/two proxies/)
    expect(() => validateProxyRouting({ proxies: [{ name: 'a', host: '127.0.0.1', port: 70000 }], rules: [] })).toThrow(/port/)
    expect(() => validateProxyRouting({ proxies: [], rules: [{ pattern: 'a.example', route: 'proxy:nope' }] })).toThrow(/doesn't exist/)
    expect(() => validateProxyRouting({ proxies: [], rules: [{ pattern: 'a.example', route: 'sideways' }] })).toThrow(/Direct or a proxy/)
    expect(() => validateProxyRouting({ proxies: [], rules: [{ pattern: 'a.example', route: 'direct' }, { pattern: 'A.example', route: 'proxy' }] })).toThrow(/more than one/)
    expect(() => validateProxyRouting({ proxies: [], rules: [{ pattern: 'localhost', route: 'proxy' }] })).toThrow(/local/)
    expect(() => validateProxyRouting({ proxies: [], rules: [{ pattern: 'exa*mple', route: 'proxy' }] })).toThrow(/pattern/)
    expect(() => validateProxyRouting(null)).toThrow()
  })
  test('parsing a saved file only ever fails towards a proxy', () => {
    expect(parseProxyRouting({
      proxies: [{ name: 'Work', host: '127.0.0.1', port: 1081 }, { name: 'Remote', host: '8.8.8.8', port: 1080 }, 'junk'],
      rules: [
        { pattern: 'a.example', route: 'proxy:Remote' },
        { pattern: 'b.example', route: 'weird' },
        { pattern: 'c.example', route: 'direct' },
        { pattern: 'd.example', route: 'proxy:work' },
        { pattern: 'bad pattern', route: 'direct' },
        { pattern: 'c.example', route: 'proxy' }
      ]
    })).toEqual({
      proxies: [{ name: 'Work', host: '127.0.0.1', port: 1081 }],
      rules: [
        { pattern: 'a.example', route: 'proxy' },
        { pattern: 'b.example', route: 'proxy' },
        { pattern: 'c.example', route: 'direct' },
        { pattern: 'd.example', route: 'proxy:Work' }
      ]
    })
    expect(parseProxyRouting('nope')).toEqual({ proxies: [], rules: [] })
  })
  test('setting and clearing one site rule keeps the others in place', () => {
    const base = { proxies: [], rules: [{ pattern: 'a.example', route: 'direct' as const }, { pattern: '*.b.example', route: 'proxy' as const }] }
    expect(withRuleForPattern(base, 'a.example', 'proxy').rules).toEqual([{ pattern: 'a.example', route: 'proxy' }, { pattern: '*.b.example', route: 'proxy' }])
    expect(withRuleForPattern(base, '*.c.example', 'direct').rules.map((rule) => rule.pattern)).toEqual(['a.example', '*.b.example', '*.c.example'])
    expect(withRuleForPattern(base, 'a.example', null).rules).toEqual([{ pattern: '*.b.example', route: 'proxy' }])
  })
})

describe('site quick toggle', () => {
  const domainOf = (host: string): string | null => host.endsWith('.co.uk') ? host.split('.').slice(-3).join('.') : host.split('.').slice(-2).join('.')
  test('pattern covers the registrable domain; IPs and local hosts', () => {
    expect(siteRulePattern('www.news.bbc.co.uk', 'bbc.co.uk')).toBe('*.bbc.co.uk')
    expect(siteRulePattern('10.0.0.1', null)).toBe('10.0.0.1')
    expect(siteRulePattern('[2001:db8::1]', null)).toBe('2001:db8::1')
    expect(siteRulePattern('localhost', null)).toBeNull()
  })
  test('reports the toggle choice, the effective route and any more specific rule', () => {
    expect(siteRouteState('https://www.bank.example/login', INPUT, domainOf)).toMatchObject({ pattern: '*.bank.example', choice: 'direct', effective: { kind: 'direct' }, overriddenBy: null })
    expect(siteRouteState('https://secure.bank.example/', INPUT, domainOf)).toMatchObject({ choice: 'direct', effective: { kind: 'proxy' }, overriddenBy: 'secure.bank.example' })
    expect(siteRouteState('https://example.com/', INPUT, domainOf)).toMatchObject({ pattern: '*.example.com', choice: 'default', effective: { source: 'default' } })
    expect(siteRouteState('file:///x', INPUT, domainOf)).toBeNull()
    expect(siteRouteState('http://localhost:3000/', INPUT, domainOf)).toBeNull()
  })
})
