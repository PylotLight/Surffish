// A minimal signature manager for pdf.js's SignatureEditor (the full one ships only with Mozilla's
// viewer app). Draw or type a signature; nothing is stored between sessions.

interface SignatureCurves {
  curves: { points: number[] }[]
  width: number
  height: number
  thickness: number
}

/** The parts of pdf.js's SignatureEditor this manager drives. */
interface SignatureEditorLike {
  getDrawnSignature(curves: SignatureCurves): unknown
  getFromText(text: string, font: { fontFamily: string; fontStyle: string; fontWeight: string }): unknown
  addSignature(data: unknown, heightInPage: number, description: string, uuid: string | null): void
  remove(): void
}

const HEIGHT_IN_PAGE = 40
const DRAW_THICKNESS = 3
const TYPED_FONT = { fontFamily: '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive', fontStyle: 'italic', fontWeight: '400' }

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing #${id}`)
  return found as T
}

export class SimpleSignatureManager {
  readonly #dialog = element<HTMLDialogElement>('signatureDialog')
  readonly #pad = element<HTMLCanvasElement>('signaturePad')
  readonly #text = element<HTMLInputElement>('signatureText')
  readonly #description = element<HTMLInputElement>('signatureDescription')
  readonly #context = this.#pad.getContext('2d')!
  #curves: { points: number[] }[] = []
  #drawing: number[] | null = null
  #tab: 'draw' | 'type' = 'draw'
  #editor: SignatureEditorLike | null = null

  constructor() {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-signature-tab]')) {
      button.addEventListener('click', () => this.#selectTab(button.dataset.signatureTab === 'type' ? 'type' : 'draw'))
    }
    element('signatureClear').addEventListener('click', () => this.#clear())
    element('signatureCancel').addEventListener('click', () => this.#dialog.close('cancel'))
    element<HTMLFormElement>('signatureForm').addEventListener('submit', (event) => {
      event.preventDefault()
      if (this.#commit()) this.#dialog.close('added')
    })
    this.#dialog.addEventListener('close', () => {
      // Cancelled: drop the empty placeholder editor pdf.js created for the signature.
      if (this.#editor) this.#editor.remove()
      this.#editor = null
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

  #selectTab(tab: 'draw' | 'type'): void {
    this.#tab = tab
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-signature-tab]')) {
      button.setAttribute('aria-selected', String(button.dataset.signatureTab === tab))
    }
    for (const pane of document.querySelectorAll<HTMLElement>('[data-signature-pane]')) pane.hidden = pane.dataset.signaturePane !== tab
    if (tab === 'type') this.#text.focus()
  }

  #commit(): boolean {
    const editor = this.#editor
    if (!editor) return false
    const description = this.#description.value.trim() || 'Signature'
    let data: unknown = null
    if (this.#tab === 'draw') {
      if (this.#curves.length === 0) return false
      data = editor.getDrawnSignature({ curves: this.#curves, width: this.#pad.width, height: this.#pad.height, thickness: DRAW_THICKNESS })
    } else {
      const text = this.#text.value.trim()
      if (!text) return false
      data = editor.getFromText(text, TYPED_FONT)
    }
    if (!data) return false
    this.#editor = null
    editor.addSignature(data, HEIGHT_IN_PAGE, description, null)
    return true
  }

  // --- pdf.js SignatureManager interface ---

  getSignature({ editor }: { editor: SignatureEditorLike }): void {
    if (this.#editor && this.#editor !== editor) this.#editor.remove()
    this.#editor = editor
    this.#clear()
    this.#text.value = ''
    this.#description.value = 'Signature'
    this.#selectTab('draw')
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
