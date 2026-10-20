import { clipboard, dialog, Menu, type BaseWindow, type ContextMenuParams, type WebContents } from 'electron'
import { buildBrowserContextMenuTemplate, normalizeContextMenuParams, safeFilename, safeHttpUrl } from './context-menu-template'
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
  /** Offer "Open Link in Glance" on links (site tabs only). */
  openInGlance?: (url: string) => void
  /** The page is a PDF in the built-in viewer: offer Save PDF As… and print through the viewer. */
  pdfDocument?: boolean
  printPage?: () => void
  /** Offer Edit PDF (the page is a PDF the editor can open). */
  editPdf?: () => void
  /** The tab is the PDF editor: replace the page actions with Save / Back to Viewer. */
  pdfEditor?: { save: () => void; backToViewer: () => void }
  /** Offer Take Screenshot… (the page is the active tab). */
  takeScreenshot?: () => void
  /** The page looks like an article (or is in Reader view): offer Reader View. */
  readerView?: () => void
  /** Offer "Watch This Page for Changes…" (never for private tabs). */
  watchPage?: (mode: 'page' | 'pick') => void
  /** Offer Read Aloud entries (on in Settings, a web page); `readingAloud` swaps in Stop. */
  readAloud?: (target: 'page' | 'selection' | 'stop', selection?: string) => void
  readingAloud?: boolean
  /** Offer "Add Page/Link to Reading List" (never for private tabs). */
  addToReadingList?: (target: 'page' | { url: string; title?: string }) => void
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
  rawParams: ContextMenuParams,
  options: BrowserContextMenuOptions
): boolean {
  if (options.window.isDestroyed() || contents.isDestroyed()) return false
  const params = normalizeContextMenuParams(rawParams) as ContextMenuParams

  const items = buildBrowserContextMenuTemplate(params, {
    pageActions: options.pageActions,
    searchEngine: options.searchEngine,
    pdfDocument: options.pdfDocument,
    hasPrintPage: Boolean(options.printPage),
    hasEditPdf: Boolean(options.editPdf),
    pdfEditor: Boolean(options.pdfEditor),
    hasScreenshot: Boolean(options.takeScreenshot),
    hasReaderView: Boolean(options.readerView),
    canWatchPage: Boolean(options.watchPage),
    canReadAloud: Boolean(options.readAloud),
    readingAloud: options.readingAloud === true,
    canAddToReadingList: Boolean(options.addToReadingList),
    canOpenInGlance: Boolean(options.openInGlance),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward()
  }, {
    undo: () => contents.undo(),
    redo: () => contents.redo(),
    cut: () => contents.cut(),
    copy: () => contents.copy(),
    paste: () => contents.paste(),
    pasteAndMatchStyle: () => contents.pasteAndMatchStyle(),
    selectAll: () => contents.selectAll(),
    replaceMisspelling: (word) => contents.replaceMisspelling(word),
    addToDictionary: (word) => { contents.session.addWordToSpellCheckerDictionary(word) },
    writeClipboard: (text) => clipboard.writeText(text),
    copyImageAt: (x, y) => contents.copyImageAt(x, y),
    openInNewTab: options.openInNewTab,
    openInBackgroundTab: options.openInBackgroundTab,
    openInGlance: options.openInGlance,
    saveUrl: (url, suggestedFilename) => runMenuTask(saveUrl(contents, options.window, url, suggestedFilename)),
    savePage: () => runMenuTask(savePage(contents, options.window, pageFilename(params.pageURL))),
    goBack: () => contents.navigationHistory.goBack(),
    goForward: () => contents.navigationHistory.goForward(),
    reload: () => contents.reload(),
    print: () => options.printPage ? options.printPage() : contents.print(),
    inspect: (x, y) => contents.inspectElement(x, y),
    editPdf: options.editPdf,
    savePdfEditor: options.pdfEditor?.save,
    backToViewer: options.pdfEditor?.backToViewer,
    takeScreenshot: options.takeScreenshot,
    readerView: options.readerView,
    watchPage: options.watchPage,
    readAloud: options.readAloud,
    addToReadingList: options.addToReadingList
  })
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
