import { describe, expect, test } from 'bun:test'
import {
  matchesSettingsQuery,
  normalizeSearchText,
  parseSettingsQuery,
  SETTINGS_SEARCH_INDEX,
  settingsHighlightRanges,
  settingsMatchesElsewhere,
  splitSettingsHint
} from './settings-search'

describe('parseSettingsQuery', () => {
  test('empty and whitespace queries have no terms', () => {
    expect(parseSettingsQuery('')).toEqual([])
    expect(parseSettingsQuery('   ')).toEqual([])
  })
  test('normalizes case, accents and spacing', () => {
    expect(normalizeSearchText('  Café   ÉCRAN ')).toBe(' cafe ecran ')
    expect(parseSettingsQuery('Café  Écran').map((term) => term.term)).toEqual(['cafe', 'ecran'])
  })
  test('adds synonyms and keeps multi-word synonym keys as one phrase', () => {
    const [tray] = parseSettingsQuery('tray')
    expect(tray?.alternatives).toEqual(['tray', 'menu bar'])
    const terms = parseSettingsQuery('picture in picture opacity')
    expect(terms.map((term) => term.term)).toEqual(['picture in picture', 'opacity'])
    expect(terms[0]?.alternatives).toContain('mini window')
  })
  test('dedupes words and caps at six terms', () => {
    expect(parseSettingsQuery('tab tab tab').length).toBe(1)
    expect(parseSettingsQuery('a b c d e f g h').length).toBe(6)
  })
})

describe('matchesSettingsQuery', () => {
  test('every term must match (AND), any alternative satisfies a term', () => {
    expect(matchesSettingsQuery('Menu bar icon', parseSettingsQuery('tray'))).toBe(true)
    expect(matchesSettingsQuery('Menu bar icon', parseSettingsQuery('tray icon'))).toBe(true)
    expect(matchesSettingsQuery('Menu bar icon', parseSettingsQuery('tray opacity'))).toBe(false)
  })
  test('substring matching inside words', () => {
    expect(matchesSettingsQuery('Hibernate inactive tabs', parseSettingsQuery('hiber'))).toBe(true)
  })
  test('no terms matches everything', () => {
    expect(matchesSettingsQuery('anything', [])).toBe(true)
  })
})

describe('settingsHighlightRanges', () => {
  test('finds every occurrence, merged and sorted', () => {
    expect(settingsHighlightRanges('Tab archive: archive tabs', parseSettingsQuery('archive tab'))).toEqual([[0, 3], [4, 11], [13, 20], [21, 24]])
  })
  test('overlapping alternatives merge into one range', () => {
    expect(settingsHighlightRanges('Menu bar icon', parseSettingsQuery('menu menubar tray'))).toEqual([[0, 8]])
  })
  test('skips text whose normalized length differs (no misplaced marks)', () => {
    expect(settingsHighlightRanges('Café', parseSettingsQuery('cafe'))).toEqual([[0, 4]])
    expect(settingsHighlightRanges('Cafe\u0301', parseSettingsQuery('cafe'))).toEqual([])
  })
  test('nothing to highlight without terms', () => {
    expect(settingsHighlightRanges('Glance', [])).toEqual([])
  })
})

describe('settingsMatchesElsewhere', () => {
  test('reports other pages with matches, never the current one', () => {
    const hits = settingsMatchesElsewhere('clock', 'settings')
    expect(hits[0]?.mode).toBe('newtab')
    expect(hits.some((hit) => hit.mode === 'settings')).toBe(false)
    expect(settingsMatchesElsewhere('clock', 'newtab').some((hit) => hit.mode === 'newtab')).toBe(false)
  })
  test('Feeds and Integrations count as one page', () => {
    expect(settingsMatchesElsewhere('bramble', 'feeds')).toEqual([])
    expect(settingsMatchesElsewhere('rss', 'integrations')).toEqual([])
  })
  test('caps labels at three and sorts by count', () => {
    const hits = settingsMatchesElsewhere('show', 'settings')
    expect(hits[0]).toMatchObject({ mode: 'newtab' })
    expect(hits[0]?.labels.length).toBe(3)
    expect(hits[0]?.count).toBeGreaterThanOrEqual(4)
  })
  test('empty query: nothing', () => {
    expect(settingsMatchesElsewhere('  ', 'settings')).toEqual([])
  })
  test('index labels are unique per page', () => {
    const keys = SETTINGS_SEARCH_INDEX.map((entry) => `${entry.mode}:${entry.label}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('splitSettingsHint', () => {
  test('short hints stay whole', () => {
    expect(splitSettingsHint('Used for searches typed into the address bar.')).toEqual({ short: 'Used for searches typed into the address bar.', more: null })
  })
  test('long hints split after the first sentence', () => {
    const hint = 'Adds a Network tab that records requests from every tab. Off saves CPU and memory; turning it off also stops capture and clears recorded requests.'
    expect(splitSettingsHint(hint)).toEqual({ short: 'Adds a Network tab that records requests from every tab.', more: 'Off saves CPU and memory; turning it off also stops capture and clears recorded requests.' })
  })
  test('a very long first sentence keeps the whole hint', () => {
    const hint = `${'word '.repeat(40)}end. Second sentence here.`
    expect(splitSettingsHint(hint).more).toBeNull()
  })
  test('does not split inside e.g., numbers or dotted names', () => {
    const hint = 'Private addresses (192.168.x.x, 10.x.x.x) and .local names skip the proxy, so your router opens like in other browsers. Turn off to send them through the tunnel too.'
    expect(splitSettingsHint(hint).short).toBe('Private addresses (192.168.x.x, 10.x.x.x) and .local names skip the proxy, so your router opens like in other browsers.')
    expect(splitSettingsHint(`Opens it (e.g. claude.ai or chatgpt.com) on top of everything else you have open right now. Second.`).short).toMatch(/chatgpt\.com\) on top/)
  })
})
