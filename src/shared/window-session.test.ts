import { describe, expect, test } from 'bun:test'
import { MAX_RESTORED_WINDOWS, normalizeWindowsSession, parseWindowsSession, serializeWindowsSession } from './window-session'
import { parseBrowserSession } from './persistence'

const geometry = { bounds: { x: 10, y: 20, width: 1200, height: 800 }, maximized: false, fullScreen: false }

describe('window session', () => {
  test('round-trips several windows with their own tabs, active tab, pins and geometry', () => {
    const session = normalizeWindowsSession([
      { urls: ['https://a.example/', 'https://b.example/'], activeIndex: 1, pinnedIndexes: [0], geometry },
      { urls: ['https://c.example/'], activeIndex: 0, pinnedIndexes: [], geometry: null }
    ], 0)
    const parsed = parseWindowsSession(JSON.parse(JSON.stringify(serializeWindowsSession(session))))
    expect(parsed).toEqual(session)
    expect(parsed.windows[0]).toEqual({ urls: ['https://a.example/', 'https://b.example/'], activeIndex: 1, pinnedIndexes: [0], geometry })
    expect(parsed.windows[1]?.geometry).toBeNull()
    expect(parsed.focusedIndex).toBe(0)
  })

  test('older builds still read the focused window from the top-level fields', () => {
    const session = normalizeWindowsSession([
      { urls: ['https://a.example/'], activeIndex: 0, pinnedIndexes: [], geometry: null },
      { urls: ['https://b.example/', 'https://c.example/'], activeIndex: 1, pinnedIndexes: [1], geometry: null }
    ], 1)
    const legacy = parseBrowserSession(serializeWindowsSession(session))
    expect(legacy).toEqual({ urls: ['https://b.example/', 'https://c.example/'], activeIndex: 1, pinnedIndexes: [1] })
  })

  test('migrates the single-window format, placed by window-state.json', () => {
    const parsed = parseWindowsSession({ version: 1, tabs: ['https://a.example/', 'javascript:alert(1)', 'https://b.example/'], activeIndex: 2, pinnedTabs: [2] }, geometry)
    expect(parsed).toEqual({ windows: [{ urls: ['https://a.example/', 'https://b.example/'], activeIndex: 1, pinnedIndexes: [1], geometry }], focusedIndex: 0 })
  })

  test('nothing saved gives one empty window', () => {
    expect(parseWindowsSession(null)).toEqual({ windows: [{ urls: [], activeIndex: 0, pinnedIndexes: [], geometry: null }], focusedIndex: 0 })
  })

  test('drops windows without restorable tabs and keeps the focused index pointing at the same window', () => {
    const session = normalizeWindowsSession([
      { urls: ['file:///tmp/x.pdf'], activeIndex: 0, pinnedIndexes: [], geometry: null },
      { urls: ['https://a.example/'], activeIndex: 0, pinnedIndexes: [], geometry: null },
      { urls: ['https://b.example/'], activeIndex: 0, pinnedIndexes: [], geometry: null }
    ], 2)
    expect(session.windows.map((window) => window.urls[0])).toEqual(['https://a.example/', 'https://b.example/'])
    expect(session.focusedIndex).toBe(1)
  })

  test('ignores bad geometry and caps the number of windows', () => {
    const windows = Array.from({ length: MAX_RESTORED_WINDOWS + 3 }, (_, index) => ({ tabs: [`https://w${index}.example/`], bounds: { x: 0, y: 0, width: -5, height: 10 } }))
    const parsed = parseWindowsSession({ version: 1, tabs: [], windows, focusedWindow: 99 })
    expect(parsed.windows).toHaveLength(MAX_RESTORED_WINDOWS)
    expect(parsed.windows.every((window) => window.geometry === null)).toBe(true)
    expect(parsed.focusedIndex).toBe(MAX_RESTORED_WINDOWS - 1)
  })

  test('falls back to the top-level tabs when the windows list is unusable', () => {
    const parsed = parseWindowsSession({ version: 1, tabs: ['https://a.example/'], activeIndex: 0, windows: [{ tabs: ['nope'] }] })
    expect(parsed.windows).toEqual([{ urls: ['https://a.example/'], activeIndex: 0, pinnedIndexes: [], geometry: null }])
  })
})
