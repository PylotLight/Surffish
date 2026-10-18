// Signature manager for pdf.js's SignatureEditor (the full one ships only with Mozilla's viewer app).
// Draw, type or upload a signature or initials; optionally keep it for next time. Saved ones are kept
// by main (encrypted with the OS keychain) as their source strokes / text / image, and rebuilt by
// pdf.js for each page they land on.
import type { NewSavedSignature, SavedSignature, SavedSignatureKind, SavedSignatureSource } from '../../../shared/pdf-signatures'
import { MAX_SIGNATURE_IMAGE_CHARS } from '../../../shared/pdf-signatures'
import type { SavedSignaturesResult, SurffishPdfBridge } from './bridge'

interface SignatureCurves {
  curves: { points: number[] }[]
  width: number
  height: number
  thickness: number
}

/** The parts of pdf.js's SignatureEditor this manager drives. */
export interface SignatureEditorLike {
  getDrawnSignature(curves: SignatureCurves): unknown
  getFromText(text: string, font: { fontFamily: string; fontStyle: string; fontWeight: string }): unknown
  getFromImage(bitmap: ImageBitmap): unknown
  addSignature(data: unknown, heightInPage: number, description: string, uuid: string | null): void
  remove(): void
}

/** Where the next signature goes: a form's signature field (set by forms.ts before the dialog opens). */
interface SignaturePlacement {
  onPlaced(editor: SignatureEditorLike): void
  onCancelled(): void
}

const HEIGHT_IN_PAGE: Record<SavedSignatureKind, number> = { signature: 40, initials: 24 }
const DRAW_THICKNESS = 3
const TYPED_FONT = { fontFamily: '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive', fontStyle: 'italic', fontWeight: '400' }
const MAX_IMAGE_SIDE = 900

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing #${id}`)
  return found as T
}

async function bitmapFromDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const blob = await (await fetch(dataUrl)).blob()
  return createImageBitmap(blob)
}

/** Downscale an uploaded image and keep it as a PNG data URL (what main stores). */
async function imageFileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')!
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  let dataUrl = canvas.toDataURL('image/png')
  if (dataUrl.length > MAX_SIGNATURE_IMAGE_CHARS) dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return dataUrl
}

function drawPreview(canvas: HTMLCanvasElement, source: SavedSignatureSource): void {
  const context = canvas.getContext('2d')!
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = '#111'
  context.fillStyle = '#111'
  if (source.type === 'draw') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const { points } of source.curves) {
      for (let index = 0; index < points.length; index += 2) {
        minX = Math.min(minX, points[index]!); maxX = Math.max(maxX, points[index]!)
        minY = Math.min(minY, points[index + 1]!); maxY = Math.max(maxY, points[index + 1]!)
      }
    }
    const pad = 4
    const scale = Math.min((canvas.width - pad * 2) / Math.max(1, maxX - minX), (canvas.height - pad * 2) / Math.max(1, maxY - minY))
    const offsetX = (canvas.width - (maxX - minX) * scale) / 2
    const offsetY = (canvas.height - (maxY - minY) * scale) / 2
    context.lineWidth = Math.max(1, source.thickness * scale * 0.8)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    for (const { points } of source.curves) {
      context.beginPath()
      context.moveTo(offsetX + (points[0]! - minX) * scale, offsetY + (points[1]! - minY) * scale)
      for (let index = 2; index < points.length; index += 2) context.lineTo(offsetX + (points[index]! - minX) * scale, offsetY + (points[index + 1]! - minY) * scale)
      if (points.length === 2) context.lineTo(offsetX + (points[0]! - minX) * scale + 0.5, offsetY + (points[1]! - minY) * scale)
      context.stroke()
    }
  } else if (source.type === 'text') {
    let size = canvas.height * 0.6
    context.font = `${TYPED_FONT.fontStyle} ${TYPED_FONT.fontWeight} ${size}px ${TYPED_FONT.fontFamily}`
    const width = context.measureText(source.text).width
    if (width > canvas.width - 8) {
      size *= (canvas.width - 8) / width
      context.font = `${TYPED_FONT.fontStyle} ${TYPED_FONT.fontWeight} ${size}px ${TYPED_FONT.fontFamily}`
    }
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(source.text, canvas.width / 2, canvas.height / 2)
  } else {
    void bitmapFromDataUrl(source.dataUrl).then((bitmap) => {
      const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height)
      const width = bitmap.width * scale
      const height = bitmap.height * scale
      context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
      bitmap.close()
    }).catch(() => undefined)
  }
}

