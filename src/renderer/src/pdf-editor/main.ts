// Surffish's built-in PDF editor: pdf.js viewer components with their annotation editor layer
// (highlight, free text, ink, image, signature, AcroForm filling, undo/redo) plus pdf-lib page tools.
// Runs on surffish-pdf://editor/ in an isolated, network-less session; main supplies the bytes.
import { pdfjsLib } from './pdfjs-global'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { EventBus, LinkTarget, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import './pdf-editor.css'
import { applyPageOps, PageOpError, type PageOp, type PageRotation } from '../../../shared/pdf-page-ops'
import { getBridge, type PdfEditorCommand } from './bridge'
import { SimpleSignatureManager } from './signature'

type ToolName = 'none' | 'highlight' | 'freetext' | 'ink' | 'stamp' | 'signature'

const { AnnotationEditorType: EditorType, AnnotationEditorParamsType: Params, AnnotationMode } = pdfjsLib
const TOOL_MODES: Record<ToolName, number> = {
  none: EditorType.NONE,
  highlight: EditorType.HIGHLIGHT,
  freetext: EditorType.FREETEXT,
  ink: EditorType.INK,
  stamp: EditorType.STAMP,
  signature: EditorType.SIGNATURE
}
const HIGHLIGHT_COLORS = 'yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F'
// Per-tool colour and size, remembered while the editor is open.
const toolSettings: Partial<Record<ToolName, { color: string; size: number; colorParam: number; sizeParam: number; sizeName: string; min: number; max: number }>> = {
  highlight: { color: '#FFFF98', size: 12, colorParam: Params.HIGHLIGHT_COLOR, sizeParam: Params.HIGHLIGHT_THICKNESS, sizeName: 'Free highlight', min: 8, max: 24 },
  freetext: { color: '#000000', size: 14, colorParam: Params.FREETEXT_COLOR, sizeParam: Params.FREETEXT_SIZE, sizeName: 'Font size', min: 5, max: 72 },
  ink: { color: '#d62d20', size: 2, colorParam: Params.INK_COLOR, sizeParam: Params.INK_THICKNESS, sizeName: 'Thickness', min: 1, max: 20 }
}

const bridge = getBridge()
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const container = $<HTMLDivElement>('viewerContainer')
const pageList = $<HTMLOListElement>('pageList')
const message = $<HTMLDivElement>('message')
const saveButton = $<HTMLButtonElement>('save')
const undoButton = $<HTMLButtonElement>('undo')
const redoButton = $<HTMLButtonElement>('redo')
const zoomSelect = $<HTMLSelectElement>('zoom')
const toolOptions = $<HTMLDivElement>('toolOptions')
const toolColor = $<HTMLInputElement>('toolColor')
const toolSize = $<HTMLInputElement>('toolSize')

const eventBus = new EventBus()
const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' })
const signatureManager = new SimpleSignatureManager()
const viewer = new PDFViewer({
  container,
  eventBus,
  linkService,
  annotationMode: AnnotationMode.ENABLE_FORMS,
  annotationEditorMode: EditorType.NONE,
  annotationEditorHighlightColors: HIGHLIGHT_COLORS,
  enableHighlightFloatingButton: true,
  // pdf.js only calls getSignature/loadSignatures/renderEditButton/destroy on it.
  signatureManager: signatureManager as never,
  imageResourcesPath: './pdfjs/images/'
} as ConstructorParameters<typeof PDFViewer>[0])
linkService.setViewer(viewer)

let pdfDocument: PDFDocumentProxy | null = null
let documentName = 'document.pdf'
let currentTool: ToolName = 'none'
let annotationsDirty = false
let pageOpsDirty = false
let reportedDirty = false
let editorCanUndo = false
let editorCanRedo = false
let busy = false
// Page tools reload the document, so they are undone by restoring the bytes from before the op.
const pageUndo: Uint8Array[] = []
const pageRedo: Uint8Array[] = []

function dataUrl(path: string): string {
  return new URL(path, window.location.href).href
}

function showMessage(text: string, kind: 'info' | 'error' = 'info', timeout = 4000): void {
  message.textContent = text
  message.dataset.kind = kind
  message.hidden = false
  if (timeout > 0) {
    const shown = text
    window.setTimeout(() => { if (message.textContent === shown) message.hidden = true }, timeout)
  }
}

function updateDirty(): void {
  const dirty = annotationsDirty || pageOpsDirty
  $('dirtyNote').hidden = !dirty
  if (dirty !== reportedDirty) {
    reportedDirty = dirty
    bridge.setDirty(dirty)
  }
}

function updateUndoButtons(): void {
  undoButton.disabled = busy || (!editorCanUndo && pageUndo.length === 0)
  redoButton.disabled = busy || (!editorCanRedo && pageRedo.length === 0)
  saveButton.disabled = busy || !pdfDocument
}

function setBusy(value: boolean): void {
  busy = value
  document.body.classList.toggle('is-busy', value)
  updateUndoButtons()
}

async function openBytes(bytes: Uint8Array, pageNumber = 1): Promise<void> {
  const previous = pdfDocument
  const task = pdfjsLib.getDocument({
    // pdf.js transfers the buffer to its worker; keep our copy intact for undo and page tools.
    data: bytes.slice(),
    cMapUrl: dataUrl('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: dataUrl('pdfjs/standard_fonts/'),
    wasmUrl: dataUrl('pdfjs/wasm/'),
    iccUrl: dataUrl('pdfjs/iccs/'),
    useSystemFonts: false,
    enableXfa: false
  })
  task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
    const answer = window.prompt(reason === 2 ? 'Wrong password. Enter the PDF password:' : 'This PDF is password protected. Enter its password:')
    if (answer === null) void task.destroy()
    else updatePassword(answer)
  }
  const loaded = await task.promise
  pdfDocument = loaded
  editorCanUndo = false
  editorCanRedo = false
  // Typed as null in pdfjs-dist's d.ts, but they are plain callbacks.
  const storage = loaded.annotationStorage as unknown as { onSetModified: (() => void) | null; onResetModified: (() => void) | null }
  storage.onSetModified = () => { annotationsDirty = true; updateDirty() }
  storage.onResetModified = () => { annotationsDirty = false; updateDirty() }
  annotationsDirty = false
  viewer.setDocument(loaded)
  linkService.setDocument(loaded, null)
  eventBus.on('pagesinit', function restore() {
    eventBus.off('pagesinit', restore)
    viewer.currentScaleValue = zoomSelect.value
    viewer.currentPageNumber = Math.min(pageNumber, loaded.numPages)
    if (currentTool !== 'none') setTool(currentTool, false)
  })
  if (previous && previous !== loaded) void previous.loadingTask.destroy()
  renderPageList(loaded)
  updateDirty()
  updateUndoButtons()
}

// --- Tools -----------------------------------------------------------------------------------

function applyToolSettings(tool: ToolName): void {
  const settings = toolSettings[tool]
  toolOptions.hidden = !settings
  if (!settings) return
  toolColor.value = settings.color
  toolSize.min = String(settings.min)
  toolSize.max = String(settings.max)
  toolSize.value = String(settings.size)
  $('toolSizeName').textContent = settings.sizeName
  $('toolSizeLabel').title = settings.sizeName
  eventBus.dispatch('switchannotationeditorparams', { source: window, type: settings.colorParam, value: settings.color })
  eventBus.dispatch('switchannotationeditorparams', { source: window, type: settings.sizeParam, value: settings.size })
}

function setTool(tool: ToolName, create = true): void {
  currentTool = tool
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    const active = button.dataset.tool === tool
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-checked', String(active))
  }
  const mode = TOOL_MODES[tool]
  // Image and signature start right away: a file picker / the signature dialog.
  const needsCreate = create && (tool === 'stamp' || tool === 'signature')
  if (needsCreate) {
    eventBus.on('annotationeditormodechanged', function created({ mode: changed }: { mode: number }) {
      eventBus.off('annotationeditormodechanged', created)
      if (changed === mode) eventBus.dispatch('switchannotationeditorparams', { source: window, type: Params.CREATE, value: {} })
    })
  }
  try {
    viewer.annotationEditorMode = { mode }
  } catch (error) {
    console.warn('[pdf editor] could not switch tool', error)
  }
  toolOptions.hidden = !toolSettings[tool]
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
  button.setAttribute('role', 'radio')
  button.addEventListener('click', () => {
    const tool = (button.dataset.tool ?? 'none') as ToolName
    setTool(tool === currentTool && tool !== 'stamp' && tool !== 'signature' ? 'none' : tool)
  })
}

