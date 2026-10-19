// Signature manager for pdf.js's SignatureEditor (the full one ships only with Mozilla's viewer app).
// Draw, type or upload / paste / drop a signature or initials; optionally keep it for next time.
// Saved ones are kept by main (encrypted with the OS keychain) as their source strokes / text /
// image, and rebuilt by pdf.js for each page they land on.
//
// Everything is placed as a filled vector outline ("contour" signature) in a real ink colour: drawn
// strokes go through signature-ink.ts (pressure / speed width, smoothing, tapered ends), typed ones
// through pdf.js's text tracer, images through its image tracer after the paper is knocked out.
import type { NewSavedSignature, SavedSignature, SavedSignatureKind, SavedSignatureSource, SignatureCurve, SignatureInk } from '../../../shared/pdf-signatures'
import { MAX_SIGNATURE_IMAGE_CHARS, SIGNATURE_INKS, signatureInk } from '../../../shared/pdf-signatures'
import { DEFAULT_PEN_WEIGHT_INDEX, PEN_WEIGHTS, penWidthFactor, strokeOutline } from '../../../shared/signature-ink'
import type { SavedSignaturesResult, SurffishPdfBridge } from './bridge'

interface SignatureCurves {
  curves: { points: number[] }[]
  width: number
  height: number
  thickness: number
}

interface PdfFont { fontFamily: string; fontStyle: string; fontWeight: string }

/** The parts of pdf.js's SignatureEditor this manager drives. */
export interface SignatureEditorLike {
  getDrawnSignature(curves: SignatureCurves): unknown
  getFromText(text: string, font: PdfFont): unknown
  getFromImage(bitmap: ImageBitmap): unknown
  addSignature(data: unknown, heightInPage: number, description: string, uuid: string | null): void
  remove(): void
}

/** Where the next signature goes: a form's signature field (set by forms.ts before the dialog opens). */
interface SignaturePlacement {
  onPlaced(editor: SignatureEditorLike): void
  onCancelled(): void
}

type SignatureSize = 's' | 'm' | 'l'
type DrawSource = Extract<SavedSignatureSource, { type: 'draw' }>

/** Height on the page (PDF points) a new signature gets; fields cap it to fit the box. */
const PLACED_HEIGHT: Record<SavedSignatureKind, Record<SignatureSize, number>> = {
  signature: { s: 22, m: 30, l: 42 },
  initials: { s: 14, m: 20, l: 28 }
}
const MAX_IMAGE_SIDE = 900
const MAX_FONT_CHOICES = 8
const PREFS_KEY = 'surffish.pdfSignature.prefs'

interface SignatureFont { id: string; label: string; family: string; style?: 'italic'; probe?: string[] }

/**
 * Signature faces: system script fonts where the OS has them (macOS / Windows), plus two bundled OFL
 * fonts so Linux and bare installs still get real choices. 'snell' is the original stack, and what
 * typed signatures saved before font choices existed are drawn with.
 */
const FONTS: SignatureFont[] = [
  { id: 'snell', label: 'Snell Roundhand', family: '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive', style: 'italic', probe: ['Snell Roundhand'] },
  { id: 'segoe-script', label: 'Segoe Script', family: '"Segoe Script", cursive', probe: ['Segoe Script'] },
  { id: 'great-vibes', label: 'Great Vibes', family: '"Surffish Great Vibes", cursive' },
  { id: 'dancing-script', label: 'Dancing Script', family: '"Surffish Dancing Script", cursive' },
  { id: 'savoye', label: 'Savoye', family: '"Savoye LET", cursive', probe: ['Savoye LET'] },
  { id: 'apple-chancery', label: 'Apple Chancery', family: '"Apple Chancery", cursive', probe: ['Apple Chancery'] },
  { id: 'bradley-hand', label: 'Bradley Hand', family: '"Bradley Hand", "Bradley Hand ITC", cursive', probe: ['Bradley Hand', 'Bradley Hand ITC'] },
  { id: 'lucida-handwriting', label: 'Lucida Handwriting', family: '"Lucida Handwriting", cursive', probe: ['Lucida Handwriting'] },
  { id: 'brush-script', label: 'Brush Script', family: '"Brush Script MT", cursive', probe: ['Brush Script MT'] },
  { id: 'ink-free', label: 'Ink Free', family: '"Ink Free", cursive', probe: ['Ink Free'] },
  { id: 'noteworthy', label: 'Noteworthy', family: 'Noteworthy, cursive', probe: ['Noteworthy'] },
  { id: 'zapfino', label: 'Zapfino', family: 'Zapfino, cursive', probe: ['Zapfino'] }
]

function fontFor(id: string | undefined): SignatureFont {
  return FONTS.find((font) => font.id === id) ?? FONTS[0]!
}

