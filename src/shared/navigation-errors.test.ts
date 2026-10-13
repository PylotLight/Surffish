import { describe, expect, test } from 'bun:test'
import { describeLoadError, isAbortedNavigation, NET_ERR_ABORTED, parseLoadError, shouldShowFullPageError } from './navigation-errors.ts'

describe('parseLoadError', () => {
  test('did-fail-load shape', () => {
    expect(parseLoadError('ERR_NAME_NOT_RESOLVED (-105)')).toEqual({ code: -105, name: 'ERR_NAME_NOT_RESOLVED' })
  })
  test('loadURL rejection shape', () => {
    expect(parseLoadError("ERR_CONNECTION_REFUSED (-102) loading 'http://127.0.0.1:9/'")).toEqual({ code: -102, name: 'ERR_CONNECTION_REFUSED' })
  })
  test('bare net:: name fills the code in', () => {
    expect(parseLoadError('net::ERR_PROXY_CONNECTION_FAILED')).toEqual({ code: -130, name: 'ERR_PROXY_CONNECTION_FAILED' })
  })
  test('code only fills the name in', () => {
    expect(parseLoadError(' (-118)')).toEqual({ code: -118, name: 'ERR_CONNECTION_TIMED_OUT' })
  })
  test('junk', () => {
    expect(parseLoadError('something broke')).toEqual({ code: null, name: null })
    expect(parseLoadError(null)).toEqual({ code: null, name: null })
  })
})

describe('isAbortedNavigation', () => {
  test('loadURL ERR_ABORTED rejections are superseded loads', () => {
    const error = Object.assign(new Error("ERR_ABORTED (-3) loading 'https://www.youtube.com/post/abc'"), { errno: -3, code: 'ERR_ABORTED' })
    expect(isAbortedNavigation(error)).toBe(true)
    expect(isAbortedNavigation(new Error("ERR_ABORTED (-3) loading 'https://x.test/'"))).toBe(true)
    expect(isAbortedNavigation({ errno: NET_ERR_ABORTED })).toBe(true)
    expect(isAbortedNavigation(NET_ERR_ABORTED)).toBe(true)
    expect(isAbortedNavigation('ERR_ABORTED (-3)')).toBe(true)
  })
  test('real failures are not', () => {
    expect(isAbortedNavigation(new Error("ERR_NAME_NOT_RESOLVED (-105) loading 'https://nope.invalid/'"))).toBe(false)
    expect(isAbortedNavigation(new Error('ERR_FAILED (-2)'))).toBe(false)
    expect(isAbortedNavigation(null)).toBe(false)
    expect(isAbortedNavigation(-105)).toBe(false)
  })
})

describe('describeLoadError', () => {
  test('unresolvable host', () => {
    const copy = describeLoadError({ message: 'ERR_NAME_NOT_RESOLVED (-105)', url: 'https://nope.invalid/x' })
    expect(copy.kind).toBe('dns')
    expect(copy.title).toBe('Can’t find that site')
    expect(copy.detail).toContain('nope.invalid')
    expect(copy.mentionsProxy).toBe(false)
    expect(copy.detail).not.toContain('proxy')
    expect(copy.codeLabel).toBe('ERR_NAME_NOT_RESOLVED')
  })
  test('mentions the proxy only when a proxy route applies', () => {
    const direct = describeLoadError({ code: -102, url: 'https://a.test/' })
    expect(direct.kind).toBe('refused')
    expect(direct.mentionsProxy).toBe(false)
    const proxied = describeLoadError({ code: -102, url: 'https://a.test/', viaProxy: true })
    expect(proxied.mentionsProxy).toBe(true)
    expect(proxied.detail).toContain('tunnel')
  })
  test('proxy errors always mention the proxy', () => {
    for (const message of ['ERR_PROXY_CONNECTION_FAILED (-130)', 'ERR_SOCKS_CONNECTION_FAILED (-120)', 'ERR_SOCKS_CONNECTION_HOST_UNREACHABLE (-121)', 'ERR_TUNNEL_CONNECTION_FAILED (-111)']) {
      const copy = describeLoadError({ message, url: 'https://a.test/' })
      expect(copy.kind).toBe('proxy')
      expect(copy.mentionsProxy).toBe(true)
    }
  })
  test('timeouts, offline, certs, connection drops', () => {
    expect(describeLoadError({ code: -118, url: 'https://slow.test/' }).title).toBe('slow.test took too long to respond')
    expect(describeLoadError({ code: -7, url: 'https://slow.test/' }).kind).toBe('timeout')
    const offline = describeLoadError({ code: -106, url: 'https://a.test/', viaProxy: true })
    expect(offline.title).toBe('You’re offline')
    expect(offline.mentionsProxy).toBe(false)
    expect(describeLoadError({ code: -202, url: 'https://self-signed.test/' }).kind).toBe('certificate')
    expect(describeLoadError({ code: -299, url: 'https://x.test/' }).kind).toBe('certificate')
    expect(describeLoadError({ name: 'ERR_SSL_PROTOCOL_ERROR', url: 'https://x.test/' }).kind).toBe('secure-connection')
    expect(describeLoadError({ code: -101, url: 'https://x.test/' }).kind).toBe('connection')
    expect(describeLoadError({ code: -324, url: 'https://x.test/' }).kind).toBe('connection')
    expect(describeLoadError({ code: -310, url: 'https://x.test/' }).kind).toBe('redirects')
  })
  test('blocked pages only blame the kill switch when proxied', () => {
    expect(describeLoadError({ code: -20, url: 'https://x.test/' }).detail).not.toContain('proxy')
    expect(describeLoadError({ code: -20, url: 'https://x.test/', viaProxy: true }).detail).toContain('proxy')
  })
  test('unknown errors fall back to a generic line with the code', () => {
    const copy = describeLoadError({ message: 'ERR_WEIRD_THING (-999)', url: 'https://x.test/' })
    expect(copy.kind).toBe('generic')
    expect(copy.title).toBe('Couldn’t open this page')
    expect(copy.codeLabel).toBe('ERR_WEIRD_THING')
    expect(describeLoadError({ message: 'boom' }).codeLabel).toBe('')
  })
})

test('full-page error only for real main-frame failures', () => {
  expect(shouldShowFullPageError(-105)).toBe(true)
  expect(shouldShowFullPageError(-3)).toBe(false)
  expect(shouldShowFullPageError(-2)).toBe(false)
  expect(shouldShowFullPageError(null)).toBe(false)
})