toolColor.addEventListener('input', () => {
  const settings = toolSettings[currentTool]
  if (!settings) return
  settings.color = toolColor.value
  eventBus.dispatch('switchannotationeditorparams', { source: window, type: settings.colorParam, value: settings.color })
})
toolSize.addEventListener('input', () => {
  const settings = toolSettings[currentTool]
  if (!settings) return
  settings.size = Number(toolSize.value)
  eventBus.dispatch('switchannotationeditorparams', { source: window, type: settings.sizeParam, value: settings.size })
})

// pdf.js asks to change mode itself (e.g. double-clicking an existing annotation, Escape).
eventBus.on('switchannotationeditormode', (event: { source: unknown; mode: number; editId?: string; isFromKeyboard?: boolean }) => {
  const { source: _source, ...options } = event
  viewer.annotationEditorMode = options
})
// The mode switch is async; apply the tool's colour/size once pdf.js is in the new mode.
eventBus.on('annotationeditormodechanged', ({ mode }: { mode: number }) => {
  const tool = (Object.entries(TOOL_MODES).find(([, value]) => value === mode)?.[0] ?? 'none') as ToolName
  currentTool = tool
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    button.classList.toggle('is-active', button.dataset.tool === tool)
    button.setAttribute('aria-checked', String(button.dataset.tool === tool))
  }
  applyToolSettings(tool)
})
function onEditingStates({ details }: { details: { hasSomethingToUndo?: boolean; hasSomethingToRedo?: boolean } }): void {
  if (typeof details.hasSomethingToUndo === 'boolean') editorCanUndo = details.hasSomethingToUndo
  if (typeof details.hasSomethingToRedo === 'boolean') editorCanRedo = details.hasSomethingToRedo
  updateUndoButtons()
}
// pdfjs-dist 6 names it editingstateschanged; older builds used annotationeditorstateschanged.
eventBus.on('editingstateschanged', onEditingStates)
eventBus.on('annotationeditorstateschanged', onEditingStates)

