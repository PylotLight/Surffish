import { app, BrowserWindow, net, session, type Session, type WebContents } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IDLE_READ_ALOUD_STATE,
  IDLE_READ_ALOUD_TEST,
  mergeTestStats,
  READ_ALOUD_MODEL_PATH,
  READ_ALOUD_PARTITION,
  READ_ALOUD_RUNTIME_PATH,
  READ_ALOUD_SCHEME,
  READ_ALOUD_URL,
  speechEndpointUrl,
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
  parseReadAloudTestManifest,
  PHONON_MANIFEST,
  readAloudVoice,
  speedToDurationDelta,
  type ReadAloudManifest
} from '../shared/read-aloud-assets'
import { articleTextFromHtml, splitSentences } from '../shared/read-aloud-text'
import { backgroundNetworkBlockedReason } from './background-network'
import { getBrowserTabPageInfo, getBrowserTabRefByWebContentsId } from './browser'
import { getBrowserSession } from './browser-session'
import { sendToMainWindowRenderers } from './browser-shell'
import { isShowingPdf } from './pdf-viewer'
import { extractReaderArticle, readerArticleFor, readerViewFor } from './reader-mode'
import { readAloudDirectory } from './read-aloud-feature'
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

const ENGINE_IDLE_CLOSE_MS = 3 * 60_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000
const SPEECH_TIMEOUT_MS = 60_000
const SELECTION_WORLD_ID = 1311

interface Reading {
  token: number
  page: WebContents
  tabId: string | null
  title: string
  sentences: string[]
  isPrivate: boolean
  detach: () => void
}

type EngineEvent =
  | { type: 'ready' }
  | { type: 'state'; token: number; status: 'loading' | 'playing' | 'paused' | 'finished' | 'error'; index?: number; engine?: ReadAloudEngineId; fallbackReason?: string; error?: string; stats?: unknown }

let state: ReadAloudState = { ...IDLE_READ_ALOUD_STATE }
let settings: ReadAloudSettings | null = null
let reading: Reading | null = null
let nextToken = 1
let engine: BrowserWindow | null = null
let engineReady: Promise<BrowserWindow> | null = null
let markEngineReady: (() => void) | null = null
let engineSession: Session | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let test: { token: number; request: ReadAloudTestRequest } | null = null
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

/** The voice picked in Settings or the player: fetch it now (~250 KB) once the model is there. */
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

/** Model + voice for a reading or a test; a reading meanwhile shows the progress in the player. */
async function ensurePhononFiles(voiceId: string, showInPlayer: boolean): Promise<void> {
  if (!downloads.isReady()) {
    const current = downloads.state()
    if (showInPlayer) publish({ status: 'downloading', download: { label: current.label || 'Preparing', loaded: current.loaded, total: current.total || current.bytes } })
    await downloads.ensureModel()
  }
  await downloads.ensureVoice(voiceId)
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

function closeEngine(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  const window = engine
  engine = null
  engineReady = null
  if (window && !window.isDestroyed()) window.destroy()
}

function scheduleEngineIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (!reading && !test) closeEngine()
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
  if (view && !view.webContents.isDestroyed()) view.webContents.send('reader:read-aloud', { index, text })
}

