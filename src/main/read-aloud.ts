import { app, BrowserWindow, net, session, type Session, type WebContents } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IDLE_READ_ALOUD_STATE,
  IDLE_READ_ALOUD_TEST,
  READ_ALOUD_DEFAULT_SEED,
  READ_ALOUD_MODEL_PATH,
  READ_ALOUD_PARTITION,
  READ_ALOUD_RUNTIME_PATH,
  READ_ALOUD_SCHEME,
  READ_ALOUD_URL,
  speechEndpointUrl,
  type ReadAloudCatalogInfo,
  type ReadAloudControl,
  type ReadAloudDownloadState,
  type ReadAloudEngineId,
  type ReadAloudSettings,
  type ReadAloudState,
  type ReadAloudStatus,
  type ReadAloudTestRequest,
  type ReadAloudTestState
} from '../shared/read-aloud'
import {
  DEFAULT_VOICE_FILE,
  parseModelConditioners,
  parseReadAloudTestManifest,
  PHONON_MANIFEST,
  type ModelConditioner,
  type ReadAloudManifest
} from '../shared/read-aloud-assets'
import { lookaheadFor, splitSpeed } from '../shared/read-aloud-speed'
import { MODEL_VOICE, publicVoice } from '../shared/read-aloud-voices'
import { articleTextFromHtml, splitSentences } from '../shared/read-aloud-text'
import { mergeTestStats, parseReadAloudTestRequest } from '../shared/read-aloud-tester'
import { backgroundNetworkBlockedReason } from './background-network'
import { getBrowserTabPageInfo, getBrowserTabRefByWebContentsId } from './browser'
import { getBrowserSession } from './browser-session'
import { sendToMainWindowRenderers } from './browser-shell'
import { loadPdfBytes, pdfEditorDocumentFor, type PdfEditorDocument } from './pdf-editor'
import { isShowingPdf, pdfViewerPage } from './pdf-viewer'
import { extractReaderArticle, readerArticleFor, readerViewFor } from './reader-mode'
import { noteReadAloudStatus, type ReadAloudPoint } from './read-aloud-feature'
import { readAloudDirectory } from './read-aloud-settings'
import { pageScriptSource, READ_ALOUD_HIGHLIGHT_CSS, sentenceIndexForProbe } from '../shared/read-aloud-page'
import { createReadAloudDownloads, ReadAloudDownloadCancelled } from './read-aloud-downloads'
import { browserWindows, onBrowserWindowsChanged } from './window-scope'

/**
 * Read Aloud (loaded on first use; see read-aloud-feature.ts for the gate).
 *
 * Text: the tab's article from Reader view's Readability extraction (or the selection), split into
 * sentences here. Speech: a hidden, never-shown window on its own in-memory session runs the engine
 * page (src/renderer/src/read-aloud/engine.ts) on surffish-tts://engine/. Its session serves only
 * its own files: the page, the official `phonon-tts` runtime and the Phonon 31M model, both
 * downloaded once into <userData>/read-aloud (read-aloud-downloads.ts: started when Read Aloud is
 * turned on, re-checked against the pinned hashes once per run), never bundled. The
 * page is cross-origin isolated (COOP/COEP), so Phonon's WebAssembly runs multi-threaded; audio plays
 * there through Web Audio, with a Media Session so hardware media keys and Now Playing work.
 *
 * Settings' voice tester speaks a sample through the same engine page and reports load time,
 * time to first audio and the real-time factor. One reading (or test) at a time, app-wide. It stops when its tab navigates or closes, or Read Aloud is
 * turned off. The engine window closes a while after the last reading, freeing the model's memory.
 * Nothing about the text is stored.
 */

/** The engine page (model, wasm threads, audio) closes this long after the last reading or test. */
const ENGINE_IDLE_CLOSE_MS = !app.isPackaged && Number(process.env['SURFFISH_READ_ALOUD_IDLE_MS']) > 0 ? Number(process.env['SURFFISH_READ_ALOUD_IDLE_MS']) : 3 * 60_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000
const SPEECH_TIMEOUT_MS = 60_000
/** A paused reading stops after this long, so the engine can close and free its memory. */
const PAUSED_STOP_MS = !app.isPackaged && Number(process.env['SURFFISH_READ_ALOUD_PAUSE_STOP_MS']) > 0 ? Number(process.env['SURFFISH_READ_ALOUD_PAUSE_STOP_MS']) : 10 * 60_000
/** pdf.js reading a PDF's text in the engine page. */
const PDF_TEXT_TIMEOUT_MS = 90_000
const NO_PDF_TEXT = 'This PDF has no readable text (it may be scanned images).'
/** Isolated world for the selection read, the live-page highlight and "Read from Here". */
const PAGE_WORLD_ID = 1311
const LOG_STATS = !app.isPackaged || process.env['SURFFISH_DEBUG_READ_ALOUD'] === '1'

