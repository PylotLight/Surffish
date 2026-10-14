import { describe, expect, test } from 'bun:test'
import { aggregateProxyHealthState, buildProxyConfig, FAILURES_BEFORE_DOWN, INITIAL_PROXY_HEALTH, isKillSwitchExemptUrl, isProxyConnectionError, nextProxyHealth, probeIntervalFor, PROBE_INTERVAL_DOWN_MS, PROBE_INTERVAL_UP_MS, proxyHealthBlocksTraffic, proxyRulesHaveDirectFallback, type ProxyHealth, type ProxyHealthEvent } from './proxy-guard.ts'

function run(events: ProxyHealthEvent[], start: ProxyHealth = INITIAL_PROXY_HEALTH): ProxyHealth {
  return events.reduce((health, event) => nextProxyHealth(health, event).health, start)
}

describe('proxy config', () => {
  test('a single socks5 server and no DIRECT fallback', () => {
    const config = buildProxyConfig({ enabled: true, host: '127.0.0.1', port: 1080 })
    expect(config).toEqual({ mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:1080', proxyBypassRules: '<local>;*.local;10.0.0.0/8;172.16.0.0/12;192.168.0.0/16;169.254.0.0/16;fc00::/7;fe80::/10' })
    expect(buildProxyConfig({ enabled: true, host: '127.0.0.1', port: 1080, bypassLocalNetwork: false }).proxyBypassRules).toBe('<local>')
    expect(proxyRulesHaveDirectFallback(config.proxyRules)).toBe(false)
    expect(buildProxyConfig({ enabled: true, host: '::1', port: 9050 }).proxyRules).toBe('socks5://[::1]:9050')
    expect(buildProxyConfig({ enabled: false, host: '127.0.0.1', port: 1080 })).toEqual({ mode: 'direct' })
  })
  test('detects a DIRECT fallback if one ever sneaks in', () => {
    expect(proxyRulesHaveDirectFallback('socks5://127.0.0.1:1080,direct://')).toBe(true)
    expect(proxyRulesHaveDirectFallback('socks5://127.0.0.1:1080;DIRECT')).toBe(true)
  })
})

describe('reachability state machine', () => {
  test('arming probes immediately; a first failure blocks (proxy never came up)', () => {
    const armed = nextProxyHealth(INITIAL_PROXY_HEALTH, { type: 'arm' })
    expect(armed.probeNow).toBe(true)
    expect(armed.health.state).toBe('checking')
    expect(proxyHealthBlocksTraffic(armed.health)).toBe(false)
    expect(run([{ type: 'arm' }, { type: 'probe', ok: false }]).state).toBe('down')
  })
  test('a working proxy rides out one failed probe, then goes down', () => {
    let health = run([{ type: 'arm' }, { type: 'probe', ok: true }])
    expect(health.state).toBe('up')
    const blip = nextProxyHealth(health, { type: 'probe', ok: false })
    expect(blip.health.state).toBe('up')
    expect(blip.probeNow).toBe(true)
    health = blip.health
    for (let index = 1; index < FAILURES_BEFORE_DOWN; index += 1) health = nextProxyHealth(health, { type: 'probe', ok: false }).health
    expect(health.state).toBe('down')
    expect(proxyHealthBlocksTraffic(health)).toBe(true)
  })
  test('resumes on the first good probe', () => {
    const health = run([{ type: 'arm' }, { type: 'probe', ok: false }, { type: 'probe', ok: false }, { type: 'probe', ok: true }])
    expect(health.state).toBe('up')
    expect(proxyHealthBlocksTraffic(health)).toBe(false)
  })
  test('a proxy error asks for a probe but does not block by itself', () => {
    const up = run([{ type: 'arm' }, { type: 'probe', ok: true }])
    const step = nextProxyHealth(up, { type: 'proxy-error' })
    expect(step.probeNow).toBe(true)
    expect(step.health.state).toBe('up')
  })
  test('disarmed: nothing blocks, probes ignored', () => {
    const health = run([{ type: 'arm' }, { type: 'probe', ok: false }, { type: 'disarm' }, { type: 'probe', ok: false }])
    expect(health.state).toBe('off')
    expect(proxyHealthBlocksTraffic(health)).toBe(false)
    expect(nextProxyHealth(health, { type: 'proxy-error' }).probeNow).toBe(false)
  })
  test('probes faster while down', () => {
    expect(probeIntervalFor(run([{ type: 'arm' }, { type: 'probe', ok: true }]))).toBe(PROBE_INTERVAL_UP_MS)
    expect(probeIntervalFor(run([{ type: 'arm' }, { type: 'probe', ok: false }]))).toBe(PROBE_INTERVAL_DOWN_MS)
  })
})

describe('helpers', () => {
  test('proxy errors', () => {
    expect(isProxyConnectionError('net::ERR_PROXY_CONNECTION_FAILED')).toBe(true)
    expect(isProxyConnectionError('net::ERR_SOCKS_CONNECTION_FAILED')).toBe(true)
    expect(isProxyConnectionError('net::ERR_NAME_NOT_RESOLVED')).toBe(false)
  })
  test('only off-machine traffic is blocked', () => {
    expect(isKillSwitchExemptUrl('https://example.com/')).toBe(false)
    expect(isKillSwitchExemptUrl('wss://example.com/socket')).toBe(false)
    expect(isKillSwitchExemptUrl('http://localhost:5173/')).toBe(true)
    expect(isKillSwitchExemptUrl('chrome-extension://abc/popup.html')).toBe(true)
    expect(isKillSwitchExemptUrl('data:text/plain,hi')).toBe(true)
  })
})

describe('several proxies', () => {
  test('aggregate state: any down blocks, up only when all are up', () => {
    expect(aggregateProxyHealthState([])).toBe('off')
    expect(aggregateProxyHealthState(['up', 'up'])).toBe('up')
    expect(aggregateProxyHealthState(['up', 'checking'])).toBe('checking')
    expect(aggregateProxyHealthState(['up', 'down', 'checking'])).toBe('down')
    expect(aggregateProxyHealthState(['off', 'up'])).toBe('checking')
  })
})