function pdfFont(font: SignatureFont, weight: 400 | 700 | undefined): PdfFont {
  return { fontFamily: font.family, fontStyle: font.style ?? 'normal', fontWeight: String(weight ?? 400) }
}

function cssFont(font: SignatureFont, weight: 400 | 700 | undefined, size: number): string {
  return `${font.style ?? 'normal'} ${weight ?? 400} ${size}px ${font.family}`
}

/** Wait for a bundled face (system ones resolve at once); never throws. */
async function ensureFont(font: SignatureFont, weight: 400 | 700 | undefined, text: string): Promise<void> {
  try {
    await document.fonts.load(cssFont(font, weight, 40), text || 'Signature')
  } catch { /* fall back to whatever the stack resolves to */ }
}

let measureContext: CanvasRenderingContext2D | null = null
/** Whether a local font is installed: its metrics differ from both generic fallbacks. */
function hasLocalFont(name: string): boolean {
  measureContext ??= document.createElement('canvas').getContext('2d')
  const context = measureContext
  if (!context) return false
  const sample = 'mmmmmmmmmmlli WwQ@ Signature'
  for (const generic of ['monospace', 'serif']) {
    context.font = `40px ${generic}`
    const base = context.measureText(sample).width
    context.font = `40px "${name}", ${generic}`
    if (context.measureText(sample).width !== base) return true
  }
  return false
}

function availableFonts(): SignatureFont[] {
  const found = FONTS.filter((font) => !font.probe || font.probe.some((name) => hasLocalFont(name)))
  return found.slice(0, MAX_FONT_CHOICES)
}

interface SignaturePrefs { ink: SignatureInk; size: SignatureSize; weight: number; font: string | null; bold: boolean }

function readPrefs(): SignaturePrefs {
  const prefs: SignaturePrefs = { ink: 'black', size: 'm', weight: DEFAULT_PEN_WEIGHT_INDEX, font: null, bold: false }
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Record<keyof SignaturePrefs, unknown>> | null
    if (!stored || typeof stored !== 'object') return prefs
    prefs.ink = signatureInk(stored.ink)
    if (stored.size === 's' || stored.size === 'm' || stored.size === 'l') prefs.size = stored.size
    if (typeof stored.weight === 'number' && Number.isInteger(stored.weight) && stored.weight >= 0 && stored.weight < PEN_WEIGHTS.length) prefs.weight = stored.weight
    if (typeof stored.font === 'string' && FONTS.some((font) => font.id === stored.font)) prefs.font = stored.font
    prefs.bold = stored.bold === true
  } catch { /* defaults */ }
  return prefs
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing #${id}`)
  return found as T
}

async function bitmapFromDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const blob = await (await fetch(dataUrl)).blob()
  return createImageBitmap(blob)
}

/**
 * Turn a photo / scan / screenshot of a signature into ink on a transparent background, cropped to
 * the ink: pixels darker than the paper become black with matching opacity (the chosen ink colour
 * is applied when it is placed), everything paper-coloured goes transparent.
 */
async function signatureImageFromBlob(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  let scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const image = context.getImageData(0, 0, width, height)
  const data = image.data
  const histogram = new Uint32Array(256)
  const lightness = new Uint8ClampedArray(width * height)
  for (let index = 0; index < lightness.length; index += 1) {
    const alpha = data[index * 4 + 3]! / 255
    const value = (data[index * 4]! * 0.299 + data[index * 4 + 1]! * 0.587 + data[index * 4 + 2]! * 0.114) * alpha + 255 * (1 - alpha)
    lightness[index] = value
    histogram[lightness[index]!]! += 1
  }
  // Paper: most of a signature image is background, so take a bright-ish percentile as its level.
  let seen = 0
  let paper = 255
  for (let level = 0; level < 256; level += 1) {
    seen += histogram[level]!
    if (seen >= lightness.length * 0.7) { paper = level; break }
  }
  const clear = paper - Math.max(16, paper * 0.12)
  const solid = Math.min(clear - 24, paper * 0.55)
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let index = 0; index < lightness.length; index += 1) {
    const ink = Math.min(1, Math.max(0, (clear - lightness[index]!) / Math.max(1, clear - solid)))
    data[index * 4] = 0
    data[index * 4 + 1] = 0
    data[index * 4 + 2] = 0
    data[index * 4 + 3] = Math.round(ink * 255)
    if (ink > 0.2) {
      const x = index % width
      const y = (index - x) / width
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) throw new Error('No ink found in that image.')
  context.putImageData(image, 0, 0)
  const pad = 4
  const cropX = Math.max(0, minX - pad)
  const cropY = Math.max(0, minY - pad)
  const cropWidth = Math.min(width, maxX + pad + 1) - cropX
  const cropHeight = Math.min(height, maxY + pad + 1) - cropY
  scale = 1
  for (;;) {
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(cropWidth * scale))
    out.height = Math.max(1, Math.round(cropHeight * scale))
    out.getContext('2d')!.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, out.width, out.height)
    const dataUrl = out.toDataURL('image/png')
    if (dataUrl.length <= MAX_SIGNATURE_IMAGE_CHARS || scale < 0.2) return dataUrl
    scale *= 0.75
  }
}