interface Reading {
  token: number
  page: WebContents
  tabId: string | null
  title: string
  sentences: string[]
  isPrivate: boolean
  /** Phonon noise seed for this reading (the fixed default, or a new one with "vary each read"). */
  seed: number
  detach: () => void
  /**
   * Highlighting on the live page (no Reader view over it; Reader view highlights on its own): the
   * inserted ::highlight style's key once the page script is in.
   */
  live: { cssKey: string | null } | null
}

type EngineEvent =
  | { type: 'ready' }
  | { type: 'state'; token: number; status: 'loading' | 'playing' | 'paused' | 'finished' | 'error'; index?: number; engine?: ReadAloudEngineId; fallbackReason?: string; error?: string; stats?: unknown }
  | { type: 'pdf-text'; id: number; ok: boolean; sentences?: unknown; pageStarts?: unknown; title?: unknown; error?: unknown }

let state: ReadAloudState = { ...IDLE_READ_ALOUD_STATE }
let settings: ReadAloudSettings | null = null
let reading: Reading | null = null
let nextToken = 1
let startAttempts = 0
let engine: BrowserWindow | null = null
let engineReady: Promise<BrowserWindow> | null = null
let markEngineReady: (() => void) | null = null
let engineSession: Session | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let pausedTimer: ReturnType<typeof setTimeout> | null = null
let nextPdfRequest = 1
const pdfRequests = new Map<number, (event: Extract<EngineEvent, { type: 'pdf-text' }>) => void>()
let test: { token: number; request: ReadAloudTestRequest; seed: number } | null = null
let testState: ReadAloudTestState = { ...IDLE_READ_ALOUD_TEST }

const mainDirectory = dirname(fileURLToPath(import.meta.url))

// The hidden engine window counts as a window to Electron: with it open, closing the last browser
// window wouldn't quit the app on Windows/Linux. Close it with the last browser window.
onBrowserWindowsChanged(() => {
  if (browserWindows().length === 0 && engine && !reading) {
    stopTest()
    closeEngine()
  }
})

export function readAloudState(): ReadAloudState {
  return { ...state, download: state.download ? { ...state.download } : null }
}

function publish(patch: Partial<ReadAloudState>): void {
  state = { ...state, ...patch }
  noteReadAloudStatus(state.status)
  try { sendToMainWindowRenderers('browser:read-aloud:state', readAloudState()) } catch { /* window closing */ }
}

/**
 * The download manifest: the pinned Phonon files, or in an unpackaged smoke run, the smoke's own
 * small fixture files on 127.0.0.1 (SURFFISH_READ_ALOUD_TEST_MANIFEST, a JSON file path).
 */
let manifest: ReadAloudManifest | null = null
function readAloudManifest(): ReadAloudManifest {
  if (manifest) return manifest
  const testPath = !app.isPackaged ? process.env['SURFFISH_READ_ALOUD_TEST_MANIFEST'] : undefined
  if (testPath) {
    try {
      manifest = parseReadAloudTestManifest(JSON.parse(readFileSync(testPath, 'utf8')))
    } catch (error) {
      console.warn('[read aloud] test manifest ignored:', error)
    }
  }
  manifest ??= PHONON_MANIFEST
  return manifest
}

const downloads = createReadAloudDownloads({
  directory: readAloudDirectory,
  fetch: (url, init) => getBrowserSession().fetch(url, init),
  manifest: readAloudManifest,
  blockedReason: backgroundNetworkBlockedReason,
  timeoutMs: DOWNLOAD_TIMEOUT_MS,
  onState: onDownloadState
})

function onDownloadState(next: ReadAloudDownloadState): void {
  try { sendToMainWindowRenderers('browser:read-aloud:download', next) } catch { /* window closing */ }
  // A reading waiting for the model shows the same progress in the player.
  if (reading && state.status === 'downloading' && next.status === 'downloading') {
    publish({ download: { label: next.label, loaded: next.loaded, total: next.total } })
  }
}

export function readAloudDownloadState(): ReadAloudDownloadState {
  return downloads.state()
}

/** Turning Read Aloud on (or Retry / Resume in Settings): fetch what is missing now. Errors show in Settings. */
export function prepareReadAloud(): void {
  void downloads.ensureModel().catch(() => undefined)
}

/** The voice picked in Settings or the player: fetch it now (~256 KB) once the model is there. */
export function prefetchReadAloudVoice(voiceId: string): void {
  if (downloads.state().status !== 'ready') return
  void downloads.ensureVoice(voiceId).catch(() => undefined)
}

export function cancelReadAloudDownload(): void {
  downloads.cancel()
}

export async function deleteReadAloudDownloads(): Promise<ReadAloudDownloadState> {
  if (reading) {
    sendToEngine({ type: 'stop' })
    endReading()
  }
  stopTest()
  closeEngine()
  await downloads.deleteAll()
  return downloads.state()
}

/**
 * Model + voice for a reading or a test; a reading meanwhile shows the progress in the player.
 * Resolves to the voice to speak with ('default' for an id the catalog doesn't have).
 */
