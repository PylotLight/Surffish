import { describe, expect, test } from 'bun:test'
import { httpFallbackUrl, httpsUpgradeTarget, isHttpsUpgradeFailure, isInsecurePageUrl, isLocalOrPrivateHost, normalizeHttpsExceptions } from './https-only.ts'

const none = new Set<string>()

describe('httpsUpgradeTarget', () => {
  test('upgrades plain http on the default port', () => {
    expect(httpsUpgradeTarget('http://example.com/a?b=1#c', none)).toBe('https://example.com/a?b=1#c')
  })
  test('never upgrades local, private, intranet or non-default ports', () => {
    for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://app.localhost/', 'http://printer.local/', 'http://192.168.1.10/', 'http://10.0.0.2/', 'http://172.20.0.1/', 'http://169.254.1.1/', 'http://[::1]/', 'http://[fd00::1]/', 'http://nas/', 'http://example.com:8080/']) {
      expect(httpsUpgradeTarget(url, none)).toBeNull()
    }
  })
  test('leaves https, other schemes and excepted hosts alone', () => {
    expect(httpsUpgradeTarget('https://example.com/', none)).toBeNull()
    expect(httpsUpgradeTarget('ftp://example.com/', none)).toBeNull()
    expect(httpsUpgradeTarget('http://old.example/', new Set(['old.example']))).toBeNull()
  })
  test('public addresses that look private are still upgraded', () => {
    expect(isLocalOrPrivateHost('172.32.0.1')).toBe(false)
    expect(isLocalOrPrivateHost('8.8.8.8')).toBe(false)
    expect(httpFallbackUrl('https://example.com/x')).toBe('http://example.com/x')
  })
})

describe('isHttpsUpgradeFailure', () => {
  test('certificate, TLS and connection errors count', () => {
    for (const error of ['net::ERR_CERT_AUTHORITY_INVALID', 'net::ERR_SSL_PROTOCOL_ERROR', 'net::ERR_CONNECTION_REFUSED', 'ERR_TOO_MANY_REDIRECTS', 'ERR_CONNECTION_TIMED_OUT (-118)']) expect(isHttpsUpgradeFailure(error)).toBe(true)
  })
  test('DNS failures and aborts do not (http would fail too)', () => {
    for (const error of ['net::ERR_NAME_NOT_RESOLVED', 'net::ERR_ABORTED', 'net::ERR_BLOCKED_BY_CLIENT']) expect(isHttpsUpgradeFailure(error)).toBe(false)
  })
})

describe('misc', () => {
  test('Not secure marker for http pages except loopback', () => {
    expect(isInsecurePageUrl('http://example.com/')).toBe(true)
    expect(isInsecurePageUrl('http://192.168.1.1/')).toBe(true)
    expect(isInsecurePageUrl('http://localhost:3000/')).toBe(false)
    expect(isInsecurePageUrl('https://example.com/')).toBe(false)
  })
  test('exceptions are hostnames, deduped', () => {
    expect(normalizeHttpsExceptions(['A.example', 'a.example', 'bad host', 'x/y', 3])).toEqual(['a.example'])
  })
})