function strokePaths(source: Pick<DrawSource, 'curves' | 'thickness'>): Path2D[] {
  const paths: Path2D[] = []
  for (const curve of source.curves) {
    const outline = strokeOutline(curve.points, curve.widths, source.thickness)
    if (outline.length < 6) continue
    const path = new Path2D()
    path.moveTo(outline[0]!, outline[1]!)
    for (let index = 2; index < outline.length; index += 2) path.lineTo(outline[index]!, outline[index + 1]!)
    path.closePath()
    paths.push(path)
  }
  return paths
}

/** Draw a saved / current signature scaled into a preview canvas, in its ink. */
function drawPreview(canvas: HTMLCanvasElement, source: SavedSignatureSource, ink: SignatureInk): void {
  const context = canvas.getContext('2d')!
  const color = SIGNATURE_INKS[ink].hex
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = color
  if (source.type === 'draw') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const { points } of source.curves) {
      for (let index = 0; index < points.length; index += 2) {
        minX = Math.min(minX, points[index]!); maxX = Math.max(maxX, points[index]!)
        minY = Math.min(minY, points[index + 1]!); maxY = Math.max(maxY, points[index + 1]!)
      }
    }
    const margin = source.thickness
    minX -= margin; minY -= margin; maxX += margin; maxY += margin
    const pad = 4
    const scale = Math.min((canvas.width - pad * 2) / Math.max(1, maxX - minX), (canvas.height - pad * 2) / Math.max(1, maxY - minY))
    const offsetX = (canvas.width - (maxX - minX) * scale) / 2
    const offsetY = (canvas.height - (maxY - minY) * scale) / 2
    context.setTransform(scale, 0, 0, scale, offsetX - minX * scale, offsetY - minY * scale)
    for (const path of strokePaths(source)) context.fill(path)
    context.setTransform(1, 0, 0, 1, 0, 0)
  } else if (source.type === 'text') {
    const font = fontFor(source.font)
    let size = canvas.height * 0.6
    context.font = cssFont(font, source.weight, size)
    const width = context.measureText(source.text).width
    if (width > canvas.width - 8) {
      size *= (canvas.width - 8) / width
      context.font = cssFont(font, source.weight, size)
    }
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(source.text, canvas.width / 2, canvas.height / 2)
  } else {
    void bitmapFromDataUrl(source.dataUrl).then((bitmap) => {
      const scale = Math.min((canvas.width - 8) / bitmap.width, (canvas.height - 8) / bitmap.height, 2)
      const width = bitmap.width * scale
      const height = bitmap.height * scale
      // Tint on a scratch canvas (the image is black ink on transparent), then lay it on the white.
      const tinted = document.createElement('canvas')
      tinted.width = Math.max(1, Math.round(width))
      tinted.height = Math.max(1, Math.round(height))
      const scratch = tinted.getContext('2d')!
      scratch.drawImage(bitmap, 0, 0, tinted.width, tinted.height)
      scratch.globalCompositeOperation = 'source-in'
      scratch.fillStyle = color
      scratch.fillRect(0, 0, tinted.width, tinted.height)
      context.drawImage(tinted, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
      bitmap.close()
    }).catch(() => undefined)
  }
}

// --- pdf.js internals: vector pen outlines and ink colour ---------------------------------------

type OutlineConstructor = (new () => { build(...args: unknown[]): void }) & {
  createBezierPoints?(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): number[]
}
interface EditorInternals {
  parent?: { viewport?: { rawDims?: { pageWidth: number; pageHeight: number }; rotation: number }; drawLayer?: { updateProperties(id: number, properties: object): void } }
  _drawingOptions?: { 'stroke-width'?: number; updateProperty(name: string, value: unknown): void; toSVGProperties(): object }
  _drawId?: number | null
  serialize?: (isForCopying?: boolean) => unknown
}

let contourOutline: OutlineConstructor | null | undefined
/** pdf.js's filled-outline class (not exported), taken from a traced scrap of text once. */
function contourClass(editor: SignatureEditorLike): OutlineConstructor | null {
  if (contourOutline !== undefined) return contourOutline
  try {
    const probe = editor.getFromText('Il', { fontFamily: 'sans-serif', fontStyle: 'normal', fontWeight: '400' }) as { outline?: object } | null
    const found = probe?.outline?.constructor as OutlineConstructor | undefined
    contourOutline = found && typeof found.createBezierPoints === 'function' ? found : null
  } catch {
    contourOutline = null
  }
  return contourOutline
}