export class SavedSignatureManager {
  readonly #bridge: SurffishPdfBridge
  readonly #dialog = element<HTMLDialogElement>('signatureDialog')
  readonly #pad = element<HTMLCanvasElement>('signaturePad')
  readonly #text = element<HTMLInputElement>('signatureText')
  readonly #description = element<HTMLInputElement>('signatureDescription')
  readonly #remember = element<HTMLInputElement>('signatureRemember')
  readonly #savedSection = element<HTMLElement>('savedSignatures')
  readonly #savedList = element<HTMLUListElement>('savedSignatureList')
  readonly #storageNote = element<HTMLElement>('signatureStorageNote')
  readonly #imageInput = element<HTMLInputElement>('signatureImage')
  readonly #imagePreview = element<HTMLImageElement>('signatureImagePreview')
  readonly #error = element<HTMLElement>('signatureError')
  readonly #context = this.#pad.getContext('2d')!
  #curves: { points: number[] }[] = []
  #drawing: number[] | null = null
  #tab: 'draw' | 'type' | 'image' = 'draw'
  #kind: SavedSignatureKind = 'signature'
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
    element('signatureClear').addEventListener('click', () => this.#clear())
    element('signatureCancel').addEventListener('click', () => this.#dialog.close('cancel'))
    element<HTMLFormElement>('signatureForm').addEventListener('submit', (event) => {
      event.preventDefault()
      void this.#commit()
    })
    this.#dialog.addEventListener('close', () => {
      // Cancelled: drop the empty placeholder editor pdf.js created for the signature.
      if (this.#editor) this.#editor.remove()
      this.#editor = null
      const placement = this.#placement
      this.#placement = null
      placement?.onCancelled()
    })
    this.#imageInput.addEventListener('change', () => {
      const file = this.#imageInput.files?.[0]
      if (!file) return
      void imageFileToDataUrl(file).then((dataUrl) => {
        this.#imageDataUrl = dataUrl
        this.#imagePreview.src = dataUrl
        this.#imagePreview.hidden = false
        this.#error.hidden = true
      }, () => this.#showError('That image could not be read.'))
    })
    this.#pad.addEventListener('pointerdown', (event) => {
      try { this.#pad.setPointerCapture(event.pointerId) } catch { /* synthetic or already released pointer */ }
      this.#drawing = this.#point(event)
      this.#curves.push({ points: this.#drawing })
    })
    this.#pad.addEventListener('pointermove', (event) => {
      if (!this.#drawing) return
      this.#drawing.push(...this.#point(event))
      this.#paint()
    })
    const stop = (): void => { this.#drawing = null }
    this.#pad.addEventListener('pointerup', stop)
    this.#pad.addEventListener('pointercancel', stop)
  }

  /** The next signature goes into a form field: forms.ts sizes and positions it. */
  setPlacement(placement: SignaturePlacement | null, kind: SavedSignatureKind = 'signature'): void {
    this.#placement = placement
    this.#kind = kind
  }

  #point(event: PointerEvent): number[] {
    const rect = this.#pad.getBoundingClientRect()
    return [
      ((event.clientX - rect.left) / rect.width) * this.#pad.width,
      ((event.clientY - rect.top) / rect.height) * this.#pad.height
    ]
  }

  #paint(): void {
    const context = this.#context
    context.clearRect(0, 0, this.#pad.width, this.#pad.height)
    context.lineWidth = DRAW_THICKNESS
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = '#111'
    for (const { points } of this.#curves) {
      context.beginPath()
      context.moveTo(points[0]!, points[1]!)
      for (let index = 2; index < points.length; index += 2) context.lineTo(points[index]!, points[index + 1]!)
      if (points.length === 2) context.lineTo(points[0]! + 0.1, points[1]!)
      context.stroke()
    }
  }

  #clear(): void {
    this.#curves = []
    this.#drawing = null
    this.#paint()
  }

  #showError(text: string): void {
    this.#error.textContent = text
    this.#error.hidden = false
  }

  #selectTab(tab: 'draw' | 'type' | 'image'): void {
    this.#tab = tab
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-signature-tab]')) {
      button.setAttribute('aria-selected', String(button.dataset.signatureTab === tab))
    }
    for (const pane of document.querySelectorAll<HTMLElement>('[data-signature-pane]')) pane.hidden = pane.dataset.signaturePane !== tab
    if (tab === 'type') this.#text.focus()
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
      drawPreview(preview, entry.source)
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
    if (source.type === 'draw') return editor.getDrawnSignature({ curves: source.curves, width: source.width, height: source.height, thickness: source.thickness })
    if (source.type === 'text') return editor.getFromText(source.text, TYPED_FONT)
    const bitmap = await bitmapFromDataUrl(source.dataUrl)
    try {
      return editor.getFromImage(bitmap)
    } finally {
      bitmap.close()
    }
  }

  #place(editor: SignatureEditorLike, data: unknown, description: string, kind: SavedSignatureKind): void {
    this.#editor = null
    editor.addSignature(data, HEIGHT_IN_PAGE[kind], description, null)
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
    this.#place(editor, data, entry.description, entry.kind)
    this.#dialog.close('added')
  }

  #currentSource(): SavedSignatureSource | null {
    if (this.#tab === 'draw') {
      return this.#curves.length === 0 ? null : { type: 'draw', curves: this.#curves.map(({ points }) => ({ points: [...points] })), width: this.#pad.width, height: this.#pad.height, thickness: DRAW_THICKNESS }
    }
    if (this.#tab === 'type') {
      const text = this.#text.value.trim()
      return text ? { type: 'text', text } : null
    }
    return this.#imageDataUrl ? { type: 'image', dataUrl: this.#imageDataUrl } : null
  }

  async #commit(): Promise<void> {
    const editor = this.#editor
    if (!editor) return
    const source = this.#currentSource()
    if (!source) {
      this.#showError(this.#tab === 'draw' ? 'Draw on the pad first.' : this.#tab === 'type' ? 'Type something first.' : 'Choose an image first.')
      return
    }
    const kind = this.#kind
    const description = this.#description.value.trim() || (kind === 'initials' ? 'Initials' : 'Signature')
    const data = await this.#dataFor(editor, source).catch(() => null)
    if (!data) {
      this.#showError('That signature could not be read.')
      return
    }
    if (this.#remember.checked) {
      const entry: NewSavedSignature = { kind, description, source }
      void this.#bridge.signatures.add(entry).then((result) => this.#apply(result), (error: unknown) => console.warn('[pdf editor] could not save the signature', error))
    }
    this.#place(editor, data, description, kind)
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
