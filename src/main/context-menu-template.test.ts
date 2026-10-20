import { describe, expect, mock, test } from 'bun:test'
import type { MenuItemConstructorOptions } from 'electron'
import { buildBrowserContextMenuTemplate, MAX_SPELLING_SUGGESTIONS, normalizeContextMenuParams, spellingMenuItems, type ContextMenuActions, type ContextMenuParamsInput, type ContextMenuTemplateOptions } from './context-menu-template.ts'

const EDIT_FLAGS = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false }

function params(overrides: Partial<ContextMenuParamsInput> = {}): ContextMenuParamsInput {
  return {
    x: 10,
    y: 20,
    isEditable: false,
    editFlags: EDIT_FLAGS,
    selectionText: '',
    linkURL: '',
    srcURL: '',
    mediaType: 'none',
    hasImageContents: false,
    misspelledWord: '',
    dictionarySuggestions: [],
    spellcheckEnabled: false,
    pageURL: 'https://example.com/page',
    suggestedFilename: '',
    ...overrides
  }
}

function actions(): ContextMenuActions & Record<string, ReturnType<typeof mock>> {
  const names = ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'selectAll', 'replaceMisspelling', 'addToDictionary', 'writeClipboard', 'copyImageAt', 'openInNewTab', 'openInBackgroundTab', 'saveUrl', 'savePage', 'goBack', 'goForward', 'reload', 'print', 'inspect']
  return Object.fromEntries(names.map((name) => [name, mock(() => undefined)])) as unknown as ContextMenuActions & Record<string, ReturnType<typeof mock>>
}

const PAGE: ContextMenuTemplateOptions = { pageActions: true, searchEngine: 'duckduckgo', canGoBack: true, canGoForward: false }

function labels(items: MenuItemConstructorOptions[]): string[] {
  return items.map((item) => item.type === 'separator' ? '—' : String(item.label))
}

function click(item: MenuItemConstructorOptions | undefined): void {
  ;(item?.click as unknown as (() => void) | undefined)?.()
}

