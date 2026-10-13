import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'
import { cleanLinkUrl } from '../shared/clean-link'
import { SEARCH_ENGINES, resolveNavigationTarget } from '../shared/navigation'
import type { SearchEngineId } from '../shared/types'

/**
 * Pure builder for the page right-click menu: takes the context-menu params and a set of
 * callbacks, returns a Menu template. No Electron runtime imports, so it is unit-testable.
 */

export type ContextMenuParamsInput = Pick<ContextMenuParams,
  'x' | 'y' | 'isEditable' | 'editFlags' | 'selectionText' | 'linkURL' | 'srcURL' | 'mediaType' | 'hasImageContents'
  | 'misspelledWord' | 'dictionarySuggestions' | 'spellcheckEnabled' | 'pageURL' | 'suggestedFilename'>

export interface ContextMenuTemplateOptions {
  pageActions: boolean
  searchEngine: SearchEngineId
  pdfDocument?: boolean
  hasPrintPage?: boolean
  hasEditPdf?: boolean
  pdfEditor?: boolean
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

export function buildBrowserContextMenuTemplate(params: ContextMenuParamsInput, options: ContextMenuTemplateOptions, actions: ContextMenuActions): MenuItemConstructorOptions[] {
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
  if (linkUrl) {
    addSeparator(items)
    items.push(
      { label: 'Open Link in New Tab', click: () => actions.openInNewTab(linkUrl) },
      { label: 'Open Link in Background Tab', click: () => actions.openInBackgroundTab(linkUrl) },
      { label: 'Save Link As…', click: () => actions.saveUrl(linkUrl, params.suggestedFilename || 'download') },
      { label: 'Copy Link Address', click: () => actions.writeClipboard(linkUrl) },
      { label: 'Copy Clean Link', toolTip: 'Copy without tracking parameters (utm_*, fbclid, gclid…)', click: () => actions.writeClipboard(cleanLinkUrl(linkUrl)) }
    )
  }
  if (params.mediaType === 'image' && params.hasImageContents) {
    // Works for blob:/data: images too, so it doesn't need an http src like the items below.
    addSeparator(items)
    items.push({ label: 'Copy Image', toolTip: 'Shortcut: ⌥/Alt+click an image', click: () => actions.copyImageAt(params.x, params.y) })
  }
  if (mediaUrl && params.mediaType !== 'none') {
    if (params.mediaType !== 'image' || !params.hasImageContents) addSeparator(items)
    const kind = params.mediaType === 'image' ? 'Image' : params.mediaType === 'video' || params.mediaType === 'audio' ? 'Media' : 'File'
    items.push(
      { label: `Open ${kind} in New Tab`, click: () => actions.openInNewTab(mediaUrl) },
      { label: `Save ${kind} As…`, click: () => actions.saveUrl(mediaUrl, params.suggestedFilename || 'download') },
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
    addSeparator(items)
    items.push(
      { label: 'Back', enabled: options.canGoBack, click: () => actions.goBack() },
      { label: 'Forward', enabled: options.canGoForward, click: () => actions.goForward() },
      { label: 'Reload', click: () => actions.reload() }
    )
    const pageUrl = safeHttpUrl(params.pageURL)
    if (pageUrl && !linkUrl) {
      addSeparator(items)
      items.push({ label: 'Copy Clean Link', toolTip: 'Copy this page’s address without tracking parameters', click: () => actions.writeClipboard(cleanLinkUrl(pageUrl)) })
    }
    addSeparator(items)
    const pdfUrl = options.pdfDocument ? safeHttpUrl(params.pageURL) : null
    if (pdfUrl) {
      // Goes through will-download, so it lands in the downloads list like any other file.
      items.push({ label: 'Save PDF As…', click: () => actions.saveUrl(pdfUrl, pdfFilename(pdfUrl)) })
    } else if (!options.pdfDocument) {
      items.push({ label: 'Save Page As…', click: () => actions.savePage() })
    }
    if (options.pdfDocument && options.hasEditPdf) items.push({ label: 'Edit PDF', click: () => actions.editPdf?.() })
    items.push(
      { label: 'Print…', click: () => actions.print() },
      { label: 'Inspect', click: () => actions.inspect(params.x, params.y) }
    )
  } else if (!params.isEditable && !params.selectionText.trim() && flags.canSelectAll) {
    items.push({ label: 'Select All', click: () => actions.selectAll() })
  }

  while (items[items.length - 1]?.type === 'separator') items.pop()
  return items
}
