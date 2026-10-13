import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, ipcMain, Menu, net, session, WebContentsView, type BaseWindow, type CustomScheme, type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type WebContents } from 'electron'
import readerableSource from '@mozilla/readability/Readability-readerable.js?raw'
import readabilitySource from '@mozilla/readability/Readability.js?raw'
import {
  buildExtractScript,
  buildReaderableScript,
  DEFAULT_READER_SETTINGS,
  isArticleImageAllowed,
  isReaderCandidateUrl,
  isReaderUrl,
  MAX_READER_IMAGE_BYTES,
  normalizeReaderSettings,
  parseExtractedArticle,
  parseReaderableResult,
  parseReaderImageRequest,
  READER_IMAGE_PATH,
  READER_SCHEME,
  READER_URL,
  READER_WORLD_ID,
  readerAssetPath,
  type ReaderArticle,
  type ReaderSettings,
  type ReaderTabState
} from '../shared/reader'
import { isMainWindowRenderer } from './browser-shell'
import { backgroundNetworkBlockedReason } from './background-network'
import { deferWrite } from './deferred-writes'
import { isShowingPdf } from './pdf-viewer'
import { readUserJson, writeUserJson } from './user-json'

/**
 * Reader view. After each load a tab runs Readability's cheap isProbablyReaderable in an isolated
 * world (pages can't see or patch it); a hit lights the omnibox Reader button. Opening it runs
 * Readability.parse() there on a clone of the document and shows the article in a second view laid
 * over the tab: the surffish-reader:// page on its own in-memory session that refuses every
 * network request. The page sanitizes the article with DOMPurify; its images are fetched here in
 * main with the tab's own session (cookies, proxy, kill switch) and only if the article uses them.
 * The original page stays loaded underneath, so Back to page is instant. Nothing about the article
 * is stored; only the reader's display settings are.
 */
export const READER_PARTITION = 'surffish-reader'
const SETTINGS_FILE = 'reader-settings.json'
const READERABLE_SCRIPT = buildReaderableScript(readerableSource)
const EXTRACT_SCRIPT = buildExtractScript(readabilitySource)
const CHECK_DELAY_MS = 600
const IN_PAGE_CHECK_DELAY_MS = 1_500
const IMAGE_TIMEOUT_MS = 20_000

export const READER_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: READER_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true }
}

const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'"
].join('; ')

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
}

export interface ReaderHost {
  /** The page WebContents of the active tab. */
  activePage(): WebContents | null
  isPrivate(page: WebContents): boolean
  /** Reader state of `page` changed: lay the views out again and publish the toolbar state. */
  changed(page: WebContents): void
  /** Browser shortcuts typed in the reader view, handled as if typed in the tab. */
  handleShortcut(page: WebContents, input: Electron.Input): boolean
  openInNewTab(page: WebContents, url: string, background: boolean): void
  /** A short notice near the bottom of the page (e.g. "No article found"). */
  notify(message: string): void
  /** The window `page`'s tab is in (the current window without a page). */
  window(page?: WebContents): BaseWindow | null
}

interface ReaderDocument {
  token: string
  page: WebContents
  view: WebContentsView
  article: ReaderArticle
  isPrivate: boolean
  sourceSession: Electron.Session
}

interface PageState {
  readerable: boolean
  /** Bumped by every readerable check, so only the latest result lands. */
  generation: number
  /** Bumped by every main-frame navigation, so an extraction that raced one is dropped. */
  navigation: number
  timer: ReturnType<typeof setTimeout> | null
  opening: boolean
  document: ReaderDocument | null
}

let host: ReaderHost | null = null
let readerSession: Electron.Session | null = null
let ipcRegistered = false
let settings: ReaderSettings | null = null
const pages = new Map<WebContents, PageState>()
const documentsByToken = new Map<string, ReaderDocument>()

export function attachReaderHost(next: ReaderHost): void {
  host = next
}

const mainDirectory = dirname(fileURLToPath(import.meta.url))

function rendererDirectory(): string {
  return resolve(mainDirectory, '../renderer')
}

function devServerUrl(): string | null {
  return !app.isPackaged && process.env['ELECTRON_RENDERER_URL'] ? process.env['ELECTRON_RENDERER_URL'] : null
}