function endReading(status: ReadAloudStatus = 'idle', error = ''): void {
  const ended = reading
  reading = null
  if (ended) {
    ended.detach()
    if (!ended.page.isDestroyed()) highlight(ended.page, -1, '')
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
  // First audio of a reading: log the numbers that matter for a latency check (load, TTFB, threads).
  if (event.stats && typeof event.stats === 'object') console.info('[read aloud]', event.engine ?? state.engine, JSON.stringify(event.stats))
  const index = typeof event.index === 'number' ? Math.max(0, Math.min(reading.sentences.length - 1, event.index)) : state.index
  if (index !== state.index || state.status !== event.status) highlight(reading.page, index, reading.sentences[index] ?? '')
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
      ? await page.executeJavaScriptInIsolatedWorld(SELECTION_WORLD_ID, [{ code: 'String(window.getSelection() || "")' }])
      : await target.executeJavaScript('String(window.getSelection() || "")')
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

async function textFor(page: WebContents, target: 'page' | 'selection', selection: string): Promise<{ title: string; sentences: string[] } | { error: string }> {
  if (target === 'selection') {
    const text = selection.trim() || (await selectionOf(page)).trim()
    const sentences = splitSentences(text)
    return sentences.length > 0 ? { title: 'Selection', sentences } : { error: 'Select some text to read aloud.' }
  }
  if (isShowingPdf(page)) return { error: 'Read Aloud does not read PDFs yet.' }
  const article = readerArticleFor(page) ?? await extractReaderArticle(page)
  if (!article) return { error: 'No article found on this page.' }
  const body = splitSentences(articleTextFromHtml(article.content))
  const title = article.title.trim()
  const sentences = title && body[0] !== title ? [title, ...body] : body
  return sentences.length > 0 ? { title: title || 'Article', sentences } : { error: 'No readable text on this page.' }
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

function speakCommand(token: number, sentences: string[], start: number, current: ReadAloudSettings, title: string): Record<string, unknown> {
  const voice = readAloudVoice(current.voice)
  return {
    type: 'speak',
    token,
    sentences,
    start,
    engine: current.engine,
    voice: { id: voice.id, file: voice.file },
    speed: current.speed,
    durationDelta: speedToDurationDelta(current.speed),
    title
  }
}

export async function startReadAloud(page: WebContents, target: 'page' | 'selection', selection: string, current: ReadAloudSettings): Promise<boolean> {
  settings = current
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  stopTest()
  if (reading) {
    sendToEngine({ type: 'stop' })
    endReading()
  }
  const text = await textFor(page, target, selection)
  if (page.isDestroyed()) return false
  if ('error' in text) {
    publish({ ...IDLE_READ_ALOUD_STATE, status: 'error', error: text.error })
    return false
  }
  const ref = getBrowserTabRefByWebContentsId(page.id)
  const info = ref ? getBrowserTabPageInfo(ref.tabId) : null
  const token = nextToken++
  reading = { token, page, tabId: ref?.tabId ?? null, title: text.title, sentences: text.sentences, isPrivate: info?.private ?? false, detach: () => undefined }
  reading.detach = watchPage(page, token)
  publish({ ...IDLE_READ_ALOUD_STATE, status: 'loading', tabId: reading.tabId, title: text.title, total: text.sentences.length, speed: current.speed, voice: current.voice, engine: current.engine })
  try {
    if (current.engine === 'phonon') {
      try {
        await ensurePhononFiles(current.voice, true)
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
        sendToEngine({ ...speakCommand(token, text.sentences, 0, { ...current, engine: 'system' }, text.title), fallbackReason: state.fallbackReason })
        return true
      }
    }
    if (reading?.token !== token) return false
    publish({ status: 'loading', download: null })
    await ensureEngine()
    if (reading?.token !== token) return false
    sendToEngine(speakCommand(token, text.sentences, 0, current, text.title))
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

/** Voice, speed or engine changed in the player or Settings: the engine restarts the current sentence. */
export function applyReadAloudSettings(next: ReadAloudSettings): void {
  const previous = settings
  settings = next
  publish({ speed: next.speed, voice: next.voice })
  if (next.engine === 'phonon' && previous?.voice !== next.voice) prefetchReadAloudVoice(next.voice)
  const active = reading
  if (!active || !previous) return
  if (previous.voice === next.voice && previous.speed === next.speed && previous.engine === next.engine && previous.endpoint === next.endpoint && previous.endpointVoice === next.endpointVoice) return
  const token = active.token
  void (async () => {
    try {
      if (next.engine === 'phonon') await ensurePhononFiles(next.voice, false)
      if (reading?.token !== token) return
      sendToEngine({ ...speakCommand(token, active.sentences, state.index, next, active.title), type: 'respeak' })
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
 * Speak `request.text` with its engine, voice and speed (the tester's Play). Stops a reading or an
 * earlier test first. Phonon fetches the model / voice if needed (progress in Settings).
 */
export async function testReadAloud(request: ReadAloudTestRequest, current: ReadAloudSettings): Promise<boolean> {
  settings = current
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  if (reading) {
    sendToEngine({ type: 'stop' })
    endReading()
  }
  stopTest()
  const token = nextToken++
  test = { token, request }
  publishTest({ ...IDLE_READ_ALOUD_TEST, status: 'preparing', engine: request.engine, voice: request.voice, speed: request.speed })
  const sentences = splitSentences(request.text)
  try {
    if (request.engine === 'phonon') await ensurePhononFiles(request.voice, false)
    if (test?.token !== token) return false
    publishTest({ status: 'loading' })
    await ensureEngine()
    if (test?.token !== token) return false
    sendToEngine({ ...speakCommand(token, sentences, 0, { ...current, engine: request.engine, voice: request.voice, speed: request.speed }, 'Voice test'), test: true })
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