/**
 * A drawn signature as filled pen outlines, built like pdf.js's own processDrawnLines (with
 * areContours) so the editor treats it exactly like a typed or traced one. Falls back to pdf.js's
 * even-width ink if its internals ever move.
 */
function drawnSignatureData(editor: SignatureEditorLike, source: DrawSource): unknown {
  const Contour = contourClass(editor)
  const internals = editor as unknown as EditorInternals & { constructor: { _INNER_MARGIN?: number } }
  const viewport = internals.parent?.viewport
  const bezier = Contour?.createBezierPoints
  if (!Contour || !bezier || !viewport?.rawDims) {
    return editor.getDrawnSignature({ curves: source.curves.map(({ points }) => ({ points })), width: source.width, height: source.height, thickness: source.thickness })
  }
  let { pageWidth, pageHeight } = viewport.rawDims
  const rotation = viewport.rotation
  if (rotation % 180 !== 0) [pageWidth, pageHeight] = [pageHeight, pageWidth]
  const ratio = Math.min(pageWidth / source.width, pageHeight / source.height)
  const xScale = ratio / pageWidth
  const yScale = ratio / pageHeight
  const linesAndPoints: { line: Float32Array; points: Float32Array }[] = []
  const newCurves: number[][] = []
  for (const curve of source.curves) {
    const outline = strokeOutline(curve.points, curve.widths, source.thickness)
    if (outline.length < 6) continue
    newCurves.push(outline)
    const points = new Float32Array(outline.length)
    const line = new Float32Array(3 * (outline.length - 2))
    let x1 = outline[0]! * xScale, y1 = outline[1]! * yScale, x2 = outline[2]! * xScale, y2 = outline[3]! * yScale
    points.set([x1, y1, x2, y2], 0)
    line.set([NaN, NaN, NaN, NaN, x1, y1], 0)
    for (let index = 4; index < outline.length; index += 2) {
      const x = (points[index] = outline[index]! * xScale)
      const y = (points[index + 1] = outline[index + 1]! * yScale)
      line.set(bezier.call(Contour, x1, y1, x2, y2, x, y), (index - 2) * 3)
      ;[x1, y1, x2, y2] = [x2, y2, x, y]
    }
    linesAndPoints.push({ line, points })
  }
  if (linesAndPoints.length === 0) return null
  const outline = new Contour()
  outline.build(linesAndPoints, pageWidth, pageHeight, 1, rotation, 0, internals.constructor._INNER_MARGIN ?? 3)
  return { outline, newCurves, areContours: true, thickness: 0, width: source.width, height: source.height }
}

/** Colour a placed signature (on screen and in the saved PDF) with a real ink instead of #000. */
function applyInk(editor: SignatureEditorLike, ink: SignatureInk): void {
  const { hex, rgb } = SIGNATURE_INKS[ink]
  const target = editor as unknown as EditorInternals
  const options = target._drawingOptions
  if (!options) return
  try {
    // Outlines (typed / traced / pen) are filled; pdf.js's even-width fallback is stroked.
    options.updateProperty(options['stroke-width'] ? 'stroke' : 'fill', hex)
    if (target._drawId !== null && target._drawId !== undefined) target.parent?.drawLayer?.updateProperties(target._drawId, options.toSVGProperties())
  } catch (error) {
    console.warn('[pdf editor] could not colour the signature', error)
    return
  }
  const serialize = target.serialize?.bind(editor)
  if (!serialize) return
  // pdf.js writes signatures as black; keep the ink in the saved annotation.
  target.serialize = (isForCopying?: boolean) => {
    const data = serialize(isForCopying)
    if (data && typeof data === 'object' && 'color' in data) (data as { color: number[] }).color = [...rgb]
    return data
  }
}

