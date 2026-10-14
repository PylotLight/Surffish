import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bindContentsToWindow, currentBrowserWindow } from './window-scope'
import { app, clipboard, ClipboardItem, dialog, ipcMain, nativeImage, WebContentsView, type BaseWindow, type IpcMainEvent, type NativeImage, type WebContents } from 'electron'
import type { BrowserBounds } from '../shared/types'
import {
  fullPageClip,
  looksLikePng,
  MAX_SCREENSHOT_SIDE_PX,
  parseRect,
  previewPopoverBounds,
  regionToImagePixels,
  screenshotFilename,
  stitchPlan,
  stitchRowsInPixels,
  withPngExtension,
  type ScreenshotMode
} from '../shared/screenshot'
import { recordSavedFile } from './downloads'
import { SCREENSHOT_PAGE_HTML } from './screenshot-page'
import { scrollingBarBounds } from '../shared/screenshot-scrolling'
import { finishScrollShot, readScrollShotState, setScrollShotAuto, startScrollShot, teardownScrollShot } from './screenshot-scrolling'

/**
 * Screenshot tool: visible area, full page (CDP, falling back to scroll-and-stitch) and a dragged
 * region, then a small preview popover with Copy / Save… / Annotate.
 *
 * The UI is its own transparent WebContentsView (see screenshot-page.ts) stacked above every
 * other layer while it is up. In select mode it covers the page area and shows the page frozen
 * (the visible capture is taken first), so region math is against exactly the pixels the user
 * sees. Nothing is ever written to disk except through the Save dialog, private tabs included.
 */

export interface ScreenshotTarget {
  contents: WebContents
  isPrivate: boolean
  url: string
}

export interface ScreenshotHost {
  /** The active tab's page, or null when there is nothing capturable (New Tab, a panel). */
  getTarget(): ScreenshotTarget | null
  getPageBounds(): BrowserBounds
  focusPage(): void
  /** Short status message near the page (e.g. "Nothing to capture here"). */
  flash(message: string): void
  /** Run a browser Cmd/Ctrl shortcut while the overlay has focus. */
  handleShortcut(input: Electron.Input): boolean
}

interface PixelImage {
  png: Buffer
  width: number
  height: number
}

type OverlayMode = 'select' | 'busy' | 'preview' | 'annotate' | 'scrolling'

interface Session {
  target: ScreenshotTarget
  /** The visible area as captured when the tool opened; select mode crops from it. */
  frozen: PixelImage | null
  /** The screenshot the popover is showing (after any annotations were applied). */
  shot: PixelImage | null
  truncated: boolean
  mode: OverlayMode
  /** Page view size (DIP) when the frozen frame was taken; the region rect is in these units. */
  viewSize: { width: number; height: number }
  /** Bitmap pixels per page DIP, from the frozen frame (screen scale; page zoom is already in the DIP size). */
  ratio?: number
  dispose: () => void
}

const POPOVER_SIZE = { width: 340, height: 292 }
const SCROLL_BAR_SIZE = { width: 600, height: 52 }
const SCROLL_POLL_MS = 150
const ISOLATED_WORLD_ID = 2026
const MAX_INCOMING_PNG_BYTES = 256 * 1024 * 1024
const STITCH_SETTLE_MS = 90
/** The preview popover dismisses itself after this long untouched (paused while the pointer is over it). */
const PREVIEW_IDLE_MS = 20_000

// One overlay serves every window: it moves to whichever window takes a screenshot (one capture at a time).
let ownerWindow: BaseWindow | null = null
let host: ScreenshotHost | null = null
const hosts = new Map<BaseWindow, { host: ScreenshotHost; onResize: () => void }>()
let view: WebContentsView | null = null
let pageReady = false
let pendingShow: Record<string, unknown> | null = null
let session: Session | null = null
let ipcRegistered = false
let busy = false
let previewTimer: ReturnType<typeof setTimeout> | null = null
let previewHovered = false
let previewSaving = false

