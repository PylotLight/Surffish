import { clipboard, dialog, Menu, type BaseWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { cleanLinkUrl } from '../shared/clean-link'
import { SEARCH_ENGINES, resolveNavigationTarget } from '../shared/navigation'
import type { SearchEngineId } from '../shared/types'

interface ContextMenuEvent {
  preventDefault(): void
}

export interface BrowserContextMenuOptions {
  window: BaseWindow
  pageActions: boolean
  offsetX?: number
  offsetY?: number
  searchEngine: SearchEngineId
  openInNewTab: (url: string) => void
  openInBackgroundTab: (url: string) => void
  /** The page is a PDF in the built-in viewer: offer Save PDF As… and print through the viewer. */
  pdfDocument?: boolean
  printPage?: () => void
  /** Offer Edit PDF (the page is a PDF the editor can open). */
  editPdf?: () => void
  /** The tab is the PDF editor: replace the page actions with Save / Back to Viewer. */
  pdfEditor?: { save: () => void; backToViewer: () => void }
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function safeFilename(value: string, fallback: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/g, '')
  return (cleaned || fallback).slice(0, 180)
}

function addSeparator(items: MenuItemConstructorOptions[]): void {
  if (items.length > 0 && items[items.length - 1]?.type !== 'separator') items.push({ type: 'separator' })
}

function runMenuTask(task: Promise<void>): void {
  void task.catch((error: unknown) => console.warn('Could not complete browser menu action:', error))
}

async function savePage(contents: WebContents, window: BaseWindow, pageTitle: string): Promise<void> {
  const defaultName = safeFilename(pageTitle, 'page').replace(/\.(?:html?|mhtml)$/i, '')
  const result = await dialog.showSaveDialog(window, {
    title: 'Save page',
    defaultPath: `${defaultName}.html`,
    filters: [
      { name: 'Web page', extensions: ['html'] },
      { name: 'Web archive', extensions: ['mhtml'] }
    ]
  })
  if (result.canceled || !result.filePath) return
  const saveType = result.filePath.toLowerCase().endsWith('.mhtml') ? 'MHTML' : 'HTMLComplete'
  await contents.savePage(result.filePath, saveType)
}

async function saveUrl(contents: WebContents, window: BaseWindow, url: string, suggestedFilename: string): Promise<void> {
  const safeUrl = safeHttpUrl(url)
  if (!safeUrl) return
  let fallback = 'download'
  try {
    fallback = decodeURIComponent(new URL(safeUrl).pathname.split('/').pop() || fallback)
  } catch {
    // Keep a generic filename when the URL path is not valid percent-encoding.
  }
  const result = await dialog.showSaveDialog(window, {
    title: 'Save file',
    defaultPath: safeFilename(suggestedFilename, safeFilename(fallback, 'download'))
  })
  if (result.canceled || !result.filePath) return

  const browserSession = contents.session
  const onWillDownload = (_event: Electron.Event, item: Electron.DownloadItem, sourceContents: WebContents): void => {
    if (sourceContents !== contents || safeHttpUrl(item.getURL()) !== safeUrl) return
    item.setSavePath(result.filePath!)
    clearTimeout(timeout)
    browserSession.removeListener('will-download', onWillDownload)
  }
  const timeout = setTimeout(() => browserSession.removeListener('will-download', onWillDownload), 30_000)
  timeout.unref()
  browserSession.on('will-download', onWillDownload)
  try {
    contents.downloadURL(safeUrl)
  } catch (error) {
    clearTimeout(timeout)
    browserSession.removeListener('will-download', onWillDownload)
    throw error
  }
}

function pdfFilename(pageURL: string): string {
  let name = 'document'
  try {
    name = decodeURIComponent(new URL(pageURL).pathname.split('/').pop() || '') || new URL(pageURL).hostname || name
  } catch {
    // Keep the generic name for malformed paths.
  }
  const safe = safeFilename(name, 'document')
  return /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`
}

function pageFilename(pageURL: string): string {
  try {
    return new URL(pageURL).hostname || 'page'
  } catch {
    return 'page'
  }
}

/**
 * Displays the browser's native right-click menu. Returning false leaves the
 * platform default untouched when there is no useful action for this context.
 */
export function showBrowserContextMenu(
  event: ContextMenuEvent,
  contents: WebContents,
  params: ContextMenuParams,
  options: BrowserContextMenuOptions
): boolean {
  if (options.window.isDestroyed() || contents.isDestroyed()) return false

  const items: MenuItemConstructorOptions[] = []
  const flags = params.editFlags

  if (params.isEditable) {
    items.push(
      { label: 'Undo', enabled: flags.canUndo, click: () => contents.undo() },
      { label: 'Redo', enabled: flags.canRedo, click: () => contents.redo() }
    )
    addSeparator(items)
    items.push(
      { label: 'Cut', enabled: flags.canCut, click: () => contents.cut() },
      { label: 'Copy', enabled: flags.canCopy, click: () => contents.copy() },
      { label: 'Paste', enabled: flags.canPaste, click: () => contents.paste() },
      { label: 'Paste and Match Style', enabled: flags.canPaste, click: () => contents.pasteAndMatchStyle() },
      { label: 'Delete', enabled: flags.canDelete, role: 'delete' },
      { label: 'Select All', enabled: flags.canSelectAll, click: () => contents.selectAll() }
    )
  } else if (params.selectionText.trim()) {
    items.push({ label: 'Copy', enabled: flags.canCopy, click: () => contents.copy() })
    if (options.pageActions) {
      const engineLabel = SEARCH_ENGINES.find((engine) => engine.id === options.searchEngine)?.label ?? 'Search'
      const query = params.selectionText.trim()
      const target = resolveNavigationTarget(query, options.searchEngine)
      if (target) {
        const visibleQuery = query.length > 42 ? `${query.slice(0, 39)}…` : query
        items.push({
          label: `Search ${engineLabel} for “${visibleQuery}”`,
          click: () => options.openInNewTab(target)
        })
      }
    }
  }

  const linkUrl = safeHttpUrl(params.linkURL)
  const mediaUrl = safeHttpUrl(params.srcURL)
  if (linkUrl) {
    addSeparator(items)
    items.push(
      { label: 'Open Link in New Tab', click: () => options.openInNewTab(linkUrl) },
      { label: 'Open Link in Background Tab', click: () => options.openInBackgroundTab(linkUrl) },
      { label: 'Save Link As…', click: () => runMenuTask(saveUrl(contents, options.window, linkUrl, params.suggestedFilename || 'download')) },
      { label: 'Copy Link Address', click: () => clipboard.writeText(linkUrl) },
      { label: 'Copy Clean Link', toolTip: 'Copy without tracking parameters (utm_*, fbclid, gclid…)', click: () => clipboard.writeText(cleanLinkUrl(linkUrl)) }
    )
  }
  if (params.mediaType === 'image' && params.hasImageContents) {
    // Works for blob:/data: images too, so it doesn't need an http src like the items below.
    addSeparator(items)
    items.push({ label: 'Copy Image', toolTip: 'Shortcut: ⌥/Alt+click an image', click: () => contents.copyImageAt(params.x, params.y) })
  }
  if (mediaUrl && params.mediaType !== 'none') {
    if (params.mediaType !== 'image' || !params.hasImageContents) addSeparator(items)
    const kind = params.mediaType === 'image' ? 'Image' : params.mediaType === 'video' || params.mediaType === 'audio' ? 'Media' : 'File'
    items.push(
      { label: `Open ${kind} in New Tab`, click: () => options.openInNewTab(mediaUrl) },
      { label: `Save ${kind} As…`, click: () => runMenuTask(saveUrl(contents, options.window, mediaUrl, params.suggestedFilename || 'download')) },
      { label: `Copy ${kind} Address`, click: () => clipboard.writeText(mediaUrl) }
    )
  }

  if (params.misspelledWord && params.spellcheckEnabled) {
    addSeparator(items)
    for (const suggestion of params.dictionarySuggestions) {
      items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) })
    }
    items.push({ label: `Add “${params.misspelledWord}” to Dictionary`, click: () => { contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) } })
  }

  if (options.pageActions && options.pdfEditor) {
    const editor = options.pdfEditor
    addSeparator(items)
    items.push(
      { label: 'Save PDF…', accelerator: 'CmdOrCtrl+S', registerAccelerator: false, click: () => editor.save() },
      { label: 'Back to Viewer', click: () => editor.backToViewer() },
      { type: 'separator' },
      { label: 'Inspect', click: () => contents.inspectElement(params.x, params.y) }
    )
  } else if (options.pageActions) {
    addSeparator(items)
    items.push(
      { label: 'Back', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
      { label: 'Forward', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() },
      { label: 'Reload', click: () => contents.reload() }
    )
    const pageUrl = safeHttpUrl(params.pageURL)
    if (pageUrl && !linkUrl) {
      addSeparator(items)
      items.push({ label: 'Copy Clean Link', toolTip: 'Copy this page’s address without tracking parameters', click: () => clipboard.writeText(cleanLinkUrl(pageUrl)) })
    }
    addSeparator(items)
    const pdfUrl = options.pdfDocument ? safeHttpUrl(params.pageURL) : null
    if (pdfUrl) {
      // Goes through will-download, so it lands in the downloads list like any other file.
      items.push({ label: 'Save PDF As…', click: () => runMenuTask(saveUrl(contents, options.window, pdfUrl, pdfFilename(pdfUrl))) })
    } else if (!options.pdfDocument) {
      items.push({ label: 'Save Page As…', click: () => runMenuTask(savePage(contents, options.window, pageFilename(params.pageURL))) })
    }
    if (options.pdfDocument && options.editPdf) items.push({ label: 'Edit PDF', click: options.editPdf })
    items.push(
      { label: 'Print…', click: () => options.printPage ? options.printPage() : contents.print() },
      { label: 'Inspect', click: () => contents.inspectElement(params.x, params.y) }
    )
  } else if (!params.isEditable && !params.selectionText.trim() && flags.canSelectAll) {
    items.push({ label: 'Select All', click: () => contents.selectAll() })
  }

  while (items[items.length - 1]?.type === 'separator') items.pop()
  if (items.length === 0) return false

  const menu = Menu.buildFromTemplate(items)
  event.preventDefault()
  menu.popup({
    window: options.window,
    x: Math.max(0, Math.round(params.x + (options.offsetX ?? 0))),
    y: Math.max(0, Math.round(params.y + (options.offsetY ?? 0)))
  })
  return true
}
