import { describe, expect, test } from 'bun:test'
import {
  addSpace,
  adjacentSpaceId,
  DEFAULT_SPACE_ID,
  defaultSpacesSettings,
  MAX_SPACES,
  moveSpace,
  normalizeSpaceIcon,
  parseSavedWindowSpaces,
  parseSpacesSettings,
  partitionForSpace,
  placeRestoredTabs,
  removeSpace,
  resolveSpaceId,
  serializeSpacesSettings,
  spaceIdAtNumber,
  spaceRoutingInput,
  SPACE_MAIN_PROXY_NAME,
  updateSpace,
  type SpacesSettings
} from './spaces'
import { buildPacScript, effectiveRouteForHost, activeProxyEndpoints, type ProxyRoutingInput } from './proxy-routing'
import { normalizeWindowsSession, parseWindowsSession, serializeWindowsSession } from './window-session'

const PROFILE = 'persist:surffish-browser'

function seq(...values: number[]): () => number {
  let index = 0
  return () => values[index++ % values.length]!
}

function withSpaces(): SpacesSettings {
  let settings: SpacesSettings = { ...defaultSpacesSettings(), enabled: true }
  settings = addSpace(settings, { name: 'Work', icon: '💼', partitioned: true }, seq(0.1)).settings
  settings = addSpace(settings, { name: 'Fun' }, seq(0.2)).settings
  return settings
}

describe('space model', () => {
  test('off by default with only Default, on the profile partition', () => {
    const settings = defaultSpacesSettings()
    expect(settings.enabled).toBe(false)
    expect(settings.spaces.map((space) => space.id)).toEqual([DEFAULT_SPACE_ID])
    expect(partitionForSpace(settings.spaces[0], PROFILE)).toBe(PROFILE)
    expect(parseSpacesSettings(null)).toEqual(settings)
    expect(parseSpacesSettings('junk')).toEqual(settings)
  })

  test('add picks a free colour and a fresh id; names and icons are cleaned', () => {
    const settings = withSpaces()
    const [, work, fun] = settings.spaces
    expect(work!.name).toBe('Work')
    expect(work!.icon).toBe('💼')
    expect(work!.color).not.toBe(settings.spaces[0]!.color)
    expect(fun!.color).not.toBe(work!.color)
    expect(work!.id).not.toBe(fun!.id)
    expect(work!.id).toMatch(/^s[0-9a-z]{6}$/)
    expect(addSpace(settings, { name: '   ' }).space.name).toBe('Space 4')
    expect(addSpace(settings, { name: 'x'.repeat(80) }).space.name).toHaveLength(32)
    expect(normalizeSpaceIcon('<b>')).toBe('')
    expect(normalizeSpaceIcon('abc')).toBe('')
    expect(normalizeSpaceIcon('🎨')).toBe('🎨')
  })

  test('caps the number of Spaces', () => {
    let settings = withSpaces()
    while (settings.spaces.length < MAX_SPACES) settings = addSpace(settings).settings
    expect(() => addSpace(settings)).toThrow()
  })

  test('rename / recolour / partition / proxy; Default keeps its partition and proxy', () => {
    let settings = withSpaces()
    const work = settings.spaces[1]!
    settings = updateSpace(settings, work.id, { name: 'Job', color: 'green', proxy: 'direct' })
    expect(settings.spaces[1]).toMatchObject({ name: 'Job', color: 'green', proxy: 'direct', partitioned: true })
    expect(partitionForSpace(settings.spaces[1], PROFILE)).toBe(`persist:surffish-space-${work.id}`)
    // Turning separate logins off drops the forced proxy (Chromium proxies are per session).
    settings = updateSpace(settings, work.id, { partitioned: false })
    expect(settings.spaces[1]).toMatchObject({ partitioned: false, proxy: 'inherit' })
    expect(partitionForSpace(settings.spaces[1], PROFILE)).toBe(PROFILE)
    // A proxy on a shared-session Space can't stick.
    settings = updateSpace(settings, work.id, { proxy: 'proxy' })
    expect(settings.spaces[1]!.proxy).toBe('inherit')
    settings = updateSpace(settings, DEFAULT_SPACE_ID, { name: 'Home', partitioned: true, proxy: 'direct' })
    expect(settings.spaces[0]).toMatchObject({ name: 'Home', partitioned: false, proxy: 'inherit' })
    expect(() => updateSpace(settings, work.id, { proxy: 'nonsense' })).toThrow()
  })

  test('reorder, delete (never Default), neighbours and numbers', () => {
    let settings = withSpaces()
    const [def, work, fun] = settings.spaces.map((space) => space.id) as [string, string, string]
    settings = moveSpace(settings, fun!, 0)
    expect(settings.spaces.map((space) => space.id)).toEqual([fun, def, work])
    expect(moveSpace(settings, work!, 99).spaces.at(-1)!.id).toBe(work!)
    expect(adjacentSpaceId(settings, fun!, -1)).toBeNull()
    expect(adjacentSpaceId(settings, fun!, 1)).toBe(def!)
    expect(spaceIdAtNumber(settings, 3)).toBe(work!)
    expect(spaceIdAtNumber(settings, 4)).toBeNull()
    expect(removeSpace(settings, DEFAULT_SPACE_ID)).toBe(settings)
    expect(removeSpace(settings, work!).spaces.map((space) => space.id)).toEqual([fun, def])
  })

  test('the saved file round-trips; bad entries are dropped and Default comes back', () => {
    const settings = withSpaces()
    expect(parseSpacesSettings(JSON.parse(JSON.stringify(serializeSpacesSettings(settings))))).toEqual(settings)
    const parsed = parseSpacesSettings({ enabled: true, spaces: [{ id: 'BAD ID' }, { id: 'abc', name: 'A', color: 'chartreuse', partitioned: true, proxy: 'ftp' }, { id: 'abc' }] })
    expect(parsed.spaces.map((space) => space.id)).toEqual([DEFAULT_SPACE_ID, 'abc'])
    expect(parsed.spaces[1]).toMatchObject({ color: 'blue', partitioned: true, proxy: 'inherit' })
  })

  test('unknown Spaces and Spaces off resolve to Default', () => {
    const settings = withSpaces()
    const work = settings.spaces[1]!.id
    expect(resolveSpaceId(settings, work)).toBe(work)
    expect(resolveSpaceId(settings, 'gone')).toBe(DEFAULT_SPACE_ID)
    expect(resolveSpaceId({ ...settings, enabled: false }, work)).toBe(DEFAULT_SPACE_ID)
  })
})