function previewIdleMs(): number {
  // Smoke tests (unpackaged builds only) shorten or stretch the timeout.
  const override = !app.isPackaged ? Number(process.env['SURFFISH_SCREENSHOT_PREVIEW_IDLE_MS']) : NaN
  return Number.isFinite(override) && override > 0 ? override : PREVIEW_IDLE_MS
}

function clearPreviewTimer(): void {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = null
}

/** (Re)start the idle countdown while the preview is showing and nobody is using it. */
function armPreviewTimer(): void {
  clearPreviewTimer()
  if (session?.mode !== 'preview' || previewHovered || previewSaving) return
  const current = session
  previewTimer = setTimeout(() => {
    previewTimer = null
    if (session !== current || session.mode !== 'preview' || previewHovered || previewSaving) return
    // Only hand focus back to the page if the popover still had it (don't steal it from wherever the user went).
    endSession(liveView()?.webContents.isFocused() ?? false)
  }, previewIdleMs())
}

function preloadPath(): string | null {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../preload/screenshot.cjs')
  return existsSync(path) ? path : null
}

function liveView(): WebContentsView | null {
  return view && !view.webContents.isDestroyed() ? view : null
}

function fromOverlay(event: IpcMainEvent): boolean {
  const current = liveView()
  return Boolean(current && event.sender === current.webContents)
}

/**
 * capturePage() hands back an image whose representation may be at the screen's scale factor.
 * Re-decode its PNG at the highest scale so every later size and crop is in real bitmap pixels.
 */
function toPixelImage(image: NativeImage): PixelImage | null {
  if (image.isEmpty()) return null
  const scale = Math.max(1, ...image.getScaleFactors())
  const png = image.toPNG({ scaleFactor: scale })
  return pixelImageFromPng(png)
}

function pixelImageFromPng(png: Buffer): PixelImage | null {
  const flat = nativeImage.createFromBuffer(png)
  if (flat.isEmpty()) return null
  const { width, height } = flat.getSize()
  return width > 0 && height > 0 ? { png, width, height } : null
}

function dataUrl(image: PixelImage): string {
  return `data:image/png;base64,${image.png.toString('base64')}`
}

async function captureVisible(contents: WebContents): Promise<PixelImage | null> {
  if (contents.isDestroyed()) return null
  try {
    return toPixelImage(await contents.capturePage())
  } catch {
    return null
  }
}

type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>

/**
 * Run CDP commands on the page without stepping on anyone else's session. If the debugger is
 * already attached (the network inspector keeps one per tab while it records), reuse it and leave
 * it attached. Otherwise attach just for this task and detach afterwards. Never enables domains,
 * so the other client's event stream is untouched.
 */
async function withPageDebugger<T>(contents: WebContents, task: (send: CdpSend) => Promise<T>): Promise<T | null> {
  if (contents.isDestroyed()) return null
  const debuggerApi = contents.debugger
  let attachedHere = false
  if (!debuggerApi.isAttached()) {
    try {
      debuggerApi.attach('1.3')
      attachedHere = true
    } catch {
      // DevTools (or another client) holds it in a way we can't share: let the caller fall back.
      return null
    }
  }
  try {
    return await task((method, params) => debuggerApi.sendCommand(method, params))
  } catch (error) {
    console.warn('[screenshot] CDP capture failed:', error instanceof Error ? error.message : error)
    return null
  } finally {
    if (attachedHere && !contents.isDestroyed() && debuggerApi.isAttached()) {
      try { debuggerApi.detach() } catch { /* already gone */ }
    }
  }
}

async function devicePixelRatio(contents: WebContents): Promise<number> {
  try {
    // Resolves to the last script's value (not an array).
    const value: unknown = await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: 'window.devicePixelRatio' }])
    return typeof value === 'number' && value > 0 && Number.isFinite(value) ? value : 1
  } catch {
    return 1
  }
}