async function ensurePhononFiles(voiceId: string, showInPlayer: boolean): Promise<string> {
  if (!downloads.isReady()) {
    const current = downloads.state()
    // On disk already: just the once-per-run hash check, so the player keeps saying "Starting…".
    if (showInPlayer && current.status !== 'ready') publish({ status: 'downloading', download: { label: current.label || 'Preparing', loaded: current.loaded, total: current.total || current.bytes } })
    await downloads.ensureModel()
  }
  return downloads.ensureVoice(voiceId)
}

async function modelConditioners(): Promise<ModelConditioner[]> {
  try {
    return parseModelConditioners(JSON.parse(await readFile(join(readAloudDirectory(), readAloudManifest().modelFolder, 'config.json'), 'utf8')))
  } catch {
    return []
  }
}

/** The voice pickers (Settings, the player): the model voice plus the English catalog voices. */
export async function readAloudCatalog(): Promise<ReadAloudCatalogInfo> {
  if (downloads.state().status !== 'ready') return { status: 'needs-model', voices: [MODEL_VOICE], conditioners: [], error: '' }
  const conditioners = await modelConditioners()
  try {
    const voices = await downloads.ensureCatalog()
    return { status: 'ready', voices: [MODEL_VOICE, ...voices.map(publicVoice)], conditioners, error: '' }
  } catch (error) {
    return { status: 'error', voices: [MODEL_VOICE], conditioners, error: error instanceof Error ? error.message : String(error) }
  }
}

function newSeed(current: ReadAloudSettings): number {
  return current.varySeed ? Math.floor(Math.random() * 2 ** 48) : READ_ALOUD_DEFAULT_SEED
}

// ---------------------------------------------------------------------------
// Engine page

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.gguf': 'application/octet-stream',
  '.safetensors': 'application/octet-stream'
}

const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'"
].join('; ')

/** Cross-origin isolation: SharedArrayBuffer, so the wasm build runs on several threads. */
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff'
}

function devServerUrl(): string | null {
  return !app.isPackaged && process.env['ELECTRON_RENDERER_URL'] ? process.env['ELECTRON_RENDERER_URL'] : null
}

async function serveFile(root: string, relative: string, html: boolean): Promise<Response> {
  const target = resolve(root, relative)
  if (!target.startsWith(root + sep)) return new Response('Not found', { status: 404 })
  try {
    const body = await readFile(target)
    const headers: Record<string, string> = { ...ISOLATION_HEADERS, 'Content-Type': CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }
    if (html) headers['Content-Security-Policy'] = PAGE_CSP
    return new Response(body, { status: 200, headers })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

async function handleEngineRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = decodeURIComponent(url.pathname)
  if (path.startsWith(READ_ALOUD_RUNTIME_PATH)) return serveFile(downloads.runtimeDirectory(), path.slice(READ_ALOUD_RUNTIME_PATH.length), false)
  if (path.startsWith(READ_ALOUD_MODEL_PATH)) return serveFile(join(readAloudDirectory(), readAloudManifest().modelFolder), path.slice(READ_ALOUD_MODEL_PATH.length), false)
  const devServer = devServerUrl()
  if (devServer) {
    const response = await net.fetch(new URL(`${url.pathname}${url.search}`, devServer).toString())
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(ISOLATION_HEADERS)) headers.set(name, value)
    if ((headers.get('content-type') ?? '').includes('text/html')) headers.set('Content-Security-Policy', PAGE_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'self'", "connect-src 'self' ws:"))
    return new Response(await response.arrayBuffer(), { status: response.status, headers })
  }
  const relative = path.replace(/^\/+/, '')
  if (!relative || relative.includes('..')) return new Response('Not found', { status: 404 })
  return serveFile(resolve(mainDirectory, '../renderer'), relative, relative.endsWith('.html'))
}

function getEngineSession(): Session {
  if (engineSession) return engineSession
  // In-memory (no "persist:"): nothing the engine does reaches the disk except through main.
  const created = session.fromPartition(READ_ALOUD_PARTITION, { cache: false })
  created.protocol.handle(READ_ALOUD_SCHEME, handleEngineRequest)
  created.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(`${READ_ALOUD_SCHEME}:`) || details.url.startsWith('blob:') || details.url.startsWith('data:') || details.url.startsWith('devtools:') ||
      (devServerUrl() !== null && details.url.startsWith('ws://'))
    callback({ cancel: !allowed })
  })
  created.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  created.setPermissionCheckHandler(() => false)
  created.on('will-download', (event) => event.preventDefault())
  engineSession = created
  return created
}