describe('session migration', () => {
  const urls = ['https://a.example/', 'https://b.example/', 'https://c.example/']

  test('an old session (no spaces) puts every tab in Default', () => {
    const session = parseWindowsSession({ version: 1, tabs: urls, activeIndex: 1, pinnedTabs: [] })
    expect(session.windows[0]!.spaces).toBeUndefined()
    const placed = placeRestoredTabs(withSpaces(), session.windows[0]!.spaces, urls.length)
    expect(placed).toEqual({ tabSpaces: [DEFAULT_SPACE_ID, DEFAULT_SPACE_ID, DEFAULT_SPACE_ID], activeSpace: DEFAULT_SPACE_ID })
  })

  test('round-trips per-tab Spaces, the active Space and each Space\'s last tab', () => {
    const spaces = { tabSpaces: ['default', 'work', 'work'], activeSpace: 'work', spaceActiveTabs: { work: 2, default: 0 } }
    const session = normalizeWindowsSession([{ urls, activeIndex: 2, pinnedIndexes: [], geometry: null, spaces }], 0)
    const parsed = parseWindowsSession(JSON.parse(JSON.stringify(serializeWindowsSession(session))))
    expect(parsed.windows[0]!.spaces).toEqual(spaces)
  })

  test('re-points Spaces when unsafe tabs are dropped', () => {
    const spaces = { tabSpaces: ['work', 'default', 'fun'], activeSpace: 'fun', spaceActiveTabs: { fun: 2, work: 0 } }
    const session = normalizeWindowsSession([{ urls: ['https://a.example/', 'javascript:alert(1)', 'https://c.example/'], activeIndex: 2, pinnedIndexes: [], geometry: null, spaces }], 0)
    expect(session.windows[0]!.urls).toEqual(['https://a.example/', 'https://c.example/'])
    expect(session.windows[0]!.spaces).toEqual({ tabSpaces: ['work', 'fun'], activeSpace: 'fun', spaceActiveTabs: { fun: 1, work: 0 } })
  })

  test('everything in Default writes nothing (the file stays like before Spaces)', () => {
    const session = normalizeWindowsSession([{ urls, activeIndex: 0, pinnedIndexes: [], geometry: null, spaces: { tabSpaces: ['default', 'default', 'default'], activeSpace: 'default' } }], 0)
    expect(session.windows[0]!.spaces).toBeUndefined()
    expect(JSON.stringify(serializeWindowsSession(session))).not.toContain('spaces')
  })

  test('untrusted data: bad ids become Default, out-of-range active tabs are dropped', () => {
    expect(parseSavedWindowSpaces({ tabSpaces: ['work', 42, 'BAD'], activeSpace: '../x', spaceActiveTabs: { work: 0, fun: 9, default: 1 } }, 3))
      .toEqual({ tabSpaces: ['work', 'default', 'default'], activeSpace: 'default', spaceActiveTabs: { work: 0, default: 1 } })
    expect(parseSavedWindowSpaces('nope', 3)).toBeNull()
  })

  test('deleted Spaces (or Spaces off) fold into Default at restore', () => {
    const settings = withSpaces()
    const work = settings.spaces[1]!.id
    const saved = { tabSpaces: [work, 'deleted', DEFAULT_SPACE_ID], activeSpace: 'deleted' }
    expect(placeRestoredTabs(settings, saved, 3)).toEqual({ tabSpaces: [work, DEFAULT_SPACE_ID, DEFAULT_SPACE_ID], activeSpace: DEFAULT_SPACE_ID })
    expect(placeRestoredTabs({ ...settings, enabled: false }, saved, 3).tabSpaces).toEqual([DEFAULT_SPACE_ID, DEFAULT_SPACE_ID, DEFAULT_SPACE_ID])
  })
})

