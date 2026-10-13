import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, dialog, ipcMain, net, protocol, session, type BaseWindow, type CustomScheme, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  editedPdfFilename,
  isEditablePdfSource,
  isPdfEditorUrl,
  looksLikePdf,
  MAX_PDF_EDITOR_BYTES,
  PDF_EDITOR_SCHEME,
  pdfEditorAssetPath,
  withPdfExtension
} from '../shared/pdf-editor'
import { recordSavedFile } from './downloads'

/**
 * Built-in PDF editor (pdf.js editor layers + pdf-lib page tools). The page is served from the
 * privileged surffish-pdf:// scheme, registered only on its own in-memory session, so web pages can
 * never load it, and that session refuses every other request: the editor has no network access at
 * all. The PDF itself is fetched here in main with the tab's own session (cookies, proxy) or read
 * from the local file the tab showed, and handed over through a narrow preload API.
 */
export const PDF_EDITOR_PARTITION = 'surffish-pdf-editor'

const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
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
  '.gif': 'image/gif',
  '.wasm': 'application/wasm',
  '.json': 'application/json'
}

export interface PdfEditorDocument {
  sourceUrl: string
  name: string
  isPrivate: boolean
  /** Session the tab browsed with, so the editor's fetch carries the same cookies and proxy. */
  sourceSession: Electron.Session
}

export interface PdfEditorHost {
  /** The editor tab state for a WebContents, or null when it isn't a PDF editor tab. */
  documentFor(contents: WebContents): PdfEditorDocument | null
  setDirty(contents: WebContents, dirty: boolean): void
  backToViewer(contents: WebContents): void
  window(): BaseWindow | null
}

let host: PdfEditorHost | null = null
let editorSession: Electron.Session | null = null
let ipcRegistered = false

/**
 * Must run before app ready: the scheme needs fetch, a secure origin and module workers (pdf.js).
 * Electron takes one registerSchemesAsPrivileged call, so other internal schemes ride along here.
 */
export function registerPdfEditorScheme(otherSchemes: CustomScheme[] = []): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: PDF_EDITOR_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true }
  }, ...otherSchemes])
}

const mainDirectory = dirname(fileURLToPath(import.meta.url))

function rendererDirectory(): string {
  return resolve(mainDirectory, '../renderer')
}

function devServerUrl(): string | null {
  return !app.isPackaged && process.env['ELECTRON_RENDERER_URL'] ? process.env['ELECTRON_RENDERER_URL'] : null
}

/** pdf.js cmaps/fonts/wasm: copied into out/renderer/pdfjs by the build, read from node_modules in dev. */
function pdfjsDataDirectory(): string {
  const built = join(rendererDirectory(), 'pdfjs')
  if (existsSync(built)) return built
  return join(app.getAppPath(), 'node_modules/pdfjs-dist')
}

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

async function serveFile(root: string, relative: string): Promise<Response> {
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(root + sep)) return new Response('Not found', { status: 404 })
  try {
    const body = await readFile(target)
    const headers: Record<string, string> = { 'Content-Type': contentType(target), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }
    if (target.endsWith('.html')) headers['Content-Security-Policy'] = PAGE_CSP
    return new Response(body, { status: 200, headers })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

async function handleEditorRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const devServer = devServerUrl()
  if (url.pathname.startsWith('/pdfjs/')) {
    const relative = pdfEditorAssetPath(request.url)
    if (!relative) return new Response('Not found', { status: 404 })
    let inner = relative.slice('pdfjs/'.length)
    const directory = pdfjsDataDirectory()
    // node_modules layout (dev) keeps the annotation icons under web/images.
    if (inner.startsWith('images/') && !directory.endsWith(`${sep}pdfjs`)) inner = `web/${inner}`
    return serveFile(directory, inner)
  }
  if (devServer) {
    // Dev: proxy the Vite dev server (it serves /src, /@vite and /node_modules paths too).
    const response = await net.fetch(new URL(`${url.pathname}${url.search}`, devServer).toString())
    const headers = new Headers(response.headers)
    if ((headers.get('content-type') ?? '').includes('text/html')) headers.set('Content-Security-Policy', PAGE_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"))
    return new Response(await response.arrayBuffer(), { status: response.status, headers })
  }
  const relative = pdfEditorAssetPath(request.url)
  return relative ? serveFile(rendererDirectory(), relative) : new Response('Not found', { status: 404 })
}

function isAllowedEditorRequest(url: string): boolean {
  return url.startsWith(`${PDF_EDITOR_SCHEME}:`) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('devtools:')
}

/** Isolated, in-memory session for editor tabs: no cookies, no cache on disk, no network. */
export function getPdfEditorSession(): Electron.Session {
  if (editorSession) return editorSession
  const created = session.fromPartition(PDF_EDITOR_PARTITION, { cache: false })
  created.protocol.handle(PDF_EDITOR_SCHEME, handleEditorRequest)
  created.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedEditorRequest(details.url)
    if (!allowed) console.warn('[pdf editor] blocked a network request from the editor page')
    callback({ cancel: !allowed })
  })
  created.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  created.setPermissionCheckHandler(() => false)
  // Nothing the editor does should download; Save goes through main.
  created.on('will-download', (event) => event.preventDefault())
  editorSession = created
  return created
}