async function captureFullPageWithCdp(contents: WebContents): Promise<{ image: PixelImage; truncated: boolean } | null> {
  const ratio = await devicePixelRatio(contents)
  return withPageDebugger(contents, async (send) => {
    const metrics = await send('Page.getLayoutMetrics') as {
      cssContentSize?: { width: number; height: number }
      contentSize?: { width: number; height: number }
    }
    const size = metrics.cssContentSize ?? metrics.contentSize
    if (!size) return null
    const plan = fullPageClip(size, ratio)
    if (!plan) return null
    const result = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      fromSurface: true,
      clip: plan.clip
    }) as { data?: string }
    if (typeof result?.data !== 'string') return null
    const image = pixelImageFromPng(Buffer.from(result.data, 'base64'))
    return image ? { image, truncated: plan.truncated } : null
  })
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fallback: scroll the window a viewport at a time and stack the new rows of each capture.
 * Works for pages that scroll the document (not an inner scroller); fixed headers repeat.
 */
async function captureFullPageByStitching(contents: WebContents): Promise<{ image: PixelImage; truncated: boolean } | null> {
  const run = async (code: string): Promise<unknown> => {
    return contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code }]) as Promise<unknown>
  }
  const info = await run(`({ x: scrollX, y: scrollY, viewport: innerHeight,
    total: Math.max(document.documentElement ? document.documentElement.scrollHeight : 0, document.body ? document.body.scrollHeight : 0) })`)
    .catch(() => null) as { x: number; y: number; viewport: number; total: number } | null
  if (!info || !(info.viewport > 0)) return null
  const first = await captureVisible(contents)
  if (!first) return null
  const ratio = first.height / info.viewport
  const plan = stitchPlan(info.total, info.viewport, Math.floor(MAX_SCREENSHOT_SIDE_PX / Math.max(ratio, 0.01)))
  if (plan.steps.length === 0) return null
  const width = first.width
  const rows: Buffer[] = []
  let height = 0
  try {
    for (const step of plan.steps) {
      if (contents.isDestroyed()) return null
      await run(`window.scrollTo({ left: ${Math.round(info.x)}, top: ${step.scrollY}, behavior: 'instant' })`)
      await run('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
      await delay(STITCH_SETTLE_MS)
      const slice = await captureVisible(contents)
      if (!slice || slice.width !== width) return null
      const bitmap = nativeImage.createFromBuffer(slice.png).toBitmap()
      const { top, height: sliceHeight } = stitchRowsInPixels(step, info.viewport, slice.height)
      const stride = width * 4
      rows.push(Buffer.from(bitmap.subarray(top * stride, (top + sliceHeight) * stride)))
      height += sliceHeight
    }
  } finally {
    if (!contents.isDestroyed()) {
      await run(`window.scrollTo({ left: ${Math.round(info.x)}, top: ${Math.round(info.y)}, behavior: 'instant' })`).catch(() => undefined)
    }
  }
  if (height < 1) return null
  const stitched = nativeImage.createFromBitmap(Buffer.concat(rows), { width, height })
  const image = pixelImageFromPng(stitched.toPNG())
  return image ? { image, truncated: plan.truncated } : null
}

async function captureFullPage(contents: WebContents): Promise<{ image: PixelImage; truncated: boolean } | null> {
  // Smoke tests (unpackaged builds only) can force the fallback path.
  const forceStitch = !app.isPackaged && process.env['SURFFISH_SCREENSHOT_SMOKE_FORCE_STITCH'] === '1'
  const viaCdp = forceStitch ? null : await captureFullPageWithCdp(contents)
  if (viaCdp) return viaCdp
  console.info('[screenshot] CDP full-page capture unavailable; scrolling and stitching instead')
  return captureFullPageByStitching(contents).catch(() => null)
}