// --- Undo / redo -----------------------------------------------------------------------------

async function undo(): Promise<void> {
  if (busy) return
  if (editorCanUndo) {
    eventBus.dispatch('editingaction', { source: window, name: 'undo' })
    return
  }
  const previous = pageUndo.pop()
  if (!previous || !pdfDocument) return
  await reloadWith(async (current) => {
    pageRedo.push(current)
    return previous
  })
}

async function redo(): Promise<void> {
  if (busy) return
  if (editorCanRedo) {
    eventBus.dispatch('editingaction', { source: window, name: 'redo' })
    return
  }
  const next = pageRedo.pop()
  if (!next || !pdfDocument) return
  await reloadWith(async (current) => {
    pageUndo.push(current)
    return next
  })
}

undoButton.addEventListener('click', () => { void undo() })
redoButton.addEventListener('click', () => { void redo() })

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range', 'color'].includes(target.type))
}

// In edit modes pdf.js handles ⌘Z itself; in Select mode (forms) the page tools' undo lives here.
window.addEventListener('keydown', (event) => {
  const mod = event.metaKey || event.ctrlKey
  if (!mod || event.altKey || isTextTarget(event.target) || currentTool !== 'none') return
  const key = event.key.toLowerCase()
  if (key === 'z' && !event.shiftKey) { event.preventDefault(); void undo() }
  else if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); void redo() }
})
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && currentTool !== 'none' && !isTextTarget(event.target)) setTool('none')
})

