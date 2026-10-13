import { describe, expect, test } from 'bun:test'
import { clearRangeStart, cookieMatchesHost, cookieRemovalUrl, formatStorageBytes, groupCookiesBySite, originsForHosts, originsVisitedSince, parseClearBrowsingDataOptions } from './browsing-data.ts'

const siteOf = (host: string): string => host.split('.').slice(-2).join('.')

describe('clear browsing data options', () => {
  test('ranges', () => {
    expect(clearRangeStart('all', 5_000_000)).toBe(0)
    expect(clearRangeStart('hour', 5_000_000)).toBe(5_000_000 - 3_600_000)
    expect(clearRangeStart('week', 1000)).toBe(0)
  })
  test('parse rejects junk, keeps only true flags', () => {
    expect(parseClearBrowsingDataOptions({ range: 'forever' })).toBeNull()
    expect(parseClearBrowsingDataOptions({ range: 'day', history: true, cookies: 'yes' })).toEqual({ range: 'day', history: true, downloads: false, cookies: false, cache: false, permissions: false, zoom: false })
  })
  test('origins visited in the range', () => {
    const entries = [
      { url: 'https://a.example/x', visitedAt: 100 },
      { url: 'https://a.example/y', visitedAt: 200 },
      { url: 'http://b.example/', visitedAt: 50 },
      { url: 'not a url', visitedAt: 300 }
    ]
    expect(originsVisitedSince(entries, 100)).toEqual(['https://a.example'])
    expect(originsVisitedSince(entries, 0).sort()).toEqual(['http://b.example', 'https://a.example'])
  })
})

describe('cookies', () => {
  test('matching a host: exact, parent-domain and subdomain cookies', () => {
    expect(cookieMatchesHost('.example.com', 'www.example.com')).toBe(true)
    expect(cookieMatchesHost('www.example.com', 'www.example.com')).toBe(true)
    expect(cookieMatchesHost('login.www.example.com', 'www.example.com')).toBe(true)
    expect(cookieMatchesHost('other.example.com', 'www.example.com')).toBe(false)
    expect(cookieMatchesHost('.badexample.com', 'example.com')).toBe(false)
  })
  test('removal URL', () => {
    expect(cookieRemovalUrl({ domain: '.example.com', path: '/app', secure: true })).toBe('https://example.com/app')
    expect(cookieRemovalUrl({ domain: 'example.com', secure: false })).toBe('http://example.com/')
    expect(cookieRemovalUrl({ domain: '' })).toBeNull()
  })
  test('grouped by site, sorted', () => {
    const groups = groupCookiesBySite([{ domain: '.example.com' }, { domain: 'www.example.com' }, { domain: 'www.example.com' }, { domain: 'a.test' }, {}], siteOf)
    expect(groups).toEqual([
      { site: 'a.test', cookies: 1, hosts: ['a.test'] },
      { site: 'example.com', cookies: 3, hosts: ['example.com', 'www.example.com'] }
    ])
    expect(originsForHosts(['a.test'])).toEqual(['https://a.test', 'http://a.test'])
  })
  test('storage formatting', () => {
    expect(formatStorageBytes(null)).toBe('storage unknown')
    expect(formatStorageBytes(512)).toBe('512 B')
    expect(formatStorageBytes(1536)).toBe('1.5 KB')
    expect(formatStorageBytes(25 * 1024 * 1024)).toBe('25 MB')
  })
})
