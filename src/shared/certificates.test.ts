import { describe, expect, test } from 'bun:test'
import {
  CertificateExceptions,
  LruMap,
  certificateErrorName,
  certificateVerdict,
  describeCertificateError,
  distinguishedNameText,
  formatFingerprint,
  hostOfUrl,
  isCertificateErrorCode,
  siteConnectionSummary
} from './certificates.ts'
import { describeLoadError, shouldShowFullPageError } from './navigation-errors.ts'

describe('certificate errors', () => {
  test('names from Chromium strings', () => {
    expect(certificateErrorName('net::ERR_CERT_AUTHORITY_INVALID')).toBe('ERR_CERT_AUTHORITY_INVALID')
    expect(certificateErrorName('ERR_CERT_DATE_INVALID (-201)')).toBe('ERR_CERT_DATE_INVALID')
    expect(certificateErrorName('net::OK')).toBeNull()
    expect(certificateErrorName(undefined)).toBeNull()
    expect(isCertificateErrorCode(-202)).toBe(true)
    expect(isCertificateErrorCode(-105)).toBe(false)
    expect(isCertificateErrorCode(null)).toBe(false)
  })
  test('the 192.168.1.1 failure is a certificate error page with its own copy', () => {
    const copy = describeLoadError({ message: 'ERR_CERT_AUTHORITY_INVALID (-202)', url: 'https://192.168.1.1/' })
    expect(copy.kind).toBe('certificate')
    expect(shouldShowFullPageError(-202)).toBe(true)
    expect(describeCertificateError('ERR_CERT_AUTHORITY_INVALID')).toMatch(/authority this computer trusts/)
    expect(describeCertificateError('ERR_SOMETHING_NEW')).toMatch(/isn’t valid/)
  })
  test('every main-frame failure except superseded loads and download hand-offs gets the in-page error', () => {
    for (const code of [-105, -102, -130, -120, -111, -202, -201, -310, -7]) expect(shouldShowFullPageError(code)).toBe(true)
    for (const code of [-3, -2, null]) expect(shouldShowFullPageError(code)).toBe(false)
  })
})

describe('proceed-anyway exceptions', () => {
  test('per partition, host (case-insensitive) and certificate fingerprint', () => {
    const exceptions = new CertificateExceptions()
    exceptions.allow('persist:surffish-browser', '192.168.1.1', 'sha256/AAA')
    expect(exceptions.has('persist:surffish-browser', '192.168.1.1', 'sha256/AAA')).toBe(true)
    expect(exceptions.has('persist:surffish-browser', '192.168.1.1', 'sha256/BBB')).toBe(false)
    expect(exceptions.has('persist:surffish-browser', '192.168.1.2', 'sha256/AAA')).toBe(false)
    expect(exceptions.has('surffish-private', '192.168.1.1', 'sha256/AAA')).toBe(false)
    exceptions.allow('persist:surffish-browser', 'Router.Local.', 'sha256/CCC')
    expect(exceptions.has('persist:surffish-browser', 'router.local', 'sha256/CCC')).toBe(true)
    expect(exceptions.hasHost('persist:surffish-browser', '[ROUTER.local]')).toBe(true)
    expect(exceptions.hosts('persist:surffish-browser').sort()).toEqual(['192.168.1.1', 'router.local'])
  })
  test('clearing one partition (private session ended) keeps the others', () => {
    const exceptions = new CertificateExceptions()
    exceptions.allow('surffish-private', 'nas.local', 'fp')
    exceptions.allow('persist:surffish-browser', 'nas.local', 'fp')
    exceptions.clear('surffish-private')
    expect(exceptions.has('surffish-private', 'nas.local', 'fp')).toBe(false)
    expect(exceptions.has('persist:surffish-browser', 'nas.local', 'fp')).toBe(true)
    exceptions.clear()
    expect(exceptions.hasHost('persist:surffish-browser', 'nas.local')).toBe(false)
  })
  test('ignores empty hosts or fingerprints', () => {
    const exceptions = new CertificateExceptions()
    exceptions.allow('p', '', 'fp')
    exceptions.allow('p', 'a', '')
    expect(exceptions.hosts('p')).toEqual([])
  })
})

