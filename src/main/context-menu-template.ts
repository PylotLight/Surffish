import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'
import { cleanLinkUrl } from '../shared/clean-link'
import { SEARCH_ENGINES, resolveNavigationTarget } from '../shared/navigation'
import type { SearchEngineId } from '../shared/types'
import { READ_ALOUD_SHORTCUT } from '../shared/read-aloud-gate'

/**
 * Pure builder for the page right-click menu: takes the context-menu params and a set of
 * callbacks, returns a Menu template. No Electron runtime imports, so it is unit-testable.
 */

export type ContextMenuParamsInput = Pick<ContextMenuParams,
  'x' | 'y' | 'isEditable' | 'editFlags' | 'selectionText' | 'linkURL' | 'srcURL' | 'mediaType' | 'hasImageContents'
  | 'misspelledWord' | 'dictionarySuggestions' | 'spellcheckEnabled' | 'pageURL' | 'suggestedFilename'> & Partial<Pick<ContextMenuParams, 'linkText'>>

export interface ContextMenuTemplateOptions {
  pageActions: boolean
  searchEngine: SearchEngineId
  pdfDocument?: boolean
  hasPrintPage?: boolean
  hasEditPdf?: boolean
  pdfEditor?: boolean
  /** Offer Take Screenshot… next to Save Page As / Print. */
  hasScreenshot?: boolean
  hasReaderView?: boolean
  canWatchPage?: boolean
  /** Offer the Read Aloud submenu (Read Aloud on in Settings, a web page). */
  canReadAloud?: boolean
  /** The reading in progress, if any: the submenu then offers Pause / Resume and Stop. */
  readAloudState?: ReadAloudMenuState
  /** Offer "Add Page/Link to Reading List" (never in private tabs). */
  canAddToReadingList?: boolean
  /** Offer "Open Link in Glance" (a peek over the page, without a new tab). */
  canOpenInGlance?: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface ContextMenuActions {
  undo(): void
  redo(): void
  cut(): void
  copy(): void
  paste(): void
  pasteAndMatchStyle(): void
  selectAll(): void
  replaceMisspelling(word: string): void
  addToDictionary(word: string): void
  writeClipboard(text: string): void
  copyImageAt(x: number, y: number): void
  openInNewTab(url: string): void
  openInBackgroundTab(url: string): void
  openInGlance?(url: string): void
  saveUrl(url: string, suggestedFilename: string): void
  savePage(): void
  goBack(): void
  goForward(): void
  reload(): void
  print(): void
  inspect(x: number, y: number): void
  editPdf?(): void
  savePdfEditor?(): void
  backToViewer?(): void
  takeScreenshot?(): void
  readerView?(): void
  watchPage?(mode: 'page' | 'pick'): void
  readAloud?(target: ReadAloudMenuTarget, selection?: string): void
  addToReadingList?(target: 'page' | { url: string; title?: string }): void
}

export type ReadAloudMenuState = 'idle' | 'playing' | 'paused'
/** 'here': from the right-click point (or the selection's start) to the end of the article / page. */
export type ReadAloudMenuTarget = 'page' | 'here' | 'selection' | 'toggle' | 'stop'

/**
 * The one "Read Aloud" submenu (page, selection and Reader view menus): Read Page / Read from Here /
 * Read Selection, plus Pause or Resume and Stop while a reading runs.
 */
export function readAloudSubmenu(options: { state: ReadAloudMenuState; selection: string; page: boolean }, run: (target: ReadAloudMenuTarget, selection?: string) => void): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = []
  if (options.state !== 'idle') {
    submenu.push(
      { label: options.state === 'paused' ? 'Resume' : 'Pause', accelerator: READ_ALOUD_SHORTCUT, registerAccelerator: false, click: () => run('toggle') },
      { label: 'Stop', click: () => run('stop') },
      { type: 'separator' }
    )
  }
  if (options.selection) submenu.push({ label: 'Read Selection', click: () => run('selection', options.selection) })
  if (options.page) {
    submenu.push({ label: 'Read from Here', toolTip: 'From this point to the end of the article', click: () => run('here') })
    submenu.push({ label: 'Read Page', ...(options.state === 'idle' ? { accelerator: READ_ALOUD_SHORTCUT, registerAccelerator: false } : {}), click: () => run('page') })
  }
  while (submenu.at(-1)?.type === 'separator') submenu.pop()
  return { label: 'Read Aloud', submenu }
}