describe('Space proxy precedence', () => {
  const input: ProxyRoutingInput = {
    primary: { enabled: false, host: '127.0.0.1', port: 1080 },
    proxies: [{ name: 'nas', host: '127.0.0.1', port: 9050 }],
    rules: [
      { pattern: '*.netflix.com', route: 'direct' },
      { pattern: '*.bank.example', route: 'proxy' },
      { pattern: 'tor.example', route: 'proxy:nas' }
    ]
  }

  test('inherit = Settings, unchanged', () => {
    const result = spaceRoutingInput(input, 'inherit')
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
  })

  test('direct: unruled sites go direct, proxy rules still proxy', () => {
    const result = spaceRoutingInput({ ...input, primary: { ...input.primary, enabled: true } }, 'direct')
    expect(effectiveRouteForHost('example.org', result).kind).toBe('direct')
    expect(effectiveRouteForHost('www.bank.example', result)).toMatchObject({ kind: 'proxy', port: 1080 })
    expect(effectiveRouteForHost('tor.example', result)).toMatchObject({ kind: 'proxy', port: 9050 })
  })

  test('a forced named proxy: unruled and Direct-rule sites go through it, other proxy rules keep theirs', () => {
    const result = spaceRoutingInput(input, 'proxy:nas')
    expect(effectiveRouteForHost('example.org', result)).toMatchObject({ kind: 'proxy', port: 9050 })
    // A Direct rule can't punch through a proxied Space.
    expect(effectiveRouteForHost('www.netflix.com', result)).toMatchObject({ kind: 'proxy', port: 9050 })
    // "Main proxy" rules still use the main proxy.
    expect(effectiveRouteForHost('www.bank.example', result)).toMatchObject({ kind: 'proxy', port: 1080, name: SPACE_MAIN_PROXY_NAME })
    expect(effectiveRouteForHost('localhost', result).kind).toBe('direct')
    expect(effectiveRouteForHost('nas', result).kind).toBe('direct')
    const pac = buildPacScript(result)
    expect(pac).not.toContain('"DIRECT"]')
    expect(pac).toContain('var FALLBACK = "SOCKS5 127.0.0.1:9050"')
    // The kill switch watches both proxies this Space can use.
    expect(activeProxyEndpoints(result).map((endpoint) => endpoint.port).sort()).toEqual([1080, 9050])
  })

  test('a forced main proxy works with the main proxy off in Settings', () => {
    const result = spaceRoutingInput(input, 'proxy')
    expect(effectiveRouteForHost('example.org', result)).toMatchObject({ kind: 'proxy', port: 1080 })
    expect(effectiveRouteForHost('www.netflix.com', result)).toMatchObject({ kind: 'proxy', port: 1080 })
  })

  test('a forced proxy that was removed fails closed onto the main proxy, never direct', () => {
    const result = spaceRoutingInput(input, 'proxy:gone')
    expect(effectiveRouteForHost('example.org', result)).toMatchObject({ kind: 'proxy', port: 1080 })
  })
})