describe('spelling suggestions', () => {
  test('macOS regression: suggestions show even when Electron reports spellcheckEnabled false', () => {
    const fns = actions()
    const items = buildBrowserContextMenuTemplate(params({ isEditable: true, misspelledWord: 'notifcations', dictionarySuggestions: ['notifications', 'notification'], spellcheckEnabled: false }), PAGE, fns)
    expect(labels(items).slice(0, 6)).toEqual(['notifications', 'notification', '—', 'Add to Dictionary', '—', 'Undo'])
    click(items[0])
    expect(fns.replaceMisspelling).toHaveBeenCalledWith('notifications')
    click(items[3])
    expect(fns.addToDictionary).toHaveBeenCalledWith('notifcations')
  })

  test('spelling block sits above the edit actions, which stay intact', () => {
    const items = buildBrowserContextMenuTemplate(params({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the'] }), PAGE, actions())
    const all = labels(items)
    expect(all.indexOf('the')).toBeLessThan(all.indexOf('Undo'))
    for (const label of ['Cut', 'Copy', 'Paste', 'Paste and Match Style', 'Delete', 'Select All', 'Back', 'Reload', 'Inspect']) expect(all).toContain(label)
  })

  test('no guesses still offers Add to Dictionary', () => {
    const items = spellingMenuItems({ isEditable: true, misspelledWord: 'zzqx', dictionarySuggestions: [] }, actions())
    expect(labels(items)).toEqual(['No Guesses Found', '—', 'Add to Dictionary'])
    expect(items[0]?.enabled).toBe(false)
  })

  test('caps the number of suggestions', () => {
    const many = Array.from({ length: 12 }, (_value, index) => `word${index}`)
    const items = spellingMenuItems({ isEditable: true, misspelledWord: 'wrod', dictionarySuggestions: many }, actions())
    expect(items.filter((item) => item.label?.startsWith('word'))).toHaveLength(MAX_SPELLING_SUGGESTIONS)
  })

  test('nothing for correctly spelled words or non-editable text', () => {
    expect(spellingMenuItems({ isEditable: true, misspelledWord: '', dictionarySuggestions: [] }, actions())).toEqual([])
    expect(spellingMenuItems({ isEditable: false, misspelledWord: 'teh', dictionarySuggestions: ['the'] }, actions())).toEqual([])
    const items = buildBrowserContextMenuTemplate(params({ isEditable: true }), PAGE, actions())
    expect(labels(items)[0]).toBe('Undo')
    expect(labels(items)).not.toContain('Add to Dictionary')
  })
})

describe('rest of the menu', () => {
  test('links get open/save/copy items and no trailing separator', () => {
    const fns = actions()
    const items = buildBrowserContextMenuTemplate(params({ linkURL: 'https://example.com/?utm_source=x&id=1' }), PAGE, fns)
    expect(labels(items)).toContain('Open Link in New Tab')
    expect(items.at(-1)?.type).not.toBe('separator')
    click(items.find((item) => item.label === 'Copy Clean Link'))
    expect(fns.writeClipboard).toHaveBeenCalledWith('https://example.com/?id=1')
  })

  test('non-page surfaces only get Select All for plain right-clicks', () => {
    expect(labels(buildBrowserContextMenuTemplate(params(), { ...PAGE, pageActions: false }, actions()))).toEqual(['Select All'])
  })

  test('PDF editor tabs swap page actions for Save / Back to Viewer', () => {
    expect(labels(buildBrowserContextMenuTemplate(params(), { ...PAGE, pdfEditor: true }, actions()))).toEqual(['Save PDF…', 'Back to Viewer', '—', 'Inspect'])
  })

  test('Take Screenshot… sits with the page actions only when offered', () => {
    expect(labels(buildBrowserContextMenuTemplate(params(), PAGE, actions()))).not.toContain('Take Screenshot…')
    const takeScreenshot = mock(() => undefined)
    const items = buildBrowserContextMenuTemplate(params(), { ...PAGE, hasScreenshot: true }, { ...actions(), takeScreenshot })
    const names = labels(items)
    expect(names.indexOf('Take Screenshot…')).toBe(names.indexOf('Save Page As…') + 1)
    click(items.find((item) => item.label === 'Take Screenshot…'))
    expect(takeScreenshot).toHaveBeenCalledTimes(1)
  })
})

describe('reader view and page watchers', () => {
  test('page menu offers Reader View and both watch items when the host allows them', () => {
    const fns = { ...actions(), readerView: mock(() => undefined), watchPage: mock((_mode: 'page' | 'pick') => undefined) }
    const items = buildBrowserContextMenuTemplate(params(), { ...PAGE, hasReaderView: true, canWatchPage: true }, fns)
    const all = labels(items)
    expect(all).toContain('Reader View')
    expect(all).toContain('Watch This Page for Changes…')
    expect(all).toContain('Watch Part of This Page…')
    click(items.find((item) => item.label === 'Watch Part of This Page…'))
    expect(fns.watchPage).toHaveBeenCalledWith('pick')
    click(items.find((item) => item.label === 'Reader View'))
    expect(fns.readerView).toHaveBeenCalled()
  })

  test('no watch items without permission (private tabs) or on PDFs', () => {
    expect(labels(buildBrowserContextMenuTemplate(params(), PAGE, actions()))).not.toContain('Watch This Page for Changes…')
    const pdf = labels(buildBrowserContextMenuTemplate(params({ pageURL: 'https://example.com/a.pdf' }), { ...PAGE, pdfDocument: true, canWatchPage: true, hasReaderView: true }, actions()))
    expect(pdf).not.toContain('Watch This Page for Changes…')
    expect(pdf).not.toContain('Reader View')
  })
})

describe('Read Aloud items', () => {
  test('page menu offers Read Aloud, a selection offers Read Selection Aloud, a reading offers Stop', () => {
    const calls: unknown[][] = []
    const fns = { ...actions(), readAloud: (...args: unknown[]) => { calls.push(args) } }
    const page = buildBrowserContextMenuTemplate(params(), { ...PAGE, canReadAloud: true }, fns)
    expect(labels(page)).toContain('Read Aloud')
    click(page.find((item) => item.label === 'Read Aloud'))
    const selected = buildBrowserContextMenuTemplate(params({ selectionText: '  Some words.  ' }), { ...PAGE, canReadAloud: true }, fns)
    expect(labels(selected)).toContain('Read Selection Aloud')
    expect(labels(selected)).not.toContain('Read Aloud')
    click(selected.find((item) => item.label === 'Read Selection Aloud'))
    const reading = buildBrowserContextMenuTemplate(params(), { ...PAGE, canReadAloud: true, readingAloud: true }, fns)
    expect(labels(reading)).toContain('Stop Reading Aloud')
    click(reading.find((item) => item.label === 'Stop Reading Aloud'))
    expect(calls).toEqual([['page'], ['selection', 'Some words.'], ['stop']])
  })

  test('nothing while Read Aloud is off, or on PDFs', () => {
    expect(labels(buildBrowserContextMenuTemplate(params(), PAGE, actions()))).not.toContain('Read Aloud')
    expect(labels(buildBrowserContextMenuTemplate(params({ selectionText: 'x' }), PAGE, actions()))).not.toContain('Read Selection Aloud')
    expect(labels(buildBrowserContextMenuTemplate(params(), { ...PAGE, pdfDocument: true, canReadAloud: true }, actions()))).not.toContain('Read Aloud')
  })
})

describe('Reading List items', () => {
  test('a link offers Add Link to Reading List (with the link text as the title) only when allowed', () => {
    const calls: unknown[] = []
    const withReadingList = { ...actions(), addToReadingList: (target: unknown) => { calls.push(target) } }
    const link = params({ linkURL: 'https://example.com/story#top', linkText: '  A story  ' })
    expect(labels(buildBrowserContextMenuTemplate(link, PAGE, withReadingList))).not.toContain('Add Link to Reading List')
    const items = buildBrowserContextMenuTemplate(link, { ...PAGE, canAddToReadingList: true }, withReadingList)
    click(items.find((item) => item.label === 'Add Link to Reading List'))
    expect(calls).toEqual([{ url: 'https://example.com/story#top', title: 'A story' }])
    expect(labels(items)).not.toContain('Add Page to Reading List')
  })

  test('a page offers Add Page to Reading List; never without permission or on non-web pages', () => {
    const calls: unknown[] = []
    const withReadingList = { ...actions(), addToReadingList: (target: unknown) => { calls.push(target) } }
    const items = buildBrowserContextMenuTemplate(params(), { ...PAGE, canAddToReadingList: true }, withReadingList)
    click(items.find((item) => item.label === 'Add Page to Reading List'))
    expect(calls).toEqual(['page'])
    expect(labels(buildBrowserContextMenuTemplate(params(), PAGE, withReadingList))).not.toContain('Add Page to Reading List')
    expect(labels(buildBrowserContextMenuTemplate(params({ pageURL: 'about:blank' }), { ...PAGE, canAddToReadingList: true }, withReadingList))).not.toContain('Add Page to Reading List')
  })
})

describe('Glance item', () => {
  test('a link offers Open Link in Glance right after the tab items, only when allowed', () => {
    const link = params({ linkURL: 'https://example.com/story' })
    expect(labels(buildBrowserContextMenuTemplate(link, PAGE, actions()))).not.toContain('Open Link in Glance')
    const fns = { ...actions(), openInGlance: mock(() => undefined) }
    const items = buildBrowserContextMenuTemplate(link, { ...PAGE, canOpenInGlance: true }, fns)
    const all = labels(items)
    expect(all.indexOf('Open Link in Glance')).toBe(all.indexOf('Open Link in Background Tab') + 1)
    click(items.find((item) => item.label === 'Open Link in Glance'))
    expect(fns.openInGlance).toHaveBeenCalledWith('https://example.com/story')
  })

  test('never on non-http links, without a link, or off site pages', () => {
    const options = { ...PAGE, canOpenInGlance: true }
    expect(labels(buildBrowserContextMenuTemplate(params({ linkURL: 'javascript:alert(1)' }), options, actions()))).not.toContain('Open Link in Glance')
    expect(labels(buildBrowserContextMenuTemplate(params(), options, actions()))).not.toContain('Open Link in Glance')
    expect(labels(buildBrowserContextMenuTemplate(params({ linkURL: 'https://example.com/' }), { ...options, pageActions: false }, actions()))).not.toContain('Open Link in Glance')
  })
})

describe('partial params (synthetic context-menu events)', () => {
  test('only x/y: no TypeError, a page menu still builds', () => {
    const partial = { x: 4, y: 5 } as unknown as ContextMenuParamsInput
    const items = buildBrowserContextMenuTemplate(partial, PAGE, actions())
    expect(labels(items)).toContain('Back')
  })

  test('normalize fills strings, flags and coordinates', () => {
    const normalized = normalizeContextMenuParams({ x: Number.NaN, selectionText: undefined, dictionarySuggestions: [1, 'word'] } as unknown as ContextMenuParamsInput)
    expect(normalized.x).toBe(0)
    expect(normalized.y).toBe(0)
    expect(normalized.selectionText).toBe('')
    expect(normalized.editFlags.canCopy).toBe(false)
    expect(normalized.dictionarySuggestions).toEqual(['word'])
    expect(normalized.mediaType).toBe('none')
    expect(normalizeContextMenuParams(null).pageURL).toBe('')
  })

  test('real params pass through unchanged', () => {
    const full = params({ selectionText: ' hello ', linkText: 'Link' })
    expect(normalizeContextMenuParams(full)).toEqual(full)
  })
})