export function pdfEditorPreloadPath(): string | null {
  const candidates = [
    join(mainDirectory, '../preload/pdf-editor.cjs'),
    join(app.getAppPath(), 'out/preload/pdf-editor.cjs'),
    join(app.getAppPath(), 'src/preload/pdf-editor.cjs')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/** Local path of a file:// source, or null for web sources. */
export function localPdfPath(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl)
    return url.protocol === 'file:' ? fileURLToPath(url) : null
  } catch {
    return null
  }
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_PDF_EDITOR_BYTES) throw new Error('This PDF is too large to edit here.')
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_PDF_EDITOR_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new Error('This PDF is too large to edit here.')
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

/** Fetch the document the tab was showing: with the tab's session for the web, from disk for file://. */
export async function loadPdfBytes(document: PdfEditorDocument): Promise<Uint8Array> {
  if (!isEditablePdfSource(document.sourceUrl)) throw new Error('This PDF cannot be opened in the editor.')
  const path = localPdfPath(document.sourceUrl)
  let bytes: Uint8Array
  if (path) {
    const info = await stat(path)
    if (!info.isFile()) throw new Error('This PDF file is no longer available.')
    if (info.size > MAX_PDF_EDITOR_BYTES) throw new Error('This PDF is too large to edit here.')
    bytes = new Uint8Array(await readFile(path))
  } else {
    const response = await document.sourceSession.fetch(document.sourceUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
      headers: { Accept: 'application/pdf,*/*;q=0.8' }
    })
    if (!response.ok) throw new Error(`Could not download the PDF (HTTP ${response.status}).`)
    bytes = await readBounded(response)
  }
  if (!looksLikePdf(bytes)) throw new Error('The downloaded file is not a PDF (the site may need you to sign in again).')
  return bytes
}

async function writeFileAtomically(target: string, bytes: Uint8Array): Promise<void> {
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, bytes, { flag: 'wx' })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export interface PdfSaveResult {
  saved: boolean
  filename?: string
}

/**
 * Native Save dialog. Defaults to `<name>-edited.pdf` next to a local source (or in Downloads for web
 * sources); picking the original local file overwrites it (the OS dialog asks to replace).
 */
export async function savePdfWithDialog(window: BaseWindow | null, document: PdfEditorDocument, bytes: Uint8Array): Promise<PdfSaveResult> {
  const localPath = localPdfPath(document.sourceUrl)
  const directory = localPath ? dirname(localPath) : app.getPath('downloads')
  const options: Electron.SaveDialogOptions = {
    title: 'Save PDF',
    defaultPath: join(directory, editedPdfFilename(document.name)),
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  }
  // Smoke tests (unpackaged builds only) save without the native dialog.
  const smokePath = !app.isPackaged ? process.env['SURFFISH_PDF_EDITOR_SMOKE_SAVE_PATH'] : undefined
  const result = smokePath
    ? { canceled: false, filePath: smokePath }
    : window && !window.isDestroyed() ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { saved: false }
  const target = withPdfExtension(result.filePath)
  await writeFileAtomically(target, bytes)
  recordSavedFile({ filePath: target, sourceUrl: document.sourceUrl, bytes: bytes.byteLength, isPrivate: document.isPrivate })
  return { saved: true, filename: basename(target) }
}

/** Unsaved edits: ask before they are thrown away. Returns true to go ahead. */
export function confirmDiscardPdfEdits(window: BaseWindow | null, name: string, action: string): boolean {
  const options: Electron.MessageBoxSyncOptions = {
    type: 'warning',
    buttons: [action, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Discard your changes to ${name}?`,
    detail: 'Your edits have not been saved. Use Save in the editor to keep them.'
  }
  const response = window && !window.isDestroyed() ? dialog.showMessageBoxSync(window, options) : dialog.showMessageBoxSync(options)
  return response === 0
}

function editorDocument(event: IpcMainEvent | IpcMainInvokeEvent): PdfEditorDocument | null {
  const frame = event.senderFrame
  if (!host || !frame || frame !== event.sender.mainFrame || !isPdfEditorUrl(frame.url)) return null
  return host.documentFor(event.sender)
}

function requireEditorDocument(event: IpcMainInvokeEvent): PdfEditorDocument {
  const document = editorDocument(event)
  if (!document) throw new Error('This operation is only available to the PDF editor.')
  return document
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return null
}

export function attachPdfEditor(editorHost: PdfEditorHost): void {
  host = editorHost
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.handle('pdf-editor:load', async (event) => {
    const document = requireEditorDocument(event)
    try {
      const bytes = await loadPdfBytes(document)
      return { ok: true, name: document.name, sourceUrl: document.sourceUrl, local: localPdfPath(document.sourceUrl) !== null, bytes }
    } catch (error) {
      return { ok: false, name: document.name, sourceUrl: document.sourceUrl, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('pdf-editor:save', async (event, value: unknown) => {
    const document = requireEditorDocument(event)
    const bytes = toBytes(value)
    if (!bytes || bytes.byteLength > MAX_PDF_EDITOR_BYTES || !looksLikePdf(bytes)) throw new Error('The editor produced an invalid PDF.')
    const result = await savePdfWithDialog(host?.window() ?? null, document, bytes)
    if (result.saved) host?.setDirty(event.sender, false)
    return result
  })
  ipcMain.on('pdf-editor:dirty', (event, dirty: unknown) => {
    if (editorDocument(event)) host?.setDirty(event.sender, dirty === true)
  })
  ipcMain.on('pdf-editor:back', (event) => {
    if (editorDocument(event)) host?.backToViewer(event.sender)
  })
}

/** Ask the editor page to run one of its commands (from the app menu or the context menu). */
export function sendPdfEditorCommand(contents: WebContents, command: 'save' | 'undo' | 'redo'): void {
  if (!contents.isDestroyed() && isPdfEditorUrl(contents.getURL())) contents.send('pdf-editor:command', command)
}