export class SavedSignatureManager {
  readonly #bridge: SurffishPdfBridge
  readonly #dialog = element<HTMLDialogElement>('signatureDialog')
  readonly #pad = element<HTMLCanvasElement>('signaturePad')
  readonly #text = element<HTMLInputElement>('signatureText')
  readonly #bold = element<HTMLButtonElement>('signatureBold')
  readonly #fonts = element<HTMLElement>('signatureFonts')
  readonly #thickness = element<HTMLInputElement>('signatureThickness')
  readonly #undoStroke = element<HTMLButtonElement>('signatureUndo')
  readonly #description = element<HTMLInputElement>('signatureDescription')
  readonly #remember = element<HTMLInputElement>('signatureRemember')
  readonly #savedSection = element<HTMLElement>('savedSignatures')
  readonly #savedList = element<HTMLUListElement>('savedSignatureList')
  readonly #storageNote = element<HTMLElement>('signatureStorageNote')
  readonly #imageInput = element<HTMLInputElement>('signatureImage')
  readonly #imagePreview = element<HTMLCanvasElement>('signatureImagePreview')
  readonly #error = element<HTMLElement>('signatureError')
  readonly #context = this.#pad.getContext('2d')!
  #curves: SignatureCurve[] = []
  #paths: (Path2D | null)[] = []
  #drawing: { curve: SignatureCurve; x: number; y: number; time: number; factor: number } | null = null
  #tab: 'draw' | 'type' | 'image' = 'draw'
  #kind: SavedSignatureKind = 'signature'
  #prefs = readPrefs()
  #fontChoices: SignatureFont[] | null = null
  #imageDataUrl: string | null = null
  #editor: SignatureEditorLike | null = null
  #placement: SignaturePlacement | null = null
  #saved: SavedSignature[] = []
  #loaded: Promise<void> | null = null