function readerPreloadPath(): string | null {
  const candidates = [
    join(mainDirectory, '../preload/reader.cjs'),
    join(app.getAppPath(), 'out/preload/reader.cjs'),
    join(app.getAppPath(), 'src/preload/reader.cjs')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

async function serveFile(root: string, relative: string): Promise<Response> {
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(root + sep)) return new Response('Not found', { status: 404 })
  try {
    const body = await readFile(target)
    const headers: Record<string, string> = {
      'Content-Type': CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    }
    if (target.endsWith('.html')) headers['Content-Security-Policy'] = PAGE_CSP
    return new Response(body, { status: 200, headers })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

async function readBoundedBytes(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) throw new Error('too large')
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      throw new Error('too large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** One article image, fetched with the tab's session. Only images the article references. */
async function handleImageRequest(requestUrl: string): Promise<Response> {
  const request = parseReaderImageRequest(requestUrl)
  const document = request ? documentsByToken.get(request.token) : undefined
  if (!request || !document || !isArticleImageAllowed(request.url, document.article.content)) return new Response('Not found', { status: 404 })
  if (backgroundNetworkBlockedReason()) return new Response('Blocked', { status: 503 })
  try {
    const response = await document.sourceSession.fetch(request.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: { Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*;q=0.8' },
      referrer: document.article.url
    } as RequestInit)
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!response.ok || !type.startsWith('image/')) return new Response('Not found', { status: 404 })
    const bytes = await readBoundedBytes(response, MAX_READER_IMAGE_BYTES)
    return new Response(bytes, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

async function handleReaderRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === READER_IMAGE_PATH) return handleImageRequest(request.url)
  const devServer = devServerUrl()
  if (devServer) {
    // Dev: proxy the Vite dev server (it serves /src, /@vite and /node_modules paths too).
    const response = await net.fetch(new URL(`${url.pathname}${url.search}`, devServer).toString())
    const headers = new Headers(response.headers)
    if ((headers.get('content-type') ?? '').includes('text/html')) headers.set('Content-Security-Policy', PAGE_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'none'", "connect-src 'self' ws:"))
    return new Response(await response.arrayBuffer(), { status: response.status, headers })
  }
  const relative = readerAssetPath(request.url)
  return relative ? serveFile(rendererDirectory(), relative) : new Response('Not found', { status: 404 })
}

function isAllowedReaderRequest(url: string): boolean {
  return url.startsWith(`${READER_SCHEME}:`) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('devtools:')
}

/** Isolated, in-memory session for reader views: no cookies, no disk cache, no network. */
function getReaderSession(): Electron.Session {
  if (readerSession) return readerSession
  const created = session.fromPartition(READER_PARTITION, { cache: false })
  created.protocol.handle(READER_SCHEME, handleReaderRequest)
  created.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedReaderRequest(details.url) || (devServerUrl() !== null && details.url.startsWith('ws://'))
    callback({ cancel: !allowed })
  })
  created.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  created.setPermissionCheckHandler(() => false)
  created.on('will-download', (event) => event.preventDefault())
  readerSession = created
  return created
}

export function getReaderSettings(): ReaderSettings {
  if (!settings) settings = normalizeReaderSettings(readUserJson(SETTINGS_FILE) ?? DEFAULT_READER_SETTINGS)
  return settings
}

function setReaderSettings(value: unknown): ReaderSettings {
  settings = normalizeReaderSettings(value, getReaderSettings())
  const snapshot = settings
  deferWrite('reader-settings', () => { writeUserJson(SETTINGS_FILE, snapshot) })
  for (const document of documentsByToken.values()) {
    const contents = document.view.webContents
    if (!contents.isDestroyed()) contents.send('reader:settings', snapshot)
  }
  return snapshot
}

function stateFor(page: WebContents): PageState | undefined {
  return pages.get(page)
}

/** Watch a tab's page for articles. Call once per tab WebContents. */
export function attachReaderDetection(page: WebContents): void {
  if (pages.has(page)) return
  const state: PageState = { readerable: false, generation: 0, navigation: 0, timer: null, opening: false, document: null }
  pages.set(page, state)
  const reset = (): void => {
    state.generation += 1
    state.navigation += 1
    if (state.timer) clearTimeout(state.timer)
    state.timer = null
    const changed = state.readerable || state.document !== null
    state.readerable = false
    if (state.document) disposeDocument(state)
    if (changed) host?.changed(page)
  }
  page.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) reset()
  })
  page.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return
    // A single-page app changed route: the article on screen is not the reader's any more.
    if (state.document && !sameDocumentPath(state.document.article.url, url)) {
      disposeDocument(state)
      host?.changed(page)
    }
    scheduleCheck(page, state, IN_PAGE_CHECK_DELAY_MS)
  })
  page.on('did-stop-loading', () => scheduleCheck(page, state, CHECK_DELAY_MS))
  page.on('render-process-gone', () => reset())
  page.once('destroyed', () => {
    if (state.timer) clearTimeout(state.timer)
    if (state.document) disposeDocument(state)
    pages.delete(page)
  })
}