// --- Page tools (pdf-lib) --------------------------------------------------------------------

/**
 * Bake the current edits into bytes, swap in what `next` returns and reopen the document. Edits are
 * then part of the bytes rather than pending in pdf.js, so the editor stays dirty until a Save.
 */
async function reloadWith(next: (current: Uint8Array) => Promise<Uint8Array>): Promise<void> {
  if (!pdfDocument) return
  setBusy(true)
  const page = viewer.currentPageNumber
  try {
    const current = await pdfDocument.saveDocument()
    const bytes = await next(current)
    await openBytes(bytes, page)
    pageOpsDirty = true
  } catch (error) {
    showMessage(error instanceof PageOpError ? error.message : `Could not change the pages: ${error instanceof Error ? error.message : String(error)}`, 'error', 6000)
  } finally {
    setBusy(false)
    updateDirty()
  }
}

async function runPageOp(op: PageOp): Promise<void> {
  if (busy) return
  await reloadWith(async (current) => {
    const result = await applyPageOps(current, [op])
    pageUndo.push(current)
    pageRedo.length = 0
    return result
  })
}

function rotate(page: number, by: PageRotation): void { void runPageOp({ type: 'rotate', page, by }) }

function pageButton(label: string, title: string, action: () => void, disabled = false): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.title = title
  button.setAttribute('aria-label', title)
  button.disabled = disabled
  button.addEventListener('click', (event) => { event.stopPropagation(); action() })
  return button
}

let thumbnailObserver: IntersectionObserver | null = null
let dragFrom: number | null = null

function renderPageList(document_: PDFDocumentProxy): void {
  thumbnailObserver?.disconnect()
  pageList.textContent = ''
  const count = document_.numPages
  thumbnailObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const item = entry.target as HTMLLIElement
      thumbnailObserver?.unobserve(item)
      void renderThumbnail(document_, Number(item.dataset.index), item.querySelector('canvas')!)
    }
  }, { root: $('pages'), rootMargin: '200px' })
  for (let index = 0; index < count; index += 1) {
    const item = document.createElement('li')
    item.dataset.index = String(index)
    item.draggable = true
    item.title = `Page ${index + 1}`
    const thumb = document.createElement('div')
    thumb.className = 'thumb'
    thumb.append(document.createElement('canvas'))
    const label = document.createElement('span')
    label.className = 'page-number'
    label.textContent = String(index + 1)
    const actions = document.createElement('div')
    actions.className = 'page-actions'
    actions.append(
      pageButton('↺', `Rotate page ${index + 1} left`, () => rotate(index, 270)),
      pageButton('↻', `Rotate page ${index + 1} right`, () => rotate(index, 90)),
      pageButton('↑', `Move page ${index + 1} up`, () => void runPageOp({ type: 'move', from: index, to: index - 1 }), index === 0),
      pageButton('↓', `Move page ${index + 1} down`, () => void runPageOp({ type: 'move', from: index, to: index + 1 }), index === count - 1),
      pageButton('✕', `Delete page ${index + 1}`, () => void runPageOp({ type: 'delete', page: index }), count === 1)
    )
    item.append(thumb, label, actions)
    item.addEventListener('click', () => { viewer.currentPageNumber = index + 1 })
    item.addEventListener('dragstart', (event) => {
      dragFrom = index
      event.dataTransfer?.setData('text/plain', String(index))
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    })
    item.addEventListener('dragover', (event) => {
      if (dragFrom === null) return
      event.preventDefault()
      item.classList.add('is-drop-target')
    })
    item.addEventListener('dragleave', () => item.classList.remove('is-drop-target'))
    item.addEventListener('drop', (event) => {
      event.preventDefault()
      item.classList.remove('is-drop-target')
      const from = dragFrom
      dragFrom = null
      if (from !== null && from !== index) void runPageOp({ type: 'move', from, to: index })
    })
    item.addEventListener('dragend', () => { dragFrom = null })
    pageList.append(item)
    thumbnailObserver.observe(item)
  }
  markCurrentPage(viewer.currentPageNumber || 1)
}

