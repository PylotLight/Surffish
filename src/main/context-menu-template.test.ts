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

/** Every label, submenus included, as "Parent › Child". */
function allLabels(items: MenuItemConstructorOptions[], prefix = ''): string[] {
  return items.flatMap((item) => {
    if (item.type === 'separator') return []
    const label = `${prefix}${String(item.label)}`
    return Array.isArray(item.submenu) ? [label, ...allLabels(item.submenu, `${label} › `)] : [label]
  })
}

/** The item at a "Parent › Child" path. */
function find(items: MenuItemConstructorOptions[], path: string): MenuItemConstructorOptions | undefined {
  const [head, ...rest] = path.split(' › ')
  const item = items.find((candidate) => candidate.label === head)
  if (!item || rest.length === 0) return item
  return Array.isArray(item.submenu) ? find(item.submenu, rest.join(' › ')) : undefined
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
    click(find(items, 'Copy Link As › Clean Link'))
    expect(fns.writeClipboard).toHaveBeenCalledWith('https://example.com/?id=1')
  })

  test('a link menu stays about the link: page items fold into one Page submenu, Inspect stays', () => {
    const items = buildBrowserContextMenuTemplate(params({ linkURL: 'https://example.com/a', linkText: 'A [b]' }), { ...PAGE, canAddToReadingList: true, hasReaderView: true }, actions())
    expect(labels(items)).toEqual(['Open Link in New Tab', 'Open Link in Background Tab', 'Copy Link Address', 'Copy Link As', 'Save Link', '—', 'Page', '—', 'Inspect'])
    expect(allLabels(items)).toContain('Page › Reload')
    expect(allLabels(items)).toContain('Save Link › Save Link As…')
    expect(allLabels(items)).toContain('Copy Link As › Link Text')
    const fns = actions()
    click(find(buildBrowserContextMenuTemplate(params({ linkURL: 'https://example.com/a', linkText: 'A [b]' }), PAGE, fns), 'Copy Link As › Markdown Link'))
    expect(fns.writeClipboard).toHaveBeenCalledWith('[A \\[b\\]](https://example.com/a)')
  })

  test('a plain page right-click shows the page items flat, rarer tools under More Tools', () => {
    const items = buildBrowserContextMenuTemplate(params(), { ...PAGE, hasReaderView: true, hasScreenshot: true, canAddToReadingList: true }, actions())
    expect(labels(items)).toEqual(['Back', 'Forward', 'Reload', '—', 'Reader View', 'Add Page to Reading List', '—', 'Save Page As…', 'Print…', 'Take Screenshot…', 'More Tools', '—', 'Inspect'])
    expect(allLabels(items)).toContain('More Tools › Copy Clean Link')
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
    expect(names.indexOf('Take Screenshot…')).toBe(names.indexOf('Print…') + 1)
    click(items.find((item) => item.label === 'Take Screenshot…'))
    expect(takeScreenshot).toHaveBeenCalledTimes(1)
  })
})

describe('reader view and page watchers', () => {
  test('page menu offers Reader View and both watch items when the host allows them', () => {
    const fns = { ...actions(), readerView: mock(() => undefined), watchPage: mock((_mode: 'page' | 'pick') => undefined) }
    const items = buildBrowserContextMenuTemplate(params(), { ...PAGE, hasReaderView: true, canWatchPage: true }, fns)
    const all = allLabels(items)
    expect(all).toContain('Reader View')
    expect(all).toContain('More Tools › Watch This Page for Changes…')
    expect(all).toContain('More Tools › Watch Part of This Page…')
    click(find(items, 'More Tools › Watch Part of This Page…'))
    expect(fns.watchPage).toHaveBeenCalledWith('pick')
    click(items.find((item) => item.label === 'Reader View'))
    expect(fns.readerView).toHaveBeenCalled()
  })

  test('no watch items without permission (private tabs) or on PDFs', () => {
    expect(allLabels(buildBrowserContextMenuTemplate(params(), PAGE, actions()))).not.toContain('More Tools › Watch This Page for Changes…')
    const pdf = allLabels(buildBrowserContextMenuTemplate(params({ pageURL: 'https://example.com/a.pdf' }), { ...PAGE, pdfDocument: true, canWatchPage: true, hasReaderView: true }, actions()))
    expect(pdf).not.toContain('More Tools › Watch This Page for Changes…')
    expect(pdf).not.toContain('Reader View')
  })
})