function sameDocumentPath(a: string, b: string): boolean {
  try {
    const left = new URL(a)
    const right = new URL(b)
    left.hash = ''
    right.hash = ''
    return left.toString() === right.toString()
  } catch {
    return a === b
  }
}

function scheduleCheck(page: WebContents, state: PageState, delay: number): void {
  if (state.timer) clearTimeout(state.timer)
  const generation = ++state.generation
  state.timer = setTimeout(() => {
    state.timer = null
    void runReaderableCheck(page, state, generation)
  }, delay)
  state.timer.unref?.()
}

async function runReaderableCheck(page: WebContents, state: PageState, generation: number): Promise<void> {
  if (page.isDestroyed()) return
  let readerable = false
  if (isReaderCandidateUrl(page.getURL()) && !isShowingPdf(page)) {
    try {
      readerable = parseReaderableResult(await page.executeJavaScriptInIsolatedWorld(READER_WORLD_ID, [{ code: READERABLE_SCRIPT }]))
    } catch {
      readerable = false
    }
  }
  if (page.isDestroyed() || generation !== state.generation || state.readerable === readerable) return
  state.readerable = readerable
  host?.changed(page)
}

export function readerStateFor(page: WebContents | null | undefined): ReaderTabState {
  const state = page && !page.isDestroyed() ? stateFor(page) : undefined
  if (!state) return null
  if (state.document) return 'active'
  return state.readerable ? 'available' : null
}

/** The reader view laid over `page`, while Reader view is open on it. */
export function readerViewFor(page: WebContents | null | undefined): WebContentsView | null {
  const document = page && !page.isDestroyed() ? stateFor(page)?.document : null
  return document && !document.view.webContents.isDestroyed() ? document.view : null
}

function disposeDocument(state: PageState): void {
  const document = state.document
  if (!document) return
  state.document = null
  documentsByToken.delete(document.token)
  const window = host?.window(document.page)
  if (window && !window.isDestroyed() && window.contentView.children.includes(document.view)) window.contentView.removeChildView(document.view)
  if (!document.view.webContents.isDestroyed()) document.view.webContents.close()
}

function readerDocumentFor(contents: WebContents): ReaderDocument | null {
  for (const document of documentsByToken.values()) if (document.view.webContents === contents) return document
  return null
}

function showReaderContextMenu(document: ReaderDocument, params: Electron.ContextMenuParams): void {
  const window = host?.window(document.page)
  if (!window || window.isDestroyed()) return
  const contents = document.view.webContents
  const items: MenuItemConstructorOptions[] = []
  const link = /^https?:\/\//i.test(params.linkURL) ? params.linkURL : null
  if (link) {
    items.push(
      { label: 'Open Link in New Tab', click: () => host?.openInNewTab(document.page, link, false) },
      { label: 'Open Link in Background Tab', click: () => host?.openInNewTab(document.page, link, true) },
      { type: 'separator' }
    )
  }
  if (params.selectionText.trim()) items.push({ label: 'Copy', click: () => contents.copy() })
  items.push(
    { label: 'Select All', click: () => contents.selectAll() },
    { type: 'separator' },
    { label: 'Back to Page', click: () => { closeReaderMode(document.page) } }
  )
  if (!app.isPackaged) items.push({ label: 'Inspect', click: () => contents.inspectElement(params.x, params.y) })
  const bounds = document.view.getBounds()
  Menu.buildFromTemplate(items).popup({ window, x: Math.round(bounds.x + params.x), y: Math.round(bounds.y + params.y) })
}