async function renderThumbnail(document_: PDFDocumentProxy, index: number, canvas: HTMLCanvasElement): Promise<void> {
  if (document_ !== pdfDocument) return
  try {
    const page = await document_.getPage(index + 1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 112 / base.width })
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * ratio)
    canvas.height = Math.floor(viewport.height * ratio)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    await page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise
  } catch {
    // A thumbnail failing (document swapped mid-render) is harmless.
  }
}

function markCurrentPage(pageNumber: number): void {
  for (const item of pageList.children) item.classList.toggle('is-current', Number((item as HTMLElement).dataset.index) === pageNumber - 1)
}

eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => markCurrentPage(pageNumber))

// --- Zoom / layout ---------------------------------------------------------------------------

zoomSelect.addEventListener('change', () => { viewer.currentScaleValue = zoomSelect.value })
$('zoomIn').addEventListener('click', () => viewer.increaseScale())
$('zoomOut').addEventListener('click', () => viewer.decreaseScale())
eventBus.on('scalechanging', ({ presetValue, scale }: { presetValue?: string; scale: number }) => {
  const preset = presetValue ?? String(Math.round(scale * 100) / 100)
  if ([...zoomSelect.options].some((option) => option.value === preset)) zoomSelect.value = preset
})
$('togglePages').addEventListener('click', (event) => {
  const hidden = document.body.classList.toggle('pages-hidden')
  ;(event.currentTarget as HTMLElement).classList.toggle('is-active', !hidden)
})

// --- Save / back -----------------------------------------------------------------------------

async function save(): Promise<void> {
  if (!pdfDocument || busy) return
  // Commit an in-progress text box first so it is part of the file.
  if (currentTool !== 'none') setTool('none', false)
  setBusy(true)
  try {
    const bytes = await pdfDocument.saveDocument()
    const result = await bridge.save(bytes)
    if (result.saved) {
      pdfDocument.annotationStorage.resetModified()
      annotationsDirty = false
      pageOpsDirty = false
      updateDirty()
      showMessage(`Saved ${result.filename ?? documentName}`)
    }
  } catch (error) {
    showMessage(`Could not save: ${error instanceof Error ? error.message : String(error)}`, 'error', 8000)
  } finally {
    setBusy(false)
  }
}

saveButton.addEventListener('click', () => { void save() })
$('back').addEventListener('click', () => bridge.backToViewer())
bridge.onCommand((command: PdfEditorCommand) => {
  if (command === 'save') void save()
  else if (command === 'undo') void undo()
  else void redo()
})

// --- Start -----------------------------------------------------------------------------------

async function start(): Promise<void> {
  setBusy(true)
  showMessage('Opening PDF…', 'info', 0)
  try {
    const result = await bridge.load()
    documentName = result.name
    document.title = `Editing – ${result.name}`
    if (!result.ok) {
      showMessage(result.error, 'error', 0)
      return
    }
    await openBytes(result.bytes)
    message.hidden = true
    container.focus()
  } catch (error) {
    showMessage(`Could not open this PDF: ${error instanceof Error ? error.message : String(error)}`, 'error', 0)
  } finally {
    setBusy(false)
  }
}

void start()