// ---------------------------------------------------------------------------
// Overlay view

function send(payload: Record<string, unknown>): void {
  const current = liveView()
  if (!current) return
  if (!pageReady) {
    // Keep the latest frame's image if a later message (e.g. busy) arrives before the page loads.
    pendingShow = { ...(pendingShow ?? {}), ...payload }
    return
  }
  current.webContents.send('screenshot:show', payload)
}

function sendStatus(text: string, kind: 'ok' | 'error' | '' = ''): void {
  liveView()?.webContents.send('screenshot:status', { text, kind })
}

function layout(): void {
  const current = liveView()
  if (!current || !host) return
  if (!session) {
    current.setVisible(false)
    current.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    return
  }
  const page = host.getPageBounds()
  if (page.width <= 0 || page.height <= 0) {
    current.setVisible(false)
    return
  }
  current.setBounds(session.mode === 'preview'
    ? previewPopoverBounds(page, POPOVER_SIZE)
    : session.mode === 'scrolling' ? scrollingBarBounds(page, SCROLL_BAR_SIZE) : page)
  current.setVisible(true)
}

let layoutTimer: ReturnType<typeof setTimeout> | null = null

/** Page bounds follow a window resize a tick later (browser-shell lays out on setImmediate). */
function scheduleLayout(): void {
  if (layoutTimer) return
  layoutTimer = setTimeout(() => {
    layoutTimer = null
    layout()
  }, 16)
}

function overlayKeyAction(input: Electron.Input): 'copy' | 'save' | 'undo' | null {
  if (input.type !== 'keyDown' || input.alt) return null
  const primary = process.platform === 'darwin' ? input.meta : input.control
  if (!primary) return null
  const key = input.key.toLowerCase()
  if (key === 'c' && !input.shift) return 'copy'
  if (key === 's' && !input.shift) return 'save'
  if (key === 'z' && !input.shift) return 'undo'
  return null
}