function createReaderView(page: WebContents, preload: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload,
      session: getReaderSession(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      nodeIntegrationInSubFrames: false,
      spellcheck: false,
      backgroundThrottling: true
    }
  })
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  const contents = view.webContents
  // Article links: a plain click loads the link in the tab (leaving Reader view); new-window clicks open tabs.
  contents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (!/^https?:\/\//i.test(url) || page.isDestroyed()) return
    closeReaderMode(page)
    void page.loadURL(url).catch(() => undefined)
  })
  contents.on('will-redirect', (event, url) => { if (!isReaderUrl(url)) event.preventDefault() })
  contents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url) && !page.isDestroyed()) host?.openInNewTab(page, details.url, details.disposition === 'background-tab')
    return { action: 'deny' }
  })
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || (!input.control && !input.meta)) return
    if (!page.isDestroyed() && host?.handleShortcut(page, input)) event.preventDefault()
  })
  contents.on('context-menu', (_event, params) => {
    const document = readerDocumentFor(contents)
    if (document) showReaderContextMenu(document, params)
  })
  contents.on('render-process-gone', () => {
    if (!page.isDestroyed() && stateFor(page)?.document?.view === view) closeReaderMode(page)
  })
  return view
}

/** Extract the article from `page` and show it in Reader view. */
export async function openReaderMode(page: WebContents | null = host?.activePage() ?? null): Promise<boolean> {
  if (!host || !page || page.isDestroyed()) return false
  const state = stateFor(page)
  if (!state) return false
  if (state.document) return true
  if (state.opening) return false
  const pageUrl = page.getURL()
  if (!/^https?:\/\//i.test(pageUrl) || isShowingPdf(page)) return false
  const preload = readerPreloadPath()
  if (!preload) {
    console.warn('[reader] preload missing; Reader view unavailable')
    return false
  }
  state.opening = true
  const navigation = state.navigation
  try {
    let raw: unknown
    try {
      raw = await page.executeJavaScriptInIsolatedWorld(READER_WORLD_ID, [{ code: EXTRACT_SCRIPT }])
    } catch {
      raw = { error: 'script failed' }
    }
    if (page.isDestroyed() || state.navigation !== navigation || page.getURL() !== pageUrl) return false
    const parsed = parseExtractedArticle(raw, pageUrl)
    if (!parsed.ok) {
      host.notify(parsed.error)
      return false
    }
    const view = createReaderView(page, preload)
    const document: ReaderDocument = {
      token: randomUUID(),
      page,
      view,
      article: parsed.article,
      isPrivate: host.isPrivate(page),
      // The tab's own session (private tabs: the in-memory private one): cookies, proxy, ad filtering.
      sourceSession: page.session
    }
    state.document = document
    documentsByToken.set(document.token, document)
    host.changed(page)
    void view.webContents.loadURL(READER_URL).catch((error: unknown) => console.warn('[reader] could not load the reader page:', error))
    if (host.activePage() === page) view.webContents.focus()
    return true
  } finally {
    state.opening = false
  }
}

/** Back to page: drop the reader view; the original page was never unloaded. */
export function closeReaderMode(page: WebContents | null = host?.activePage() ?? null): boolean {
  if (!page || page.isDestroyed()) return false
  const state = stateFor(page)
  if (!state?.document) return false
  disposeDocument(state)
  host?.changed(page)
  if (host?.activePage() === page) page.focus()
  return true
}

export async function toggleReaderMode(page: WebContents | null = host?.activePage() ?? null): Promise<boolean> {
  if (!page || page.isDestroyed()) return false
  return stateFor(page)?.document ? closeReaderMode(page) : openReaderMode(page)
}

function senderDocument(event: IpcMainEvent | IpcMainInvokeEvent): ReaderDocument | null {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame || !isReaderUrl(frame.url)) return null
  return readerDocumentFor(event.sender)
}

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) throw new Error('This browser operation is available only to the app window.')
}

export function registerReaderIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  // From the reader page (src/preload/reader.cjs).
  ipcMain.handle('reader:load', (event) => {
    const document = senderDocument(event)
    if (!document) return { ok: false, error: 'This article is no longer available.' }
    const { article } = document
    return { ok: true, token: document.token, isPrivate: document.isPrivate, settings: getReaderSettings(), article }
  })
  ipcMain.handle('reader:settings:set', (event, value: unknown) => {
    if (!senderDocument(event)) throw new Error('Only Reader view can change its settings.')
    return setReaderSettings(value)
  })
  ipcMain.on('reader:back', (event) => {
    const document = senderDocument(event)
    if (document) closeReaderMode(document.page)
  })
  // From the browser chrome (omnibox Reader button).
  ipcMain.handle('browser:reader:toggle', (event) => {
    assertMainRenderer(event)
    return toggleReaderMode()
  })
}
