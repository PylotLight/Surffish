import { app, BrowserWindow, net, session, type Session, type WebContents } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IDLE_READ_ALOUD_STATE,
  READ_ALOUD_MODEL_PATH,
  READ_ALOUD_PARTITION,
  READ_ALOUD_READY_FILE,
  READ_ALOUD_RUNTIME_PATH,
  READ_ALOUD_SCHEME,
  READ_ALOUD_URL,
  speechEndpointUrl,
  type ReadAloudControl,
  type ReadAloudEngineId,
  type ReadAloudSettings,
  type ReadAloudState,
  type ReadAloudStatus
} from '../shared/read-aloud'
import {
  isPhononRuntimeFile,
  PHONON_MODEL_ASSETS,
  PHONON_RUNTIME,
  PHONON_RUNTIME_VERSION,
  readAloudVoice,
  speedToDurationDelta,
  voiceAsset,
  type ReadAloudAsset
} from '../shared/read-aloud-assets'
import { articleTextFromHtml, splitSentences } from '../shared/read-aloud-text'
import { backgroundNetworkBlockedReason } from './background-network'
import { getBrowserTabPageInfo, getBrowserTabRefByWebContentsId } from './browser'
import { getBrowserSession } from './browser-session'
import { sendToMainWindowRenderers } from './browser-shell'
import { isShowingPdf } from './pdf-viewer'
import { extractReaderArticle, readerArticleFor, readerViewFor } from './reader-mode'
import { readAloudDirectory } from './read-aloud-feature'
import { matchesIntegrity, readTarGz } from './read-aloud-tar'
import { browserWindows, onBrowserWindowsChanged } from './window-scope'

/**
 * Read Aloud (loaded on first use; see read-aloud-feature.ts for the gate).
 *
 * Text: the tab's article from Reader view's Readability extraction (or the selection), split into
 * sentences here. Speech: a hidden, never-shown window on its own in-memory session runs the engine
 * page (src/renderer/src/read-aloud/engine.ts) on surffish-tts://engine/. Its session serves only
 * its own files: the page, the official `phonon-tts` runtime and the Phonon 31M model, both
 * downloaded once into <userData>/read-aloud and checked against pinned hashes, never bundled. The
 * page is cross-origin isolated (COOP/COEP), so Phonon's WebAssembly runs multi-threaded; audio plays
 * there through Web Audio, with a Media Session so hardware media keys and Now Playing work.
 *
 * One reading at a time, app-wide. It stops when its tab navigates or closes, or Read Aloud is
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
let downloading: Promise<void> | null = null
let downloadAbort: AbortController | null = null

const mainDirectory = dirname(fileURLToPath(import.meta.url))

// The hidden engine window counts as a window to Electron: with it open, closing the last browser
// window wouldn't quit the app on Windows/Linux. Close it with the last browser window.
onBrowserWindowsChanged(() => {
  if (browserWindows().length === 0 && engine && !reading) closeEngine()
})

export function readAloudState(): ReadAloudState {
  return { ...state, download: state.download ? { ...state.download } : null }
}

function publish(patch: Partial<ReadAloudState>): void {
  state = { ...state, ...patch }
  try { sendToMainWindowRenderers('browser:read-aloud:state', readAloudState()) } catch { /* window closing */ }
}

function runtimeDirectory(): string {
  return join(readAloudDirectory(), 'runtime', `phonon-tts-${PHONON_RUNTIME_VERSION}`)
}

// ---------------------------------------------------------------------------
// Downloads

async function fileHasSize(path: string, bytes: number): Promise<boolean> {
  try {
    return (await stat(path)).size === bytes
  } catch {
    return false
  }
}

/** Stream `asset` to disk with progress, checking its sha256 before it replaces anything. */
async function downloadAsset(asset: ReadAloudAsset, onBytes: (count: number) => void, signal: AbortSignal): Promise<Uint8Array | null> {
  const blocked = backgroundNetworkBlockedReason()
  if (blocked) throw new Error(blocked)
  const response = await getBrowserSession().fetch(asset.url, { redirect: 'follow', credentials: 'omit', signal } as RequestInit)
  if (!response.ok || !response.body) throw new Error(`${asset.label}: download failed (HTTP ${response.status})`)
  const hash = createHash(asset.integrity ? 'sha512' : 'sha256')
  const keepInMemory = Boolean(asset.integrity)
  const chunks: Uint8Array[] = []
  const target = join(readAloudDirectory(), asset.file)
  const partial = `${target}.partial`
  await mkdir(dirname(target), { recursive: true })
  const handle = keepInMemory ? null : await open(partial, 'w')
  let received = 0
  try {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > asset.bytes * 1.1 + 1024) throw new Error(`${asset.label}: larger than expected`)
      hash.update(value)
      if (handle) await handle.write(value)
      else chunks.push(value)
      onBytes(value.byteLength)
    }
  } finally {
    await handle?.close()
  }
  if (asset.integrity) {
    const bytes = Buffer.concat(chunks)
    if (!matchesIntegrity(bytes, asset.integrity)) throw new Error(`${asset.label}: checksum mismatch`)
    return bytes
  }
  if (hash.digest('hex') !== asset.sha256) {
    await rm(partial, { force: true })
    throw new Error(`${asset.label}: checksum mismatch`)
  }
  await rename(partial, target)
  return null
}