  constructor(bridge: SurffishPdfBridge) {
    this.#bridge = bridge
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-signature-tab]')) {
      button.addEventListener('click', () => this.#selectTab((button.dataset.signatureTab ?? 'draw') as 'draw' | 'type' | 'image'))
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-signature-kind]')) {
      button.addEventListener('click', () => this.#selectKind(button.dataset.signatureKind === 'initials' ? 'initials' : 'signature'))
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-signature-ink]')) {
      button.addEventListener('click', () => this.#setPrefs({ ink: signatureInk(button.dataset.signatureInk) }))
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-signature-size]')) {
      const size = button.dataset.signatureSize
      button.addEventListener('click', () => this.#setPrefs({ size: size === 's' || size === 'l' ? size : 'm' }))
    }
    this.#thickness.max = String(PEN_WEIGHTS.length - 1)
    this.#thickness.addEventListener('input', () => {
      this.#setPrefs({ weight: Math.min(PEN_WEIGHTS.length - 1, Math.max(0, Math.round(Number(this.#thickness.value)) || 0)) })
    })
    this.#bold.addEventListener('click', () => this.#setPrefs({ bold: !this.#prefs.bold }))
    this.#text.addEventListener('input', () => this.#renderFontChoices())
    element('signatureClear').addEventListener('click', () => this.#clear())
    this.#undoStroke.addEventListener('click', () => this.#undoLastStroke())
    element('signatureCancel').addEventListener('click', () => this.#dialog.close('cancel'))
    element<HTMLFormElement>('signatureForm').addEventListener('submit', (event) => {
      event.preventDefault()
      void this.#commit()
    })
    this.#dialog.addEventListener('close', () => {
      this.#dialog.classList.remove('is-dropping')
      // Cancelled: drop the empty placeholder editor pdf.js created for the signature.
      if (this.#editor) this.#editor.remove()
      this.#editor = null
      const placement = this.#placement
      this.#placement = null
      placement?.onCancelled()
    })
    this.#dialog.addEventListener('keydown', (event) => {
      // ⌘Z / Ctrl+Z on the pad undoes the last stroke (and never reaches pdf.js's own undo).
      const mod = event.metaKey || event.ctrlKey
      if (!mod || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z') return
      const target = event.target
      if (target instanceof HTMLInputElement && target.type === 'text') return
      event.preventDefault()
      event.stopPropagation()
      if (this.#tab === 'draw') this.#undoLastStroke()
    })
    this.#imageInput.addEventListener('change', () => {
      const file = this.#imageInput.files?.[0]
      if (file) this.#useImage(file)
    })
    // Paste an image (⌘V / Ctrl+V) anywhere in the dialog; plain text pastes still go to the inputs.
    document.addEventListener('paste', (event) => {
      if (!this.#dialog.open) return
      const file = [...(event.clipboardData?.items ?? [])].find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
      if (!file) return
      event.preventDefault()
      this.#useImage(file)
    })
    // Drop an image file onto the dialog.
    const hasFiles = (event: DragEvent): boolean => Boolean(event.dataTransfer?.types.includes('Files'))
    this.#dialog.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      this.#dialog.classList.add('is-dropping')
    })
    this.#dialog.addEventListener('dragleave', (event) => {
      if (event.target === this.#dialog || !this.#dialog.contains(event.relatedTarget as Node | null)) this.#dialog.classList.remove('is-dropping')
    })
    this.#dialog.addEventListener('drop', (event) => {
      this.#dialog.classList.remove('is-dropping')
      if (!hasFiles(event)) return
      event.preventDefault()
      const file = [...(event.dataTransfer?.files ?? [])].find((entry) => entry.type.startsWith('image/'))
      if (file) this.#useImage(file)
      else this.#showError('Drop an image file (PNG, JPEG or WebP).')
    })
    this.#pad.addEventListener('pointerdown', (event) => {
      try { this.#pad.setPointerCapture(event.pointerId) } catch { /* synthetic or already released pointer */ }
      const [x, y] = this.#point(event)
      const factor = penWidthFactor({ pointerType: event.pointerType, pressure: event.pressure, speed: 0 }, null)
      const curve: SignatureCurve = { points: [x, y], widths: [factor] }
      this.#drawing = { curve, x, y, time: event.timeStamp, factor }
      this.#curves.push(curve)
      this.#paths.push(null)
      this.#paint()
    })
    this.#pad.addEventListener('pointermove', (event) => {
      const drawing = this.#drawing
      if (!drawing) return
      const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
      for (const sample of samples.length > 0 ? samples : [event]) {
        const [x, y] = this.#point(sample)
        const elapsed = Math.max(1, sample.timeStamp - drawing.time)
        const speed = Math.hypot(x - drawing.x, y - drawing.y) / elapsed
        drawing.factor = penWidthFactor({ pointerType: sample.pointerType, pressure: sample.pressure, speed }, drawing.factor)
        drawing.curve.points.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10)
        drawing.curve.widths!.push(drawing.factor)
        Object.assign(drawing, { x, y, time: sample.timeStamp })
      }
      this.#paths[this.#paths.length - 1] = null
      this.#paint()
    })
    const stop = (): void => { this.#drawing = null }
    this.#pad.addEventListener('pointerup', stop)
    this.#pad.addEventListener('pointercancel', stop)
    this.#applyPrefs()
  }

  /** The next signature goes into a form field: forms.ts sizes and positions it. */
  setPlacement(placement: SignaturePlacement | null, kind: SavedSignatureKind = 'signature'): void {
    this.#placement = placement
    this.#kind = kind
  }

  /** The height (PDF points) a new signature of this kind gets at the chosen size; fields cap it. */
  placementHeight(kind: SavedSignatureKind): number {
    return PLACED_HEIGHT[kind][this.#prefs.size]
  }

  /** The app menu's Undo while the dialog is open: undo a stroke instead of a page edit. */
  handleUndoCommand(): boolean {
    if (!this.#dialog.open) return false
    if (this.#tab === 'draw') this.#undoLastStroke()
    return true
  }

  #setPrefs(change: Partial<SignaturePrefs>): void {
    this.#prefs = { ...this.#prefs, ...change }
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.#prefs)) } catch { /* private storage off: this run only */ }
    if ('weight' in change) this.#paths = this.#paths.map(() => null)
    this.#applyPrefs()
  }

  #applyPrefs(): void {
    const { ink, size, weight, bold } = this.#prefs
    this.#dialog.style.setProperty('--ink', SIGNATURE_INKS[ink].hex)
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-signature-ink]')) button.setAttribute('aria-checked', String(button.dataset.signatureInk === ink))
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-signature-size]')) button.setAttribute('aria-checked', String(button.dataset.signatureSize === size))
    this.#thickness.value = String(weight)
    this.#bold.setAttribute('aria-pressed', String(bold))
    this.#applyTextFont()
    this.#paint()
    this.#renderFontChoices()
    if (this.#imageDataUrl) this.#showImagePreview()
  }

  #fontId(): string {
    const choices = this.#fontChoices ?? []
    if (this.#prefs.font && choices.some((font) => font.id === this.#prefs.font)) return this.#prefs.font
    return choices[0]?.id ?? FONTS[0]!.id
  }

  #applyTextFont(): void {
    const font = fontFor(this.#fontId())
    this.#text.style.fontFamily = font.family
    this.#text.style.fontStyle = font.style ?? 'normal'
    this.#text.style.fontWeight = this.#prefs.bold ? '700' : '400'
  }

  #renderFontChoices(): void {
    const choices = this.#fontChoices
    if (!choices) return
    const sample = this.#text.value.trim() || (this.#kind === 'initials' ? 'A.L.' : 'Your Name')
    const selected = this.#fontId()
    if (this.#fonts.childElementCount !== choices.length) {
      this.#fonts.textContent = ''
      for (const font of choices) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'font-choice'
        button.setAttribute('role', 'radio')
        button.dataset.fontId = font.id
        button.title = font.label
        button.style.fontFamily = font.family
        button.style.fontStyle = font.style ?? 'normal'
        button.addEventListener('click', () => this.#setPrefs({ font: font.id }))
        this.#fonts.append(button)
      }
    }
    for (const button of this.#fonts.querySelectorAll<HTMLButtonElement>('.font-choice')) {
      button.textContent = sample
      button.style.fontWeight = this.#prefs.bold ? '700' : '400'
      button.setAttribute('aria-checked', String(button.dataset.fontId === selected))
    }
  }

  #point(event: PointerEvent): [number, number] {
    const rect = this.#pad.getBoundingClientRect()
    return [
      ((event.clientX - rect.left) / rect.width) * this.#pad.width,
      ((event.clientY - rect.top) / rect.height) * this.#pad.height
    ]
  }

  #paint(): void {
    const context = this.#context
    context.clearRect(0, 0, this.#pad.width, this.#pad.height)
    context.fillStyle = SIGNATURE_INKS[this.#prefs.ink].hex
    const thickness = PEN_WEIGHTS[this.#prefs.weight] ?? PEN_WEIGHTS[DEFAULT_PEN_WEIGHT_INDEX]
    for (let index = 0; index < this.#curves.length; index += 1) {
      let path = this.#paths[index]
      if (!path) {
        path = strokePaths({ curves: [this.#curves[index]!], thickness })[0] ?? null
        this.#paths[index] = path
      }
      if (path) context.fill(path)
    }
    this.#undoStroke.disabled = this.#curves.length === 0
  }

  #clear(): void {
    this.#curves = []
    this.#paths = []
    this.#drawing = null
    this.#paint()
  }

  #undoLastStroke(): void {
    this.#drawing = null
    this.#curves.pop()
    this.#paths.pop()
    this.#paint()
  }

  #showError(text: string): void {
    this.#error.textContent = text
    this.#error.hidden = false
  }

  #useImage(file: Blob): void {
    this.#selectTab('image')
    void signatureImageFromBlob(file).then((dataUrl) => {
      this.#imageDataUrl = dataUrl
      this.#error.hidden = true
      this.#showImagePreview()
    }, (error: unknown) => this.#showError(error instanceof Error && error.message.startsWith('No ink') ? error.message : 'That image could not be read.'))
  }

  #showImagePreview(): void {
    if (!this.#imageDataUrl) return
    this.#imagePreview.hidden = false
    drawPreview(this.#imagePreview, { type: 'image', dataUrl: this.#imageDataUrl }, this.#prefs.ink)
  }

  #selectTab(tab: 'draw' | 'type' | 'image'): void {
    this.#tab = tab
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-signature-tab]')) {
      button.setAttribute('aria-selected', String(button.dataset.signatureTab === tab))
    }
    for (const pane of document.querySelectorAll<HTMLElement>('[data-signature-pane]')) pane.hidden = pane.dataset.signaturePane !== tab
    if (tab === 'type') {
      if (!this.#fontChoices) {
        this.#fontChoices = availableFonts()
        this.#applyTextFont()
        // Bundled faces load on first use; repaint the previews once they have.
        void Promise.all(this.#fontChoices.map((font) => ensureFont(font, 400, 'Your Name'))).then(() => this.#renderFontChoices())
      }
      this.#renderFontChoices()
      this.#text.focus()
    }
  }

  #selectKind(kind: SavedSignatureKind): void {
    const previousDefault = this.#kind === 'initials' ? 'Initials' : 'Signature'
    this.#kind = kind
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-signature-kind]')) {
      button.setAttribute('aria-checked', String(button.dataset.signatureKind === kind))
    }
    element('signatureTitle').textContent = kind === 'initials' ? 'Add initials' : 'Add a signature'
    this.#text.placeholder = kind === 'initials' ? 'Type your initials' : 'Type your name'
    if (!this.#description.value.trim() || this.#description.value === previousDefault) this.#description.value = kind === 'initials' ? 'Initials' : 'Signature'
    this.#renderSaved()
    this.#renderFontChoices()
  }

  #renderSaved(): void {
    this.#savedList.textContent = ''
    const items = this.#saved.filter((entry) => entry.kind === this.#kind)
    this.#savedSection.hidden = items.length === 0
    for (const entry of items) {
      const item = document.createElement('li')
      const pick = document.createElement('button')
      pick.type = 'button'
      pick.className = 'saved-signature'
      pick.dataset.signatureId = entry.id
      pick.title = `Use “${entry.description}”`
      const preview = document.createElement('canvas')
      preview.width = 150
      preview.height = 48
      if (entry.source.type === 'text') {
        const font = fontFor(entry.source.font)
        void ensureFont(font, entry.source.weight, entry.source.text).then(() => drawPreview(preview, entry.source, entry.ink))
      } else {
        drawPreview(preview, entry.source, entry.ink)
      }
      const label = document.createElement('span')
      label.textContent = entry.description
      pick.append(preview, label)
      pick.addEventListener('click', () => { void this.#useSaved(entry) })
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'delete'
      remove.textContent = '✕'
      remove.title = `Delete “${entry.description}”`
      remove.setAttribute('aria-label', `Delete saved ${entry.kind} ${entry.description}`)
      remove.dataset.deleteSignatureId = entry.id
      remove.addEventListener('click', () => { void this.#remove(entry.id) })
      item.append(pick, remove)
      this.#savedList.append(item)
    }
  }

  #apply(result: SavedSignaturesResult): void {
    this.#saved = result.signatures
    this.#storageNote.hidden = result.persistent
    this.#renderSaved()
  }

  /** Read the saved list (once; main reports the list back after every change). */
  load(): Promise<void> {
    this.#loaded ??= this.#bridge.signatures.list().then((result) => this.#apply(result), (error: unknown) => {
      console.warn('[pdf editor] could not read saved signatures', error)
      this.#loaded = null
    })
    return this.#loaded
  }

  async #remove(id: string): Promise<void> {
    try {
      this.#apply(await this.#bridge.signatures.remove(id))
    } catch (error) {
      this.#showError(`Could not delete it: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async #dataFor(editor: SignatureEditorLike, source: SavedSignatureSource): Promise<unknown> {
    if (source.type === 'draw') return drawnSignatureData(editor, source)
    if (source.type === 'text') {
      const font = fontFor(source.font)
      await ensureFont(font, source.weight, source.text)
      return editor.getFromText(source.text, pdfFont(font, source.weight))
    }
    const bitmap = await bitmapFromDataUrl(source.dataUrl)
    try {
      return editor.getFromImage(bitmap)
    } finally {
      bitmap.close()
    }
  }

  #place(editor: SignatureEditorLike, data: unknown, description: string, kind: SavedSignatureKind, ink: SignatureInk): void {
    this.#editor = null
    editor.addSignature(data, this.placementHeight(kind), description, null)
    applyInk(editor, ink)
    const placement = this.#placement
    this.#placement = null
    placement?.onPlaced(editor)
  }

  async #useSaved(entry: SavedSignature): Promise<void> {
    const editor = this.#editor
    if (!editor) return
    const data = await this.#dataFor(editor, entry.source).catch(() => null)
    if (!data) {
      this.#showError('That saved signature could not be used.')
      return
    }
    this.#place(editor, data, entry.description, entry.kind, entry.ink)
    this.#dialog.close('added')
  }

  #currentSource(): SavedSignatureSource | null {
    if (this.#tab === 'draw') {
      if (this.#curves.length === 0) return null
      return {
        type: 'draw',
        curves: this.#curves.map(({ points, widths }) => (widths && widths.length === points.length / 2 ? { points: [...points], widths: [...widths] } : { points: [...points] })),
        width: this.#pad.width,
        height: this.#pad.height,
        thickness: PEN_WEIGHTS[this.#prefs.weight] ?? PEN_WEIGHTS[DEFAULT_PEN_WEIGHT_INDEX]
      }
    }
    if (this.#tab === 'type') {
      const text = this.#text.value.trim()
      return text ? { type: 'text', text, font: this.#fontId(), weight: this.#prefs.bold ? 700 : 400 } : null
    }
    return this.#imageDataUrl ? { type: 'image', dataUrl: this.#imageDataUrl } : null
  }

  async #commit(): Promise<void> {
    const editor = this.#editor
    if (!editor) return
    const source = this.#currentSource()
    if (!source) {
      this.#showError(this.#tab === 'draw' ? 'Draw on the pad first.' : this.#tab === 'type' ? 'Type something first.' : 'Choose, drop or paste an image first.')
      return
    }
    const kind = this.#kind
    const ink = this.#prefs.ink
    const description = this.#description.value.trim() || (kind === 'initials' ? 'Initials' : 'Signature')
    const data = await this.#dataFor(editor, source).catch(() => null)
    if (!data) {
      this.#showError('That signature could not be read.')
      return
    }
    if (this.#remember.checked) {
      const entry: NewSavedSignature = { kind, description, source, ink }
      void this.#bridge.signatures.add(entry).then((result) => this.#apply(result), (error: unknown) => console.warn('[pdf editor] could not save the signature', error))
    }
    this.#place(editor, data, description, kind, ink)
    this.#dialog.close('added')
  }

  // --- pdf.js SignatureManager interface ---

  getSignature({ editor }: { editor: SignatureEditorLike }): void {
    if (this.#editor && this.#editor !== editor) this.#editor.remove()
    this.#editor = editor
    this.#clear()
    this.#text.value = ''
    this.#imageDataUrl = null
    this.#imageInput.value = ''
    this.#imagePreview.hidden = true
    this.#error.hidden = true
    this.#description.value = this.#kind === 'initials' ? 'Initials' : 'Signature'
    this.#selectKind(this.#kind)
    this.#selectTab('draw')
    void this.load()
    if (!this.#dialog.open) this.#dialog.showModal()
  }

  async loadSignatures(): Promise<void> {}

  async renderEditButton(): Promise<null> {
    return null
  }

  destroy(): void {
    if (this.#dialog.open) this.#dialog.close('cancel')
  }
}