function enginePreloadPath(): string | null {
  const candidates = [join(mainDirectory, '../preload/read-aloud-engine.cjs'), join(app.getAppPath(), 'out/preload/read-aloud-engine.cjs'), join(app.getAppPath(), 'src/preload/read-aloud-engine.cjs')]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function sendToEngine(command: Record<string, unknown>): void {
  const contents = engine && !engine.isDestroyed() ? engine.webContents : null
  if (contents && !contents.isDestroyed()) contents.send('read-aloud-engine:command', command)
}

function ensureEngine(): Promise<BrowserWindow> {
  if (engine && !engine.isDestroyed() && engineReady) return engineReady
  const preload = enginePreloadPath()
  if (!preload) return Promise.reject(new Error('Read Aloud engine preload is missing'))
  const window = new BrowserWindow({
    show: false,
    width: 240,
    height: 120,
    skipTaskbar: true,
    title: 'Surffish Read Aloud',
    webPreferences: {
      preload,
      session: getEngineSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Audio scheduling runs on timers; a throttled hidden page would stutter.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false
    }
  })
  engine = window
  const contents = window.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.ipc.on('read-aloud-engine:event', (_event, value: unknown) => onEngineEvent(value))
  contents.ipc.handle('read-aloud-engine:speech', (_event, text: unknown) => openAiSpeech(text))
  contents.on('render-process-gone', () => {
    if (engine !== window) return
    engine = null
    engineReady = null
    failPdfRequests('The Read Aloud engine stopped unexpectedly.')
    if (reading) failReading('The Read Aloud engine stopped unexpectedly.')
    if (test) finishTest({ status: 'error', error: 'The Read Aloud engine stopped unexpectedly.' })
  })
  window.on('closed', () => {
    if (engine === window) {
      engine = null
      engineReady = null
    }
  })
  engineReady = new Promise<BrowserWindow>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error('The Read Aloud engine did not start')), 20_000)
    markEngineReady = () => {
      clearTimeout(timer)
      resolveReady(window)
    }
    contents.once('did-fail-load', (_event, code, description) => {
      clearTimeout(timer)
      rejectReady(new Error(`The Read Aloud engine page failed to load (${description || code})`))
    })
  })
  void window.loadURL(READ_ALOUD_URL).catch(() => undefined)
  return engineReady
}

function failPdfRequests(error: string): void {
  for (const [id, resolveRequest] of [...pdfRequests]) resolveRequest({ type: 'pdf-text', id, ok: false, error })
  pdfRequests.clear()
}

function closeEngine(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  failPdfRequests('The Read Aloud engine closed.')
  const window = engine
  engine = null
  engineReady = null
  if (window && !window.isDestroyed()) window.destroy()
}

function scheduleEngineIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (!reading && !test && pdfRequests.size === 0) closeEngine()
  }, ENGINE_IDLE_CLOSE_MS)
  idleTimer.unref?.()
}

/** openai engine: one sentence from the local OpenAI-compatible server, as 24 kHz s16le PCM. */
async function openAiSpeech(text: unknown): Promise<{ ok: true; pcm: Uint8Array; sampleRate: number } | { ok: false; error: string }> {
  const current = settings
  const url = current ? speechEndpointUrl(current.endpoint) : null
  if (!url || typeof text !== 'string' || !text.trim()) return { ok: false, error: 'No local speech server is set.' }
  try {
    const response = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text.slice(0, 4000), voice: current!.endpointVoice || 'default', response_format: 'pcm', speed: current!.speed }),
      signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS)
    })
    if (!response.ok) return { ok: false, error: `The speech server answered HTTP ${response.status}.` }
    return { ok: true, pcm: new Uint8Array(await response.arrayBuffer()), sampleRate: 24000 }
  } catch (error) {
    return { ok: false, error: `Could not reach the speech server (${error instanceof Error ? error.message : String(error)}).` }
  }
}

// ---------------------------------------------------------------------------
// Readings

function highlight(page: WebContents, index: number, text: string): void {
  const view = readerViewFor(page)
  if (view && !view.webContents.isDestroyed()) {
    view.webContents.send('reader:read-aloud', { index, text })
    return
  }
  if (reading?.page !== page || !reading.live || page.isDestroyed()) return
  const code = index < 0 ? 'window.__surffishReadAloud?.clear()' : `window.__surffishReadAloud?.mark(${JSON.stringify(text)})`
  void page.executeJavaScriptInIsolatedWorld(PAGE_WORLD_ID, [{ code }]).catch(() => undefined)
}

/** The page script (highlight + "Read from Here"), installed once per page load in its own world. */
async function installPageScript(page: WebContents): Promise<boolean> {
  try {
    return (await page.executeJavaScriptInIsolatedWorld(PAGE_WORLD_ID, [{ code: pageScriptSource() }])) === true
  } catch {
    return false
  }
}

/** Live-page highlighting for a reading: the script plus the ::highlight style (best effort). */
async function startLiveHighlight(page: WebContents, token: number): Promise<void> {
  if (readerViewFor(page) || page.isDestroyed()) return
  if (!(await installPageScript(page)) || reading?.token !== token || page.isDestroyed()) return
  let cssKey: string | null = null
  try { cssKey = await page.insertCSS(READ_ALOUD_HIGHLIGHT_CSS, { cssOrigin: 'user' }) } catch { /* page navigating */ }
  if (reading?.token !== token) {
    if (cssKey && !page.isDestroyed()) void page.removeInsertedCSS(cssKey).catch(() => undefined)
    return
  }
  reading.live = { cssKey }
  // The sentence already playing when the script got in.
  if (state.status === 'playing' || state.status === 'paused') highlight(page, state.index, reading.sentences[state.index] ?? '')
}