describe('Read Aloud items', () => {
  test('one Read Aloud submenu: Read from Here / Read Page on a page, Read Selection first with a selection', () => {
    const calls: unknown[][] = []
    const fns = { ...actions(), readAloud: (...args: unknown[]) => { calls.push(args) } }
    const page = buildBrowserContextMenuTemplate(params(), { ...PAGE, canReadAloud: true }, fns)
    expect(allLabels(page).filter((label) => label.startsWith('Read Aloud'))).toEqual(['Read Aloud', 'Read Aloud › Read from Here', 'Read Aloud › Read Page'])
    expect(find(page, 'Read Aloud › Read Page')?.accelerator).toBe('CmdOrCtrl+Shift+U')
    click(find(page, 'Read Aloud › Read Page'))
    click(find(page, 'Read Aloud › Read from Here'))
    const selected = buildBrowserContextMenuTemplate(params({ selectionText: '  Some words.  ' }), { ...PAGE, canReadAloud: true }, fns)
    expect(labels(selected).slice(0, 3)).toEqual(['Copy', 'Search DuckDuckGo for “Some words.”', 'Read Aloud'])
    expect(allLabels(selected).filter((label) => label.startsWith('Read Aloud ›'))).toEqual(['Read Aloud › Read Selection', 'Read Aloud › Read from Here', 'Read Aloud › Read Page'])
    expect(allLabels(selected)).not.toContain('Page › Read Aloud')
    click(find(selected, 'Read Aloud › Read Selection'))
    expect(calls).toEqual([['page', undefined], ['here', undefined], ['selection', 'Some words.']])
  })

  test('while reading: Pause (or Resume) and Stop come first', () => {
    const calls: unknown[][] = []
    const fns = { ...actions(), readAloud: (...args: unknown[]) => { calls.push(args) } }
    const playing = buildBrowserContextMenuTemplate(params(), { ...PAGE, canReadAloud: true, readAloudState: 'playing' }, fns)
    expect(allLabels(playing).filter((label) => label.startsWith('Read Aloud ›'))).toEqual(['Read Aloud › Pause', 'Read Aloud › Stop', 'Read Aloud › Read from Here', 'Read Aloud › Read Page'])
    const paused = buildBrowserContextMenuTemplate(params(), { ...PAGE, canReadAloud: true, readAloudState: 'paused' }, fns)
    click(find(paused, 'Read Aloud › Resume'))
    click(find(paused, 'Read Aloud › Stop'))
    expect(calls).toEqual([['toggle', undefined], ['stop', undefined]])
  })

  test('nothing while Read Aloud is off, or on PDFs', () => {
    expect(allLabels(buildBrowserContextMenuTemplate(params(), PAGE, actions())).some((label) => label.includes('Read Aloud'))).toBe(false)
    expect(allLabels(buildBrowserContextMenuTemplate(params({ selectionText: 'x' }), PAGE, actions())).some((label) => label.includes('Read Aloud'))).toBe(false)
    expect(allLabels(buildBrowserContextMenuTemplate(params(), { ...PAGE, pdfDocument: true, canReadAloud: true }, actions())).some((label) => label.includes('Read Aloud'))).toBe(false)
  })
})

describe('Reading List items', () => {
  test('a link offers Add Link to Reading List (with the link text as the title) only when allowed', () => {
    const calls: unknown[] = []
    const withReadingList = { ...actions(), addToReadingList: (target: unknown) => { calls.push(target) } }
    const link = params({ linkURL: 'https://example.com/story#top', linkText: '  A story  ' })
    const without = buildBrowserContextMenuTemplate(link, PAGE, withReadingList)
    expect(allLabels(without).some((label) => label.includes('Add Link to Reading List'))).toBe(false)
    expect(labels(without)).toContain('Save Link As…')
    const items = buildBrowserContextMenuTemplate(link, { ...PAGE, canAddToReadingList: true }, withReadingList)
    click(find(items, 'Save Link › Add Link to Reading List'))
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
