import { describe, expect, test } from 'bun:test'
import {
  MINI_OMNIBOX_PADDING,
  MINI_OMNIBOX_ROW_HEIGHT,
  arrowMiniOmnibox,
  emptyMiniOmnibox,
  escapeMiniOmnibox,
  miniAddressAutoOpens,
  miniNewTabTarget,
  miniOmniboxDropdownHeight,
  miniOmniboxLimit,
  miniOmniboxRowUrl,
  miniOmniboxView,
  typedMiniOmnibox,
  type MiniOmniboxSources
} from './mini-window-omnibox'
import { omniboxSuggestions } from './autocomplete'
import { keywordSuggestionText } from './omnibox-fill'
import { DEFAULT_CUSTOM_SEARCH_ENGINES } from './search-keywords'
import { SURFFISH_QUICK_LINKS_URL } from './navigation'

const sources: MiniOmniboxSources = {
  tabs: [{ title: 'Example tab', url: 'https://example.com/tab' }],
  history: [
    { id: '1', url: 'https://example.org/one', title: 'Example One', visitedAt: 1 },
    { id: '2', url: 'https://other.test/', title: 'Other', visitedAt: 2 }
  ],
  bookmarks: [{ title: 'Example Bookmark', url: 'https://example.net/' }],
  engines: DEFAULT_CUSTOM_SEARCH_ENGINES
}

describe('mini window omnibox view', () => {
  test('rows come from the toolbar omnibox suggestions, in its order', () => {
    const view = miniOmniboxView(typedMiniOmnibox('exam'), sources)
    expect(view.rows.map((row) => row.url)).toEqual(omniboxSuggestions('exam', sources, 6).map((suggestion) => suggestion.url))
    expect(view.rows.map((row) => row.source)).toEqual(['Bookmark', 'Open tab', 'History'])
    expect(view.selected).toBe(-1)
    expect(view.keyword).toBeNull()
  })

  test('the typed text is highlighted in titles and URLs', () => {
    const [row] = miniOmniboxView(typedMiniOmnibox('bookmark'), sources).rows
    expect(row?.title.filter((part) => part.match).map((part) => part.text)).toEqual(['Bookmark'])
    expect(row?.urlParts.map((part) => part.role)).toContain('host')
  })

  test('an empty field has no rows', () => {
    expect(miniOmniboxView(emptyMiniOmnibox(), sources).rows).toEqual([])
  })

  test('keyword search shows the same row text as the toolbar', () => {
    const view = miniOmniboxView(typedMiniOmnibox('yt cats'), sources)
    expect(view.keyword).toEqual({ label: 'Search YouTube for “cats”', chip: 'yt' })
    expect(keywordSuggestionText({ engine: { name: 'YouTube', keyword: 'yt' }, query: '', via: 'bang' })).toEqual({ label: 'Open YouTube', chip: '!yt' })
  })
})

describe('mini window omnibox keys', () => {
  test('arrowing fills the field with the row URL and keeps matching what was typed', () => {
    const typed = typedMiniOmnibox('exam')
    const first = arrowMiniOmnibox(typed, sources, 'down')
    expect(first.text).toBe('https://example.net/')
    expect(first.preview).toEqual({ typed: 'exam', index: 0 })
    const view = miniOmniboxView(first, sources)
    expect(view.selected).toBe(0)
    expect(view.rows).toHaveLength(3)
    const second = arrowMiniOmnibox(first, sources, 'down')
    expect(second.text).toBe('https://example.com/tab')
    // Up from the first row comes back to the typed text.
    expect(arrowMiniOmnibox(first, sources, 'up')).toEqual({ text: 'exam', preview: null })
  })

  test('Esc puts back what was typed, then closes', () => {
    const filled = arrowMiniOmnibox(typedMiniOmnibox('exam'), sources, 'down')
    const first = escapeMiniOmnibox(filled)
    expect(first).toEqual({ kind: 'restore', model: { text: 'exam', preview: null } })
    expect(escapeMiniOmnibox(typedMiniOmnibox('exam'))).toEqual({ kind: 'close' })
  })

  test('typing again lets go of the filled-in row', () => {
    expect(typedMiniOmnibox('https://example.net/x')).toEqual({ text: 'https://example.net/x', preview: null })
  })

  test('a clicked row gives its URL', () => {
    expect(miniOmniboxRowUrl(typedMiniOmnibox('other'), sources, 0)).toBe('https://other.test/')
    expect(miniOmniboxRowUrl(typedMiniOmnibox('other'), sources, 5)).toBeNull()
  })
})

describe('mini window dropdown height', () => {
  test('whole rows, capped by the room there is', () => {
    expect(miniOmniboxDropdownHeight({ rows: [], keyword: null }, 500)).toBe(0)
    const rows = miniOmniboxView(typedMiniOmnibox('exam'), sources).rows
    expect(miniOmniboxDropdownHeight({ rows, keyword: null }, 500)).toBe(3 * MINI_OMNIBOX_ROW_HEIGHT + MINI_OMNIBOX_PADDING)
    expect(miniOmniboxDropdownHeight({ rows, keyword: { label: 'x', chip: 'y' } }, 500)).toBe(4 * MINI_OMNIBOX_ROW_HEIGHT + MINI_OMNIBOX_PADDING)
    expect(miniOmniboxDropdownHeight({ rows, keyword: null }, 2 * MINI_OMNIBOX_ROW_HEIGHT + MINI_OMNIBOX_PADDING + 5)).toBe(2 * MINI_OMNIBOX_ROW_HEIGHT + MINI_OMNIBOX_PADDING)
    expect(miniOmniboxDropdownHeight({ rows, keyword: null }, 20)).toBe(0)
  })
})

describe('mini window omnibox limit', () => {
  test('rows that fit, less one for a keyword row, at most the limit', () => {
    const room = (rows: number) => rows * MINI_OMNIBOX_ROW_HEIGHT + MINI_OMNIBOX_PADDING
    expect(miniOmniboxLimit(typedMiniOmnibox('exam'), sources, room(3))).toBe(3)
    expect(miniOmniboxLimit(typedMiniOmnibox('yt cats'), sources, room(3))).toBe(2)
    expect(miniOmniboxLimit(typedMiniOmnibox('exam'), sources, room(20))).toBe(6)
    expect(miniOmniboxLimit(typedMiniOmnibox('exam'), sources, 0)).toBe(0)
  })
})

describe('mini window New Tab', () => {
  test('the field opens by itself on a New Tab only', () => {
    expect(miniAddressAutoOpens(SURFFISH_QUICK_LINKS_URL)).toBe(true)
    expect(miniAddressAutoOpens('https://example.com/')).toBe(false)
    expect(miniAddressAutoOpens(null)).toBe(false)
  })

  test('+ joins the collection with tabs grouping, otherwise opens its own window', () => {
    expect(miniNewTabTarget('tabs')).toBe('collection')
    expect(miniNewTabTarget('stack')).toBe('window')
    expect(miniNewTabTarget('separate')).toBe('window')
  })
})