function stopLiveHighlight(ended: Reading): void {
  const live = ended.live
  ended.live = null
  if (!live || ended.page.isDestroyed()) return
  void ended.page.executeJavaScriptInIsolatedWorld(PAGE_WORLD_ID, [{ code: 'window.__surffishReadAloud?.clear()' }]).catch(() => undefined)
  if (live.cssKey) void ended.page.removeInsertedCSS(live.cssKey).catch(() => undefined)
}

function clearPausedTimer(): void {
  if (pausedTimer) clearTimeout(pausedTimer)
  pausedTimer = null
}

/** A reading left paused stops on its own after PAUSED_STOP_MS, and the idle engine closes after that. */
function notePaused(paused: boolean): void {
  if (!paused) {
    clearPausedTimer()
    return
  }
  if (pausedTimer || !reading) return
  const token = reading.token
  pausedTimer = setTimeout(() => {
    pausedTimer = null
    if (reading?.token !== token || state.status !== 'paused') return
    sendToEngine({ type: 'stop' })
    endReading()
  }, PAUSED_STOP_MS)
  pausedTimer.unref?.()
}

function endReading(status: ReadAloudStatus = 'idle', error = ''): void {
  clearPausedTimer()
  const ended = reading
  reading = null
  if (ended) {
    ended.detach()
    const view = readerViewFor(ended.page)
    if (view && !view.webContents.isDestroyed()) view.webContents.send('reader:read-aloud', { index: -1, text: '' })
    stopLiveHighlight(ended)
  }
  publish({ ...IDLE_READ_ALOUD_STATE, status, error, speed: settings?.speed ?? 1, voice: settings?.voice ?? 'default' })
  if (browserWindows().length === 0) closeEngine()
  else scheduleEngineIdleClose()
}

function failReading(message: string): void {
  sendToEngine({ type: 'stop' })
  endReading('error', message)
}

function onEngineEvent(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  const event = value as EngineEvent
  if (event.type === 'ready') {
    markEngineReady?.()
    markEngineReady = null
    return
  }
  if (event.type === 'pdf-text') {
    const resolveRequest = pdfRequests.get(event.id)
    pdfRequests.delete(event.id)
    resolveRequest?.(event)
    return
  }
  if (event.type !== 'state') return
  if (test && event.token === test.token) {
    onTestEvent(event)
    return
  }
  if (!reading || event.token !== reading.token) return
  if (event.status === 'finished') {
    endReading()
    return
  }
  if (event.status === 'error') {
    endReading('error', String(event.error || 'Read Aloud failed.'))
    return
  }
  // First audio of a reading: the numbers that matter for a latency check (load, TTFB, threads), in
  // dev builds or with SURFFISH_DEBUG_READ_ALOUD=1 only.
  if (LOG_STATS && event.stats && typeof event.stats === 'object') console.info('[read aloud]', event.engine ?? state.engine, JSON.stringify(event.stats))
  const index = typeof event.index === 'number' ? Math.max(0, Math.min(reading.sentences.length - 1, event.index)) : state.index
  if (index !== state.index || state.status !== event.status) highlight(reading.page, index, reading.sentences[index] ?? '')
  notePaused(event.status === 'paused')
  publish({
    status: event.status,
    index,
    engine: event.engine ?? state.engine,
    fallbackReason: typeof event.fallbackReason === 'string' ? event.fallbackReason : state.fallbackReason,
    download: null
  })
}