describe('helpers', () => {
  test('LRU keeps the most recently used entries', () => {
    const map = new LruMap<string, number>(2)
    map.set('a', 1)
    map.set('b', 2)
    map.get('a')
    map.set('c', 3)
    expect(map.peek('b')).toBeUndefined()
    expect(map.peek('a')).toBe(1)
    map.deleteWhere((key) => key === 'a')
    expect(map.size).toBe(1)
  })
  test('hosts, fingerprints and names', () => {
    expect(hostOfUrl('https://192.168.1.1/network/default')).toBe('192.168.1.1')
    expect(hostOfUrl('https://[fe80::1]:8443/')).toBe('fe80::1')
    expect(hostOfUrl('http://example.com/')).toBeNull()
    expect(hostOfUrl('not a url')).toBeNull()
    expect(formatFingerprint('abcd12')).toBe('AB:CD:12')
    expect(distinguishedNameText({ commonName: 'unifi.local', organization: 'Ubiquiti', organizationalUnit: null, locality: null, state: null, country: 'US' })).toBe('CN=unifi.local, O=Ubiquiti, C=US')
  })
})

describe('site menu connection summary', () => {
  test('https with a verified certificate is secure, with a certificate row', () => {
    expect(siteConnectionSummary('https://example.com/', { level: 'secure', host: 'example.com', error: null })).toMatchObject({ kind: 'secure', title: 'Connection is secure', certificateRow: 'Certificate is valid' })
    expect(siteConnectionSummary('https://intranet.corp/', { level: 'os-trusted', host: 'intranet.corp', error: 'ERR_CERT_AUTHORITY_INVALID' })).toMatchObject({ kind: 'secure', certificateRow: 'Certificate is valid' })
    expect(siteConnectionSummary('https://example.com/', null)).toMatchObject({ kind: 'secure', certificateRow: 'Certificate' })
  })
  test('a bypassed certificate or a certificate error page is not secure', () => {
    const bypassed = siteConnectionSummary('https://192.168.1.1/', { level: 'bypassed', host: '192.168.1.1', error: 'ERR_CERT_AUTHORITY_INVALID' })
    expect(bypassed).toMatchObject({ kind: 'not-secure', title: 'Connection is not secure', certificateRow: 'Certificate is not valid' })
    expect(bypassed?.detail).toContain('ERR_CERT_AUTHORITY_INVALID')
    expect(siteConnectionSummary('https://192.168.1.1/', null, 'ERR_CERT_AUTHORITY_INVALID')).toMatchObject({ kind: 'not-secure', title: 'Connection is not private', certificateRow: 'Certificate is not valid' })
  })
  test('plain HTTP is not secure (no certificate); loopback is local; other schemes have no section', () => {
    expect(siteConnectionSummary('http://example.com/', null)).toMatchObject({ kind: 'not-secure', certificateRow: null })
    expect(siteConnectionSummary('http://localhost:3000/', null)).toMatchObject({ kind: 'local', certificateRow: null })
    expect(siteConnectionSummary('http://192.168.1.10/', null)).toMatchObject({ kind: 'not-secure', certificateRow: null, detail: expect.stringContaining('local network') })
    expect(siteConnectionSummary('surffish://newtab', null)).toBeNull()
    expect(siteConnectionSummary('', null)).toBeNull()
  })
  test('an error page has no lock: nothing connected (the https scheme alone vouches for nothing)', () => {
    expect(siteConnectionSummary('https://192.168.1.10/', null, null, 'ERR_SSL_PROTOCOL_ERROR')).toMatchObject({ kind: 'error', title: 'Page didn’t load', certificateRow: null, detail: expect.stringContaining('ERR_SSL_PROTOCOL_ERROR') })
    expect(siteConnectionSummary('https://nas.lan/', null, null, 'ERR_NAME_NOT_RESOLVED')?.kind).toBe('error')
    // A certificate error page keeps its own "not private" section.
    expect(siteConnectionSummary('https://192.168.1.1/', null, 'ERR_CERT_AUTHORITY_INVALID', null)?.kind).toBe('not-secure')
  })
  test('viewer verdicts', () => {
    expect(certificateVerdict({ status: 'secure', error: null })).toMatchObject({ valid: true, title: 'Certificate is valid' })
    expect(certificateVerdict({ status: 'os-trusted', error: 'ERR_CERT_AUTHORITY_INVALID' }).detail).toMatch(/keychain/)
    expect(certificateVerdict({ status: 'bypassed', error: 'ERR_CERT_AUTHORITY_INVALID' })).toMatchObject({ valid: false })
    expect(certificateVerdict({ status: 'error', error: 'ERR_CERT_DATE_INVALID' }).detail).toMatch(/expired/)
  })
})