/** What the first reading (or a new voice) still needs. */
async function missingAssets(voiceId: string): Promise<{ runtime: boolean; files: ReadAloudAsset[] }> {
  const runtime = !existsSync(join(runtimeDirectory(), '.complete'))
  const wanted = [...PHONON_MODEL_ASSETS]
  const voice = readAloudVoice(voiceId)
  if (voice.id !== 'default') wanted.push(voiceAsset(voice))
  const files: ReadAloudAsset[] = []
  for (const asset of wanted) if (!(await fileHasSize(join(readAloudDirectory(), asset.file), asset.bytes))) files.push(asset)
  return { runtime, files }
}

async function ensureDownloads(voiceId: string): Promise<void> {
  const missing = await missingAssets(voiceId)
  if (!missing.runtime && missing.files.length === 0) return
  const total = (missing.runtime ? PHONON_RUNTIME.bytes : 0) + missing.files.reduce((sum, asset) => sum + asset.bytes, 0)
  let loaded = 0
  let lastPublish = 0
  const abort = new AbortController()
  downloadAbort = abort
  const timeout = setTimeout(() => abort.abort(), DOWNLOAD_TIMEOUT_MS)
  const progress = (label: string) => (count: number): void => {
    loaded += count
    const now = Date.now()
    if (now - lastPublish < 150 && loaded < total) return
    lastPublish = now
    publish({ status: 'downloading', download: { label, loaded: Math.min(loaded, total), total } })
  }
  try {
    publish({ status: 'downloading', download: { label: 'Preparing', loaded: 0, total } })
    if (missing.runtime) {
      const tarball = await downloadAsset(PHONON_RUNTIME, progress(PHONON_RUNTIME.label), abort.signal)
      if (!tarball) throw new Error('Phonon runtime: empty download')
      const files = readTarGz(tarball, isPhononRuntimeFile)
      if (!files.some((file) => file.path === 'index.js') || !files.some((file) => file.path === 'worker.js')) throw new Error('Phonon runtime: unexpected package layout')
      const root = runtimeDirectory()
      await rm(root, { recursive: true, force: true })
      for (const file of files) {
        const target = resolve(root, file.path)
        if (!target.startsWith(root + sep)) continue
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, file.data)
      }
      await writeFile(join(root, '.complete'), PHONON_RUNTIME.integrity ?? '')
    }
    for (const asset of missing.files) await downloadAsset(asset, progress(asset.label), abort.signal)
    await writeFile(join(readAloudDirectory(), READ_ALOUD_READY_FILE), JSON.stringify({ runtime: PHONON_RUNTIME_VERSION, model: 'gradium/phonon-31m-en@8c64b55e', at: new Date().toISOString() }))
  } finally {
    clearTimeout(timeout)
    if (downloadAbort === abort) downloadAbort = null
  }
}

/** Downloads are shared: a second reading or a voice change waits for the one running. */
async function ensureDownloadsOnce(voiceId: string): Promise<void> {
  while (downloading) await downloading.catch(() => undefined)
  const run = ensureDownloads(voiceId)
  downloading = run
  try {
    await run
  } finally {
    if (downloading === run) downloading = null
  }
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
  if (path.startsWith(READ_ALOUD_RUNTIME_PATH)) return serveFile(runtimeDirectory(), path.slice(READ_ALOUD_RUNTIME_PATH.length), false)
  if (path.startsWith(READ_ALOUD_MODEL_PATH)) return serveFile(join(readAloudDirectory(), 'model'), path.slice(READ_ALOUD_MODEL_PATH.length), false)
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
    if (!reading) closeEngine()
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
  scheduleEngineIdleClose()
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
  if (event.type !== 'state' || !reading || event.token !== reading.token) return
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
        await ensureDownloadsOnce(current.voice)
      } catch (error) {
        if (reading?.token !== token) return false
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
    downloadAbort?.abort()
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
  const active = reading
  if (!active || !previous) return
  if (previous.voice === next.voice && previous.speed === next.speed && previous.engine === next.engine && previous.endpoint === next.endpoint && previous.endpointVoice === next.endpointVoice) return
  const token = active.token
  void (async () => {
    try {
      if (next.engine === 'phonon') await ensureDownloadsOnce(next.voice)
      if (reading?.token !== token) return
      sendToEngine({ ...speakCommand(token, active.sentences, state.index, next, active.title), type: 'respeak' })
    } catch (error) {
      if (reading?.token === token) failReading(error instanceof Error ? error.message : String(error))
    }
  })()
}

export function disposeReadAloud(): void {
  downloadAbort?.abort()
  if (reading) {
    sendToEngine({ type: 'stop' })
    endReading()
  }
  closeEngine()
}