function ensureView(): WebContentsView | null {
  if (!ownerWindow || ownerWindow.isDestroyed()) return null
  const existing = liveView()
  if (existing) {
    // Re-append so it stays the topmost child even if other views were added since.
    ownerWindow.contentView.addChildView(existing)
    return existing
  }
  const preload = preloadPath()
  if (!preload) {
    console.warn('[screenshot] preload missing; screenshot overlay unavailable')
    return null
  }
  const created = new WebContentsView({
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      transparent: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  })
  created.setBackgroundColor('#00000000')
  created.setVisible(false)
  created.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.webContents.on('will-navigate', (event) => event.preventDefault())
  created.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || (!input.control && !input.meta)) return
    const action = overlayKeyAction(input)
    if (action) {
      // Keep Cmd+C/S/Z from the app menu (Copy, Save Edited PDF…, Undo); the page decides.
      event.preventDefault()
      if (!input.isAutoRepeat) created.webContents.send('screenshot:key', action)
      armPreviewTimer()
      return
    }
    // Enter is plain; everything else Cmd/Ctrl goes to the browser (Cmd+Shift+S closes the tool).
    if (host?.handleShortcut(input)) event.preventDefault()
  })
  created.webContents.on('render-process-gone', () => {
    if (view === created) {
      view = null
      pageReady = false
      endSession(false)
    }
  })
  ownerWindow.contentView.addChildView(created)
  bindContentsToWindow(created.webContents, ownerWindow)
  view = created
  pageReady = false
  void created.webContents
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SCREENSHOT_PAGE_HTML)}`)
    .catch((error: unknown) => console.error('[screenshot] could not load overlay:', error))
  return created
}

function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.on('screenshot:ready', (event) => {
    if (!fromOverlay(event)) return
    pageReady = true
    event.sender.setZoomFactor(1)
    if (pendingShow) {
      const payload = pendingShow
      pendingShow = null
      event.sender.send('screenshot:show', payload)
    }
  })
  ipcMain.on('screenshot:cancel', (event) => {
    if (fromOverlay(event)) endSession()
  })
  ipcMain.on('screenshot:preview-hover', (event, hovered: unknown) => {
    if (!fromOverlay(event)) return
    previewHovered = hovered === true
    armPreviewTimer()
  })
  ipcMain.on('screenshot:preview-activity', (event) => {
    if (fromOverlay(event)) armPreviewTimer()
  })
  ipcMain.on('screenshot:visible', (event) => {
    if (!fromOverlay(event) || session?.mode !== 'select' || !session.frozen) return
    showPreview(session.frozen, false)
  })
  ipcMain.on('screenshot:region', (event, input: unknown) => {
    if (!fromOverlay(event) || session?.mode !== 'select' || !session.frozen) return
    const rect = parseRect(input)
    const frozen = session.frozen
    const pixels = rect ? regionToImagePixels(rect, session.viewSize, frozen) : null
    if (!pixels) return
    const cropped = nativeImage.createFromBuffer(frozen.png).crop(pixels)
    const image = toPixelImage(cropped)
    if (image) showPreview(image, false)
  })
  ipcMain.on('screenshot:full', (event) => {
    if (!fromOverlay(event) || session?.mode !== 'select') return
    void runFullPage()
  })
  ipcMain.on('screenshot:scrolling', (event, input: unknown) => {
    if (!fromOverlay(event) || session?.mode !== 'select') return
    void startScrolling(input === null || input === undefined ? null : parseRect(input))
  })
  ipcMain.on('screenshot:scroll-done', (event) => {
    if (fromOverlay(event) && session?.mode === 'scrolling') void finishScrolling()
  })
  ipcMain.on('screenshot:scroll-auto', (event, on: unknown) => {
    if (!fromOverlay(event) || session?.mode !== 'scrolling') return
    const target = session.target
    void setScrollShotAuto(target.contents, on === true).then(() => { if (session?.target === target) host?.focusPage() })
  })
  ipcMain.on('screenshot:annotate', (event, open: unknown) => {
    if (!fromOverlay(event) || !session?.shot) return
    if (open === true && session.mode === 'preview') {
      session.mode = 'annotate'
      clearPreviewTimer()
      layout()
      liveView()?.webContents.focus()
      send({ mode: 'annotate', isPrivate: session.target.isPrivate })
    } else if (open === false && session.mode === 'annotate') {
      showPreview(session.shot, session.truncated)
    }
  })
  ipcMain.on('screenshot:update', (event, bytes: unknown) => {
    if (!fromOverlay(event) || session?.mode !== 'annotate') return
    const image = incomingImage(bytes)
    showPreview(image ?? session.shot!, session.truncated, image ? 'Annotations applied' : '')
  })
  ipcMain.on('screenshot:copy', (event, bytes: unknown) => {
    if (!fromOverlay(event) || !session?.shot) return
    const image = bytes === null || bytes === undefined ? session.shot : incomingImage(bytes)
    if (!image) return sendStatus('Could not read the annotated image.', 'error')
    armPreviewTimer()
    void clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.png)], { type: 'image/png' }) })])
      .then(() => sendStatus('Copied to the clipboard', 'ok'), () => sendStatus('Could not copy the screenshot.', 'error'))
  })
  ipcMain.on('screenshot:save', (event, bytes: unknown) => {
    if (!fromOverlay(event) || !session?.shot) return
    const image = bytes === null || bytes === undefined ? session.shot : incomingImage(bytes)
    if (!image) return sendStatus('Could not read the annotated image.', 'error')
    void saveScreenshot(image)
  })
}

function incomingImage(bytes: unknown): PixelImage | null {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_INCOMING_PNG_BYTES || !looksLikePng(bytes)) return null
  return pixelImageFromPng(Buffer.from(bytes))
}

function showPreview(image: PixelImage, truncated: boolean, message = ''): void {
  if (!session) return
  session.shot = image
  session.truncated = truncated
  session.mode = 'preview'
  previewHovered = false
  // The frozen frame is no longer needed once something is captured.
  session.frozen = null
  layout()
  liveView()?.webContents.focus()
  send({
    mode: 'preview',
    image: { url: dataUrl(image), width: image.width, height: image.height, pixelRatio: pixelRatioOf(image) },
    isPrivate: session.target.isPrivate,
    truncated,
    message,
    messageKind: message ? 'ok' : ''
  })
  armPreviewTimer()
}

/** Device pixels per page DIP, so annotation strokes look the same size on 1x and Retina. */
function pixelRatioOf(image: PixelImage): number {
  const width = session?.viewSize.width ?? 0
  // A region is narrower than the view, so prefer the ratio measured on the frozen frame.
  const ratio = session?.ratio ?? (width > 0 ? image.width / width : 1)
  return Number.isFinite(ratio) ? Math.max(1, Math.min(4, ratio)) : 1
}

async function runFullPage(): Promise<void> {
  const current = session
  if (!current || busy) return
  busy = true
  current.mode = 'busy'
  layout()
  send({ mode: 'busy', message: 'Capturing full page…', isPrivate: current.target.isPrivate })
  try {
    const result = await captureFullPage(current.target.contents)
    if (session !== current) return
    if (!result) {
      host?.flash('Could not capture the full page')
      endSession()
      return
    }
    showPreview(result.image, result.truncated)
  } finally {
    busy = false
  }
}

async function saveScreenshot(image: PixelImage): Promise<void> {
  const current = session
  if (!current) return
  const options: Electron.SaveDialogOptions = {
    title: 'Save Screenshot',
    defaultPath: join(app.getPath('downloads'), screenshotFilename(new Date())),
    filters: [{ name: 'PNG image', extensions: ['png'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  }
  // Smoke tests (unpackaged builds only) save without the native dialog.
  const smokePath = !app.isPackaged ? process.env['SURFFISH_SCREENSHOT_SMOKE_SAVE_PATH'] : undefined
  // Don't let the preview time out from under the Save dialog.
  previewSaving = true
  clearPreviewTimer()
  let result: Electron.SaveDialogReturnValue
  try {
    result = smokePath
      ? { canceled: false, filePath: smokePath }
      : ownerWindow && !ownerWindow.isDestroyed() ? await dialog.showSaveDialog(ownerWindow, options) : await dialog.showSaveDialog(options)
  } finally {
    previewSaving = false
    if (session === current) armPreviewTimer()
  }
  if (result.canceled || !result.filePath) return
  const target = withPngExtension(result.filePath)
  try {
    await writeFile(target, image.png)
  } catch {
    if (session === current) sendStatus('Could not save the screenshot.', 'error')
    return
  }
  // Private tabs: listed for this session only, never written to download history.
  recordSavedFile({ filePath: target, sourceUrl: current.target.url, bytes: image.png.byteLength, isPrivate: current.target.isPrivate })
  if (session === current) sendStatus(`Saved ${basename(target)}`, 'ok')
}

function endSession(refocus = true): void {
  const ending = session
  session = null
  pendingShow = null
  clearPreviewTimer()
  previewHovered = false
  ending?.dispose()
  const current = liveView()
  if (current) {
    if (pageReady) current.webContents.send('screenshot:show', { mode: 'hidden' })
    current.setVisible(false)
    current.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  }
  if (ending && refocus) host?.focusPage()
}

function watchTarget(target: ScreenshotTarget): () => void {
  const { contents } = target
  const onNavigate = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
    // The capture is of the old page; a frozen frame or busy capture would now be wrong.
    if (details.isMainFrame && !details.isSameDocument && session && session.target === target && session.mode !== 'preview' && session.mode !== 'annotate') endSession(false)
  }
  const onGone = (): void => { if (session?.target === target) endSession(false) }
  contents.on('did-start-navigation', onNavigate)
  contents.once('destroyed', onGone)
  contents.on('render-process-gone', onGone)
  return () => {
    if (contents.isDestroyed()) return
    contents.off('did-start-navigation', onNavigate)
    contents.off('destroyed', onGone)
    contents.off('render-process-gone', onGone)
  }
}

// ---------------------------------------------------------------------------
// Public API

export function attachScreenshots(win: BaseWindow, screenshotHost: ScreenshotHost): void {
  detachScreenshots(win)
  const onResize = (): void => { if (ownerWindow === win) scheduleLayout() }
  hosts.set(win, { host: screenshotHost, onResize })
  registerIpc()
  win.on('resize', onResize)
  if (!ownerWindow) {
    ownerWindow = win
    host = screenshotHost
  }
}

export function detachScreenshots(win?: BaseWindow): void {
  const target = win ?? ownerWindow
  if (!target) return
  const entry = hosts.get(target)
  hosts.delete(target)
  if (entry && !target.isDestroyed()) target.removeListener('resize', entry.onResize)
  if (ownerWindow !== target) return
  endSession(false)
  const closing = liveView()
  view = null
  pageReady = false
  if (closing) closing.webContents.close()
  ownerWindow = null
  host = null
}

/** Point the overlay at `win` (the window taking the screenshot), moving the view over if it exists. */
function useWindow(win: BaseWindow | null): void {
  if (!win || win === ownerWindow || win.isDestroyed()) return
  const entry = hosts.get(win)
  if (!entry) return
  if (session) endSession(false)
  const existing = liveView()
  if (existing && ownerWindow && !ownerWindow.isDestroyed() && ownerWindow.contentView.children.includes(existing)) {
    ownerWindow.contentView.removeChildView(existing)
  }
  ownerWindow = win
  host = entry.host
  if (existing) bindContentsToWindow(existing.webContents, win)
}

/** Diagnostics: the overlay's web contents id once it has been created. */
export function getScreenshotContentsId(): number | null {
  return liveView()?.webContents.id ?? null
}

export function getScreenshotContentsIds(): number[] {
  const id = getScreenshotContentsId()
  return id === null ? [] : [id]
}

/**
 * Cmd/Ctrl+Shift+S, the palette and the page context menu. `choose` opens the frozen-page
 * selector (drag a region, or Visible Area / Full Page); `visible` and `full` go straight to the
 * preview. Running it again while the selector is up closes it.
 */
export async function takeScreenshot(mode: ScreenshotMode = 'choose'): Promise<boolean> {
  useWindow(currentBrowserWindow())
  if (!host || !ownerWindow || ownerWindow.isDestroyed()) return false
  if (session) {
    const wasSelecting = session.mode === 'select' || session.mode === 'scrolling'
    endSession()
    if (wasSelecting && (mode === 'choose' || mode === 'scrolling')) return false
  }
  const target = host.getTarget()
  if (!target || target.contents.isDestroyed()) {
    host.flash('Nothing to capture on this page')
    return false
  }
  const overlay = ensureView()
  if (!overlay) return false
  const page = host.getPageBounds()
  const frozen = mode === 'full' ? null : await captureVisible(target.contents)
  if (mode !== 'full' && !frozen) {
    host.flash('Could not capture this page')
    return false
  }
  const viewSize = { width: page.width, height: page.height }
  const current: Session = {
    target,
    frozen,
    shot: null,
    truncated: false,
    mode: 'select',
    viewSize,
    ratio: frozen && page.width > 0 ? frozen.width / page.width : undefined,
    dispose: () => undefined
  }
  current.dispose = watchTarget(target)
  session = current
  if (mode === 'visible' && frozen) {
    showPreview(frozen, false)
    return true
  }
  if (mode === 'full') {
    await runFullPage()
    return session === current
  }
  layout()
  overlay.webContents.focus()
  send({
    mode: 'select',
    image: { url: dataUrl(frozen!), width: frozen!.width, height: frozen!.height, pixelRatio: current.ratio ?? 1 },
    isPrivate: target.isPrivate,
    scrolling: mode === 'scrolling'
  })
  return true
}

// ---------------------------------------------------------------------------
// Scrolling capture (see screenshot-scrolling.ts): the overlay shrinks to a bar, the live page
// scrolls underneath, and the capture is taken once the user picks the end.

const scrollShotDeps = { captureVisible, pixelImageFromPng, withPageDebugger }

async function startScrolling(rect: ReturnType<typeof parseRect>): Promise<void> {
  const current = session
  if (!current || busy) return
  const { contents } = current.target
  current.mode = 'scrolling'
  current.frozen = null
  layout()
  send({ mode: 'scrolling', isPrivate: current.target.isPrivate, region: Boolean(rect) })
  const started = await startScrollShot(contents, rect, current.viewSize.width, MAX_SCREENSHOT_SIDE_PX)
  if (session !== current) {
    void teardownScrollShot(contents)
    return
  }
  if (!started) {
    host?.flash('Could not start a scrolling screenshot on this page')
    endSession()
    return
  }
  // Enter / Esc while the page has focus (it does, so wheel, arrows and Space scroll it).
  const onInput = (event: Electron.Event, input: Electron.Input): void => {
    if (session !== current || current.mode !== 'scrolling' || input.type !== 'keyDown') return
    if (input.control || input.meta || input.alt) return
    if (input.key === 'Enter') {
      event.preventDefault()
      void finishScrolling()
    } else if (input.key === 'Escape') {
      event.preventDefault()
      endSession()
    }
  }
  contents.on('before-input-event', onInput)
  let polling = false
  const timer = setInterval(() => {
    if (polling || session !== current || current.mode !== 'scrolling') return
    // Switching tabs (or the tab going away) cancels: the bar would be over another page.
    if (host?.getTarget()?.contents !== contents) {
      endSession(false)
      return
    }
    polling = true
    void readScrollShotState(contents).then((state) => {
      polling = false
      if (!state || session !== current || current.mode !== 'scrolling') return
      if (state.clickY !== null) {
        void finishScrolling()
        return
      }
      const cssHeight = Math.min(state.height, state.maxCss)
      liveView()?.webContents.send('screenshot:scroll-state', {
        width: Math.round(state.width * state.dpr),
        height: Math.round(cssHeight * state.dpr),
        atLimit: state.height >= state.maxCss,
        auto: state.auto,
        inner: state.inner
      })
    })
  }, SCROLL_POLL_MS)
  const previousDispose = current.dispose
  current.dispose = () => {
    clearInterval(timer)
    if (!contents.isDestroyed()) {
      contents.off('before-input-event', onInput)
      // Cancelled mid-scroll: take the guides off the page. (After a capture it is already clean.)
      if (current.mode === 'scrolling') void teardownScrollShot(contents)
    }
    previousDispose()
  }
  host?.focusPage()
}

async function finishScrolling(): Promise<void> {
  const current = session
  if (!current || current.mode !== 'scrolling' || busy) return
  busy = true
  current.mode = 'busy'
  layout()
  send({ mode: 'busy', message: 'Capturing…', isPrivate: current.target.isPrivate })
  try {
    const forceStitch = !app.isPackaged && process.env['SURFFISH_SCREENSHOT_SMOKE_FORCE_STITCH'] === '1'
    const result = await finishScrollShot(current.target.contents, scrollShotDeps, MAX_SCREENSHOT_SIDE_PX, forceStitch)
    if (session !== current) return
    if (!result) {
      host?.flash('Could not capture the scrolling screenshot')
      endSession()
      return
    }
    showPreview(result.image, result.truncated)
  } finally {
    busy = false
  }
}