async function selectionOf(page: WebContents): Promise<string> {
  const target = readerViewFor(page)?.webContents ?? page
  try {
    const value: unknown = target === page
      ? await page.executeJavaScriptInIsolatedWorld(PAGE_WORLD_ID, [{ code: 'String(window.getSelection() || "")' }])
      : await target.executeJavaScript('String(window.getSelection() || "")')
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

interface ReadingText {
  title: string
  sentences: string[]
  /** First sentence to speak ("Read from Here" into the article). */
  start: number
}

/** Text from the right-click point to the end of the page (in Reader view when it's open). */
async function textFromPoint(page: WebContents, point: ReadAloudPoint | undefined): Promise<{ probe: string; rest: string } | null> {
  const view = readerViewFor(page)
  const target = view && !view.webContents.isDestroyed() ? view.webContents : page
  try {
    if (!(await installPageScript(target))) return null
    const zoom = target.getZoomFactor() || 1
    const x = Math.round((point?.x ?? 0) / zoom)
    const y = Math.round((point?.y ?? 0) / zoom)
    const value: unknown = await target.executeJavaScriptInIsolatedWorld(PAGE_WORLD_ID, [{ code: `window.__surffishReadAloud?.fromPoint(${x}, ${y}) ?? null` }])
    if (!value || typeof value !== 'object') return null
    const { probe, rest } = value as { probe?: unknown; rest?: unknown }
    return typeof probe === 'string' && typeof rest === 'string' ? { probe, rest } : null
  } catch {
    return null
  }
}

/** The PDF a tab shows: the built-in viewer's document, or the one open in the PDF editor. */
function pdfDocumentFor(page: WebContents): PdfEditorDocument | null {
  const editor = pdfEditorDocumentFor(page)
  if (editor) return editor
  if (!isShowingPdf(page)) return null
  return { sourceUrl: page.getURL(), name: page.getTitle(), isPrivate: false, sourceSession: page.session, sourceContents: page }
}

/** The page the PDF is at (1-based): the built-in viewer's page box, or the editor's current page. */
async function currentPdfPage(page: WebContents): Promise<number | null> {
  if (isShowingPdf(page)) return pdfViewerPage(page)
  try {
    const value: unknown = await page.executeJavaScript('Number(document.querySelector(".is-current[data-index]")?.dataset.index ?? -1) + 1')
    return typeof value === 'number' && value >= 1 ? value : null
  } catch {
    return null
  }
}

function pdfTextRequest(bytes: Uint8Array): Promise<Extract<EngineEvent, { type: 'pdf-text' }>> {
  const id = nextPdfRequest++
  return new Promise((resolveRequest) => {
    const timer = setTimeout(() => {
      pdfRequests.delete(id)
      resolveRequest({ type: 'pdf-text', id, ok: false, error: 'it took too long' })
    }, PDF_TEXT_TIMEOUT_MS)
    pdfRequests.set(id, (event) => {
      clearTimeout(timer)
      resolveRequest(event)
    })
    sendToEngine({ type: 'pdf-text', id, bytes })
  })
}

/**
 * A PDF's text: its bytes the way the PDF editor gets them (from inside the tab first, so the site's
 * cookies and the HTTP cache apply; the tab's session; or the local file), read by pdf.js in the
 * engine page and cleaned up there (shared/read-aloud-pdf.ts). Read from Here starts at the page
 * the viewer is on.
 */
async function pdfSentences(page: WebContents, document: PdfEditorDocument, fromCurrentPage: boolean): Promise<ReadingText | { error: string }> {
  let bytes: Uint8Array
  try {
    bytes = await loadPdfBytes(document)
  } catch (error) {
    return { error: (error instanceof Error ? error.message : String(error)).replace('to edit here', 'to read aloud') }
  }
  if (page.isDestroyed()) return { error: 'The tab closed.' }
  const startPage = fromCurrentPage ? await currentPdfPage(page) : null
  try {
    await ensureEngine()
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  const result = await pdfTextRequest(bytes)
  if (!result.ok) {
    const reason = String(result.error ?? '')
    return { error: /password/i.test(reason) ? 'This PDF is password protected.' : `Could not read this PDF (${reason || 'unknown error'}).` }
  }
  const sentences = Array.isArray(result.sentences) ? result.sentences.filter((value): value is string => typeof value === 'string' && value.trim() !== '') : []
  if (sentences.length === 0) return { error: NO_PDF_TEXT }
  const pageStarts = Array.isArray(result.pageStarts) ? result.pageStarts.filter((value): value is number => typeof value === 'number') : []
  let start = 0
  if (startPage !== null && startPage > 1) {
    start = pageStarts[startPage - 1] ?? sentences.length
    if (start >= sentences.length) return { error: 'No readable text from this page on.' }
  }
  const title = (typeof result.title === 'string' && result.title.trim()) || document.name.trim() || 'PDF'
  return { title, sentences, start }
}

async function articleSentences(page: WebContents): Promise<ReadingText | { error: string }> {
  const pdf = pdfDocumentFor(page)
  if (pdf) return pdfSentences(page, pdf, false)
  const article = readerArticleFor(page) ?? await extractReaderArticle(page)
  if (!article) return { error: 'No article found on this page.' }
  const body = splitSentences(articleTextFromHtml(article.content))
  const title = article.title.trim()
  const sentences = title && body[0] !== title ? [title, ...body] : body
  return sentences.length > 0 ? { title: title || 'Article', sentences, start: 0 } : { error: 'No readable text on this page.' }
}

async function textFor(page: WebContents, target: 'page' | 'selection' | 'here', selection: string, point?: ReadAloudPoint): Promise<ReadingText | { error: string }> {
  if (target === 'here') {
    const pdf = pdfDocumentFor(page)
    if (pdf) return pdfSentences(page, pdf, true)
    const from = await textFromPoint(page, point)
    if (!from) return articleSentences(page)
    // Into the article when the point is in it (its own sentences, so skipping and Reader view's
    // highlight stay right); otherwise the page's text from there on.
    const article = await articleSentences(page)
    if (!('error' in article)) {
      const index = sentenceIndexForProbe(article.sentences, from.probe)
      if (index !== null) return { ...article, start: index }
    }
    const sentences = splitSentences(from.rest)
    return sentences.length > 0 ? { title: 'error' in article ? 'From here' : article.title, sentences, start: 0 } : { error: 'No readable text after that point.' }
  }
  if (target === 'selection') {
    const text = selection.trim() || (await selectionOf(page)).trim()
    const sentences = splitSentences(text)
    return sentences.length > 0 ? { title: 'Selection', sentences, start: 0 } : { error: 'Select some text to read aloud.' }
  }
  return articleSentences(page)
}

function watchPage(page: WebContents, token: number): () => void {
  const stopIfCurrent = (): void => {
    if (reading?.token === token) {
      sendToEngine({ type: 'stop' })
      endReading()
    }
  }
  const onNavigate = (_event: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean): void => {
    if (isMainFrame && !isInPlace) stopIfCurrent()
  }
  page.on('did-start-navigation', onNavigate)
  page.on('render-process-gone', stopIfCurrent)
  page.once('destroyed', stopIfCurrent)
  return () => {
    if (page.isDestroyed()) return
    page.off('did-start-navigation', onNavigate)
    page.off('render-process-gone', stopIfCurrent)
    page.off('destroyed', stopIfCurrent)
  }
}

/**
 * What the engine page needs for one reading: the sentences, the engine, and for Phonon the voice,
 * the speed split (duration_delta + time stretch), sampling and load options.
 */
function speakCommand(token: number, sentences: string[], start: number, current: ReadAloudSettings, title: string, voiceId: string, seed: number): Record<string, unknown> {
  const split = splitSpeed(current.speed)
  return {
    type: 'speak',
    token,
    sentences,
    start,
    engine: current.engine,
    voice: voiceId === 'default' ? { id: 'default', file: DEFAULT_VOICE_FILE } : { id: voiceId, file: `voices/${voiceId}.safetensors` },
    speed: split.speed,
    durationDelta: split.durationDelta,
    stretch: split.stretch,
    lookahead: lookaheadFor(split.speed),
    temperature: current.temperature,
    seed,
    load: { rewrites: current.rewrites, device: current.device, threads: current.threads, conditions: { ...current.conditions } },
    title
  }
}

export async function startReadAloud(page: WebContents, target: 'page' | 'selection' | 'here', selection: string, current: ReadAloudSettings, point?: ReadAloudPoint): Promise<boolean> {
  settings = current
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  stopTest()
  if (reading) {
    sendToEngine({ type: 'stop' })
    endReading()
  }
  const attempt = ++startAttempts
  const isPdf = target !== 'selection' && pdfDocumentFor(page) !== null
  // Reading a PDF's text takes a moment (download, pdf.js): show the player as getting ready.
  if (isPdf) publish({ ...IDLE_READ_ALOUD_STATE, status: 'loading', title: page.getTitle() || 'PDF', speed: current.speed, voice: current.voice, engine: current.engine })
  const text = await textFor(page, target, selection, point)
  if (page.isDestroyed() || attempt !== startAttempts) return false
  // Stopped from the player while the PDF was being read.
  if (isPdf && state.status !== 'loading') {
    scheduleEngineIdleClose()
    return false
  }
  if ('error' in text) {
    if (isPdf) scheduleEngineIdleClose()
    publish({ ...IDLE_READ_ALOUD_STATE, status: 'error', error: text.error })
    return false
  }
  const ref = getBrowserTabRefByWebContentsId(page.id)
  const info = ref ? getBrowserTabPageInfo(ref.tabId) : null
  const token = nextToken++
  reading = { token, page, tabId: ref?.tabId ?? null, title: text.title, sentences: text.sentences, isPrivate: info?.private ?? false, seed: newSeed(current), detach: () => undefined, live: null }
  reading.detach = watchPage(page, token)
  publish({ ...IDLE_READ_ALOUD_STATE, status: 'loading', tabId: reading.tabId, title: text.title, index: text.start, total: text.sentences.length, speed: current.speed, voice: current.voice, engine: current.engine })
  if (!isPdf) void startLiveHighlight(page, token)
  try {
    let voice = 'default'
    if (current.engine === 'phonon') {
      try {
        voice = await ensurePhononFiles(current.voice, true)
      } catch (error) {
        if (reading?.token !== token) return false
        if (error instanceof ReadAloudDownloadCancelled) {
          endReading('error', error.message)
          return false
        }
        // Can't fetch the model (offline, blocked): speak with the system voices instead.
        console.warn('[read aloud] Phonon download failed, using system voices:', error)
        publish({ status: 'loading', download: null, fallbackReason: `Phonon unavailable: ${error instanceof Error ? error.message : String(error)}` })
        await ensureEngine()
        if (reading?.token !== token) return false
        sendToEngine({ ...speakCommand(token, text.sentences, text.start, { ...current, engine: 'system' }, text.title, 'default', reading.seed), fallbackReason: state.fallbackReason })
        return true
      }
    }
    if (reading?.token !== token) return false
    publish({ status: 'loading', download: null })
    await ensureEngine()
    if (reading?.token !== token) return false
    sendToEngine(speakCommand(token, text.sentences, text.start, current, text.title, voice, reading.seed))
    return true
  } catch (error) {
    if (reading?.token === token) failReading(error instanceof Error ? error.message : String(error))
    return false
  }
}

export function controlReadAloud(action: ReadAloudControl): void {
  if (!reading) {
    // Dismissing an error ("No article found") from the player.
    if (action === 'stop' && state.status !== 'idle') publish({ ...IDLE_READ_ALOUD_STATE, speed: settings?.speed ?? 1, voice: settings?.voice ?? 'default' })
    return
  }
  if (action === 'stop') {
    // A model download keeps going (Settings shows it and can cancel it); only the reading stops.
    sendToEngine({ type: 'stop' })
    endReading()
    return
  }
  const resolved = action === 'toggle' ? (state.status === 'paused' ? 'resume' : 'pause') : action
  sendToEngine({ type: 'control', token: reading.token, action: resolved })
}

/** Anything that changes how the reading sounds (not `enabled`). */
function speechChanged(previous: ReadAloudSettings, next: ReadAloudSettings): boolean {
  const { enabled: _a, ...before } = previous
  const { enabled: _b, ...after } = next
  return JSON.stringify(before) !== JSON.stringify(after)
}

/** Voice, speed, engine or a Phonon lever changed in the player or Settings: the engine restarts the current sentence. */
export function applyReadAloudSettings(next: ReadAloudSettings): void {
  const previous = settings
  settings = next
  publish({ speed: next.speed, voice: next.voice })
  if (next.engine === 'phonon' && previous?.voice !== next.voice) prefetchReadAloudVoice(next.voice)
  const active = reading
  if (!active || !previous) return
  if (!speechChanged(previous, next)) return
  const token = active.token
  if (previous.varySeed !== next.varySeed) active.seed = newSeed(next)
  void (async () => {
    try {
      const voice = next.engine === 'phonon' ? await ensurePhononFiles(next.voice, false) : 'default'
      if (reading?.token !== token) return
      sendToEngine({ ...speakCommand(token, active.sentences, state.index, next, active.title, voice, active.seed), type: 'respeak' })
    } catch (error) {
      if (reading?.token === token) failReading(error instanceof Error ? error.message : String(error))
    }
  })()
}

// ---------------------------------------------------------------------------
// Voice tester (Settings → Integrations → Read Aloud)

function publishTest(patch: Partial<ReadAloudTestState>): void {
  testState = { ...testState, ...patch }
  try { sendToMainWindowRenderers('browser:read-aloud:test', readAloudTestState()) } catch { /* window closing */ }
}

export function readAloudTestState(): ReadAloudTestState {
  return { ...testState, stats: testState.stats ? { ...testState.stats } : null }
}

function finishTest(patch: Partial<ReadAloudTestState>): void {
  test = null
  publishTest(patch)
  if (!reading) {
    if (browserWindows().length === 0) closeEngine()
    else scheduleEngineIdleClose()
  }
}

function stopTest(): void {
  if (!test) return
  sendToEngine({ type: 'stop' })
  finishTest({ status: 'idle' })
}

function onTestEvent(event: Extract<EngineEvent, { type: 'state' }>): void {
  const stats = mergeTestStats(testState.stats, event.stats)
  const fallbackReason = typeof event.fallbackReason === 'string' && event.fallbackReason ? event.fallbackReason : testState.fallbackReason
  if (event.status === 'finished') finishTest({ status: 'finished', stats, fallbackReason })
  else if (event.status === 'error') finishTest({ status: 'error', stats, error: String(event.error || 'The test failed.') })
  else publishTest({ status: event.status === 'paused' ? 'playing' : event.status, engine: event.engine ?? testState.engine, stats, fallbackReason })
}

/**
 * The tester's Play: speak the sample with Read Aloud's own engine, voice, speed and levers. Stops a
 * reading or an earlier test first. Phonon fetches the model / voice if needed (progress in Settings).
 */
export function testReadAloud(input: unknown, current: ReadAloudSettings): { ok: boolean; error?: string } {
  const request = parseReadAloudTestRequest(input)
  if (!request) return { ok: false, error: 'bad request' }
  void runTest(request, current)
  return { ok: true }
}

async function runTest(request: ReadAloudTestRequest, current: ReadAloudSettings): Promise<boolean> {
  settings = current
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  if (reading) {
    sendToEngine({ type: 'stop' })
    endReading()
  }
  stopTest()
  const token = nextToken++
  const seed = newSeed(current)
  test = { token, request, seed }
  publishTest({ ...IDLE_READ_ALOUD_TEST, status: 'preparing', engine: current.engine, voice: current.voice, speed: current.speed })
  const sentences = splitSentences(request.text)
  try {
    const voice = current.engine === 'phonon' ? await ensurePhononFiles(current.voice, false) : 'default'
    if (test?.token !== token) return false
    publishTest({ status: 'loading' })
    await ensureEngine()
    if (test?.token !== token) return false
    sendToEngine({ ...speakCommand(token, sentences, 0, current, 'Voice test', voice, seed), test: true })
    return true
  } catch (error) {
    if (test?.token === token) finishTest({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    return false
  }
}

export function stopReadAloudTest(): void {
  stopTest()
}

export function disposeReadAloud(): void {
  downloads.cancel()
  stopTest()
  if (reading) {
    sendToEngine({ type: 'stop' })
    endReading()
  }
  closeEngine()
}