/** Chrome shows a handful of guesses; more than this is noise in a context menu. */
export const MAX_SPELLING_SUGGESTIONS = 6

export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function addSeparator(items: MenuItemConstructorOptions[]): void {
  if (items.length > 0 && items[items.length - 1]?.type !== 'separator') items.push({ type: 'separator' })
}

export function pdfFilename(pageURL: string): string {
  let name = 'document'
  try {
    name = decodeURIComponent(new URL(pageURL).pathname.split('/').pop() || '') || new URL(pageURL).hostname || name
  } catch {
    // Keep the generic name for malformed paths.
  }
  const safe = safeFilename(name, 'document')
  return /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`
}

export function safeFilename(value: string, fallback: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/g, '')
  return (cleaned || fallback).slice(0, 180)
}

/**
 * Spelling block for a misspelled word in an editable field. Gated on `misspelledWord` only:
 * on macOS Electron reports `spellcheckEnabled: false` even when the native checker underlined
 * the word and filled `dictionarySuggestions` (seen on Electron 41+), so that flag is not usable.
 */
export function spellingMenuItems(params: Pick<ContextMenuParamsInput, 'isEditable' | 'misspelledWord' | 'dictionarySuggestions'>, actions: Pick<ContextMenuActions, 'replaceMisspelling' | 'addToDictionary'>): MenuItemConstructorOptions[] {
  const word = params.misspelledWord?.trim() ?? ''
  if (!params.isEditable || !word) return []
  const items: MenuItemConstructorOptions[] = []
  const suggestions = (params.dictionarySuggestions ?? []).filter((suggestion) => suggestion.trim()).slice(0, MAX_SPELLING_SUGGESTIONS)
  for (const suggestion of suggestions) items.push({ label: suggestion, click: () => actions.replaceMisspelling(suggestion) })
  if (suggestions.length === 0) items.push({ label: 'No Guesses Found', enabled: false })
  items.push({ type: 'separator' })
  items.push({ label: 'Add to Dictionary', toolTip: `Stop marking “${word}” as misspelled`, click: () => actions.addToDictionary(word) })
  return items
}

const NO_EDIT_FLAGS: ContextMenuParamsInput['editFlags'] = {
  canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canDelete: false, canSelectAll: false, canEditRichly: false
}

const text = (value: unknown): string => typeof value === 'string' ? value : ''

/**
 * Fill in whatever a partial `context-menu` event left out. Chromium always sends every field, but
 * synthetic events (an `emit('context-menu', …)` from a test or a forwarded right-click) can carry
 * only x/y, and a TypeError here used to escape as an unhandled rejection with no menu shown.
 */
export function normalizeContextMenuParams(params: Partial<ContextMenuParamsInput> | null | undefined): ContextMenuParamsInput {
  const input = params ?? {}
  const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0
  return {
    ...input,
    x: finite(input.x),
    y: finite(input.y),
    isEditable: input.isEditable === true,
    editFlags: { ...NO_EDIT_FLAGS, ...(input.editFlags ?? {}) },
    selectionText: text(input.selectionText),
    linkURL: text(input.linkURL),
    srcURL: text(input.srcURL),
    mediaType: input.mediaType ?? 'none',
    hasImageContents: input.hasImageContents === true,
    misspelledWord: text(input.misspelledWord),
    dictionarySuggestions: Array.isArray(input.dictionarySuggestions) ? input.dictionarySuggestions.filter((entry): entry is string => typeof entry === 'string') : [],
    spellcheckEnabled: input.spellcheckEnabled === true,
    pageURL: text(input.pageURL),
    suggestedFilename: text(input.suggestedFilename),
    ...(typeof input.linkText === 'string' ? { linkText: input.linkText } : {})
  }
}

export function buildBrowserContextMenuTemplate(rawParams: ContextMenuParamsInput, options: ContextMenuTemplateOptions, actions: ContextMenuActions): MenuItemConstructorOptions[] {
  const params = normalizeContextMenuParams(rawParams)
  const items: MenuItemConstructorOptions[] = []
  const flags = params.editFlags

  if (params.isEditable) {
    const spelling = spellingMenuItems(params, actions)
    if (spelling.length > 0) {
      items.push(...spelling)
      addSeparator(items)
    }
    items.push(
      { label: 'Undo', enabled: flags.canUndo, click: () => actions.undo() },
      { label: 'Redo', enabled: flags.canRedo, click: () => actions.redo() }
    )
    addSeparator(items)
    items.push(
      { label: 'Cut', enabled: flags.canCut, click: () => actions.cut() },
      { label: 'Copy', enabled: flags.canCopy, click: () => actions.copy() },
      { label: 'Paste', enabled: flags.canPaste, click: () => actions.paste() },
      { label: 'Paste and Match Style', enabled: flags.canPaste, click: () => actions.pasteAndMatchStyle() },
      { label: 'Delete', enabled: flags.canDelete, role: 'delete' },
      { label: 'Select All', enabled: flags.canSelectAll, click: () => actions.selectAll() }
    )
  } else if (params.selectionText.trim()) {
    items.push({ label: 'Copy', enabled: flags.canCopy, click: () => actions.copy() })
    if (options.pageActions) {
      const engineLabel = SEARCH_ENGINES.find((engine) => engine.id === options.searchEngine)?.label ?? 'Search'
      const query = params.selectionText.trim()
      const target = resolveNavigationTarget(query, options.searchEngine)
      if (target) {
        const visibleQuery = query.length > 42 ? `${query.slice(0, 39)}…` : query
        items.push({
          label: `Search ${engineLabel} for “${visibleQuery}”`,
          click: () => actions.openInNewTab(target)
        })
      }
    }
  }

  const linkUrl = safeHttpUrl(params.linkURL)
  const mediaUrl = safeHttpUrl(params.srcURL)
  const pageUrl = safeHttpUrl(params.pageURL)
  const selection = params.isEditable ? '' : params.selectionText.trim()
  const offerReadAloud = Boolean(options.pageActions && options.canReadAloud && !options.pdfDocument && !options.pdfEditor)
  const readAloud = (): MenuItemConstructorOptions =>
    readAloudSubmenu({ state: options.readAloudState ?? 'idle', selection, page: pageUrl !== null }, (target, text) => actions.readAloud?.(target, text))
  // A selection: Read Aloud sits with Copy / Search (Read Selection in it).
  if (selection && offerReadAloud) items.push(readAloud())

  if (linkUrl) {
    addSeparator(items)
    const linkText = params.linkText?.trim() ?? ''
    const copyAs: MenuItemConstructorOptions[] = [
      { label: 'Clean Link', toolTip: 'Without tracking parameters (utm_*, fbclid, gclid…)', click: () => actions.writeClipboard(cleanLinkUrl(linkUrl)) },
      ...(linkText ? [{ label: 'Link Text', click: () => actions.writeClipboard(linkText) }] : []),
      { label: 'Markdown Link', click: () => actions.writeClipboard(`[${(linkText || linkUrl).replace(/[[\]]/g, '\\$&')}](${linkUrl})`) }
    ]
    const save: MenuItemConstructorOptions[] = [
      { label: 'Save Link As…', click: () => actions.saveUrl(linkUrl, params.suggestedFilename || 'download') },
      ...(options.pageActions && options.canAddToReadingList
        ? [{ label: 'Add Link to Reading List', toolTip: 'Save the link to read later, without opening it', click: () => actions.addToReadingList?.({ url: linkUrl, ...(linkText ? { title: linkText } : {}) }) }]
        : [])
    ]
    items.push(
      { label: 'Open Link in New Tab', click: () => actions.openInNewTab(linkUrl) },
      { label: 'Open Link in Background Tab', click: () => actions.openInBackgroundTab(linkUrl) },
      ...(options.pageActions && options.canOpenInGlance ? [{ label: 'Open Link in Glance', toolTip: 'Peek at the link over this page without opening a tab (Shift+click)', click: () => actions.openInGlance?.(linkUrl) }] : []),
      { label: 'Copy Link Address', click: () => actions.writeClipboard(linkUrl) },
      { label: 'Copy Link As', submenu: copyAs },
      save.length > 1 ? { label: 'Save Link', submenu: save } : save[0]!
    )
  }
  const image = params.mediaType === 'image' && params.hasImageContents
  if (image) {
    // Works for blob:/data: images too, so it doesn't need an http src like the items below.
    addSeparator(items)
    items.push({ label: 'Copy Image', toolTip: 'Shortcut: ⌥/Alt+click an image', click: () => actions.copyImageAt(params.x, params.y) })
  }
  const media = mediaUrl !== null && params.mediaType !== 'none'
  if (mediaUrl && media) {
    if (!image) addSeparator(items)
    const kind = params.mediaType === 'image' ? 'Image' : params.mediaType === 'video' || params.mediaType === 'audio' ? 'Media' : 'File'
    items.push(
      { label: `Save ${kind} As…`, click: () => actions.saveUrl(mediaUrl, params.suggestedFilename || 'download') },
      { label: `Open ${kind} in New Tab`, click: () => actions.openInNewTab(mediaUrl) },
      { label: `Copy ${kind} Address`, click: () => actions.writeClipboard(mediaUrl) }
    )
  }

  if (options.pageActions && options.pdfEditor) {
    addSeparator(items)
    items.push(
      { label: 'Save PDF…', accelerator: 'CmdOrCtrl+S', registerAccelerator: false, click: () => actions.savePdfEditor?.() },
      { label: 'Back to Viewer', click: () => actions.backToViewer?.() },
      { type: 'separator' },
      { label: 'Inspect', click: () => actions.inspect(params.x, params.y) }
    )
  } else if (options.pageActions) {
    // The page's own items. A plain right-click shows them; on a link, an image or a selection they
    // fold into one "Page" submenu so the menu stays about what was clicked.
    const page: MenuItemConstructorOptions[] = [
      { label: 'Back', enabled: options.canGoBack, click: () => actions.goBack() },
      { label: 'Forward', enabled: options.canGoForward, click: () => actions.goForward() },
      { label: 'Reload', click: () => actions.reload() },
      { type: 'separator' }
    ]
    if (!options.pdfDocument && options.hasReaderView) page.push({ label: 'Reader View', accelerator: 'CmdOrCtrl+Alt+R', registerAccelerator: false, click: () => actions.readerView?.() })
    if (offerReadAloud && pageUrl && !selection) page.push(readAloud())
    if (options.canAddToReadingList && pageUrl) page.push({ label: 'Add Page to Reading List', accelerator: 'CmdOrCtrl+Shift+L', registerAccelerator: false, click: () => actions.addToReadingList?.('page') })
    addSeparator(page)
    const pdfUrl = options.pdfDocument ? pageUrl : null
    if (pdfUrl) {
      // Goes through will-download, so it lands in the downloads list like any other file.
      page.push({ label: 'Save PDF As…', click: () => actions.saveUrl(pdfUrl, pdfFilename(pdfUrl)) })
    } else if (!options.pdfDocument) {
      page.push({ label: 'Save Page As…', click: () => actions.savePage() })
    }
    if (options.pdfDocument && options.hasEditPdf) page.push({ label: 'Edit PDF', click: () => actions.editPdf?.() })
    page.push({ label: 'Print…', click: () => actions.print() })
    if (options.hasScreenshot) page.push({ label: 'Take Screenshot…', accelerator: 'CmdOrCtrl+Shift+S', registerAccelerator: false, click: () => actions.takeScreenshot?.() })
    const tools: MenuItemConstructorOptions[] = []
    if (pageUrl) tools.push({ label: 'Copy Clean Link', toolTip: 'Copy this page’s address without tracking parameters', click: () => actions.writeClipboard(cleanLinkUrl(pageUrl)) })
    if (!options.pdfDocument && options.canWatchPage && pageUrl) {
      tools.push(
        { label: 'Watch This Page for Changes…', click: () => actions.watchPage?.('page') },
        { label: 'Watch Part of This Page…', toolTip: 'Click the element to watch', click: () => actions.watchPage?.('pick') }
      )
    }
    if (tools.length > 0) page.push({ label: 'More Tools', submenu: tools })
    addSeparator(items)
    if (linkUrl || media || image || selection) items.push({ label: 'Page', submenu: page })
    else items.push(...page)
    addSeparator(items)
    items.push({ label: 'Inspect', click: () => actions.inspect(params.x, params.y) })
  } else if (!params.isEditable && !params.selectionText.trim() && flags.canSelectAll) {
    items.push({ label: 'Select All', click: () => actions.selectAll() })
  }

  while (items[items.length - 1]?.type === 'separator') items.pop()
  return items
}
