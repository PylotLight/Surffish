// AcroForm extras on top of pdf.js's annotation layer: what Acrobat / Preview do that pdf.js's
// generic viewer components leave to the app. Signature fields you can click to sign, Reset form,
// required-field highlighting, row/column tab order (/Tabs) and Tab across pages, editable combo
// boxes, Flatten on save and an XFA notice. Field formatting / validation / calculation scripts run
// in pdf.js's QuickJS sandbox (wired up in main.ts).
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { EventBus, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { AnnotationFlags, drawObject, PDFDict, PDFDocument, PDFName, popGraphicsState, pushGraphicsState, translate, type PDFField, type PDFPage, type PDFRef, type PDFWidgetAnnotation } from 'pdf-lib'
import type { SavedSignatureManager, SignatureEditorLike } from './signature'

/** The fields of pdf.js's widget annotation data this module reads. */
interface WidgetData {
  id: string
  annotationType: number
  fieldType?: string
  fieldName?: string
  fieldFlags?: number
  fieldValue?: unknown
  defaultFieldValue?: unknown
  exportValue?: string
  buttonValue?: string
  rect: number[]
  required?: boolean
  readOnly?: boolean
  hidden?: boolean
  combo?: boolean
  checkBox?: boolean
  radioButton?: boolean
  options?: { exportValue: string; displayValue: string }[]
}

interface FieldObject {
  id: string
  type: string
  defaultValue?: unknown
  exportValues?: unknown
  kidIds?: string[]
}

type PageView = {
  id: number
  div: HTMLDivElement
  pdfPage: PDFPageProxy | null
  viewport: { rotation: number }
  annotationLayer?: { div?: HTMLDivElement | null } | null
  annotationEditorLayer?: { annotationEditorLayer?: { addNewEditor(data?: object): void } | null } | null
}

type EditorGeometry = SignatureEditorLike & {
  x: number
  y: number
  width: number
  height: number
  div?: HTMLElement | null
  setDims?(): void
  fixAndSetPosition?(): void
  _onResized?(): void
  _onTranslated?(): void
  onScaleChanging?(): void
}

const WIDGET = 20
const FLAG_EDIT = 0x40000
const FORM_CONTROLS = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), .signatureFieldOverlay'
/** pdf-lib parses the whole file for /Tabs; skip that for huge documents. */
const MAX_TAB_ORDER_PARSE_BYTES = 40 * 1024 * 1024

interface FormHost {
  viewer: PDFViewer
  eventBus: EventBus
  signatures: SavedSignatureManager
  /** Switch the editor tool; resolves once pdf.js is in the new mode. */
  switchTool(tool: 'none' | 'signature'): Promise<void>
  showMessage(text: string, kind?: 'info' | 'error', timeout?: number): void
}

export class FormSupport {
  readonly #host: FormHost
  #document: PDFDocumentProxy | null = null
  #fieldObjects: FieldObject[][] | null = null
  #annotations = new Map<number, Promise<WidgetData[]>>()
  #tabOrder = new Map<number, string>()
  #pagesWithFields = new Set<number>()
  #signed = new Map<string, EditorGeometry>()
  #pendingFocus: { pageIndex: number; last: boolean } | null = null
  readonly #formTools = document.getElementById('formTools') as HTMLElement
  readonly #flatten = document.getElementById('flattenOnSave') as HTMLInputElement
  readonly #notice = document.getElementById('formNotice') as HTMLElement

  constructor(host: FormHost) {
    this.#host = host
    host.eventBus.on('annotationlayerrendered', ({ source }: { source: PageView }) => { void this.#decoratePage(source) })
    host.eventBus.on('annotationeditorlayerrendered', () => this.#refreshSignedFields())
    host.eventBus.on('editingstateschanged', () => this.#refreshSignedFields())
    document.getElementById('resetForm')?.addEventListener('click', () => this.reset())
    const container = host.viewer.container
    container.addEventListener('keydown', (event) => this.#onKeydown(event), true)
    container.addEventListener('input', (event) => this.#clearRequiredMark(event.target))
    container.addEventListener('change', (event) => this.#clearRequiredMark(event.target))
  }

  get flattenOnSave(): boolean {
    return this.#flatten.checked
  }

  get hasForm(): boolean {
    return this.#fieldObjects !== null
  }

  async setDocument(document_: PDFDocumentProxy, bytes: Uint8Array): Promise<void> {
    this.#document = document_
    this.#annotations.clear()
    this.#tabOrder.clear()
    this.#pagesWithFields.clear()
    this.#signed.clear()
    this.#notice.hidden = true
    const [objects, metadata] = await Promise.all([
      document_.getFieldObjects().catch(() => null) as Promise<Map<string, FieldObject[]> | Record<string, FieldObject[]> | null>,
      document_.getMetadata().catch(() => null)
    ])
    if (document_ !== this.#document) return
    // A Map in pdfjs-dist 6 (a plain object in older builds).
    const fieldLists = objects instanceof Map ? [...objects.values()] : objects ? Object.values(objects) : []
    this.#fieldObjects = fieldLists.length > 0 ? fieldLists : null
    for (const fields of this.#fieldObjects ?? []) {
      for (const field of fields) {
        const page = (field as { page?: unknown }).page
        if (typeof page === 'number' && page >= 0) this.#pagesWithFields.add(page)
      }
    }
    this.#formTools.hidden = !this.#fieldObjects
    const info = (metadata?.info ?? {}) as { IsXFAPresent?: boolean }
    const pureXfa = (document_ as unknown as { isPureXfa?: boolean }).isPureXfa === true
    if (pureXfa) {
      this.#showNotice('This is an XFA form. Its fields can be filled and saved, but signing fields, Reset form and the page tools may not work with it. For full support open it in Adobe Acrobat.')
    } else if (info.IsXFAPresent && !this.#fieldObjects) {
      this.#showNotice('This PDF contains an XFA form that can’t be shown here. Open it in Adobe Acrobat to fill it in.')
    }
    if (this.#fieldObjects && bytes.byteLength <= MAX_TAB_ORDER_PARSE_BYTES) {
      // /Tabs isn't exposed by pdf.js; read it (and only it) with pdf-lib.
      void PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }).then((parsed) => {
        if (document_ !== this.#document) return
        parsed.getPages().forEach((page, index) => {
          const tabs = page.node.get(PDFName.of('Tabs'))
          if (tabs instanceof PDFName) this.#tabOrder.set(index, tabs.decodeText())
        })
        // Pages already on screen: apply the order now.
        for (let index = 0; index < document_.numPages; index += 1) {
          const view = this.#host.viewer.getPageView(index) as PageView | undefined
          if (view?.annotationLayer?.div) void this.#sortTabOrder(view)
        }
      }).catch(() => undefined)
    }
  }

  #showNotice(text: string): void {
    this.#notice.textContent = text
    this.#notice.hidden = false
    window.setTimeout(() => { this.#notice.hidden = true }, 12_000)
  }

  #widgets(pageIndex: number): Promise<WidgetData[]> {
    const document_ = this.#document
    if (!document_) return Promise.resolve([])
    let pending = this.#annotations.get(pageIndex)
    if (!pending) {
      pending = document_.getPage(pageIndex + 1)
        .then((page) => page.getAnnotations({ intent: 'display' }))
        .then((annotations) => (annotations as WidgetData[]).filter((annotation) => annotation.annotationType === WIDGET))
        .catch(() => [])
      this.#annotations.set(pageIndex, pending)
    }
    return pending
  }

  // --- Per page decoration ---------------------------------------------------------------------

  async #decoratePage(view: PageView): Promise<void> {
    const pageIndex = view.id - 1
    const widgets = await this.#widgets(pageIndex)
    if (!view.annotationLayer?.div) return
    if (widgets.length > 0) this.#pagesWithFields.add(pageIndex)
    this.#addSignatureOverlays(view, widgets)
    this.#makeCombosEditable(view, widgets)
    await this.#sortTabOrder(view)
    if (this.#pendingFocus?.pageIndex === pageIndex) {
      const { last } = this.#pendingFocus
      this.#pendingFocus = null
      const controls = this.#controls(view.div)
      ;(last ? controls[controls.length - 1] : controls[0])?.focus()
    }
  }

  #addSignatureOverlays(view: PageView, widgets: WidgetData[]): void {
    for (const old of view.div.querySelectorAll('.signatureFieldOverlay')) old.remove()
    const page = view.pdfPage
    if (!page) return
    const viewport = page.getViewport({ scale: 1, rotation: view.viewport.rotation })
    for (const widget of widgets) {
      if (widget.fieldType !== 'Sig' || widget.hidden || widget.readOnly) continue
      const [r0, r1, r2, r3] = widget.rect as [number, number, number, number]
      const [x1, y1] = viewport.convertToViewportPoint(r0, r1) as [number, number]
      const [x2, y2] = viewport.convertToViewportPoint(r2, r3) as [number, number]
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'signatureFieldOverlay'
      button.dataset.fieldId = widget.id
      const initials = /initial/i.test(widget.fieldName ?? '')
      button.textContent = initials ? 'Initial here' : 'Sign here'
      button.title = `${initials ? 'Initial' : 'Sign'}: ${widget.fieldName ?? 'signature field'}`
      button.setAttribute('aria-label', button.title)
      button.style.left = `${(Math.min(x1, x2) / viewport.width) * 100}%`
      button.style.top = `${(Math.min(y1, y2) / viewport.height) * 100}%`
      button.style.width = `${(Math.abs(x2 - x1) / viewport.width) * 100}%`
      button.style.height = `${(Math.abs(y2 - y1) / viewport.height) * 100}%`
      button.classList.toggle('is-signed', this.#isSigned(widget.id))
      button.addEventListener('click', () => { void this.#signField(view.id - 1, widget, initials) })
      view.div.append(button)
    }
  }

  #isSigned(id: string): boolean {
    const editor = this.#signed.get(id)
    if (!editor) return false
    const state = editor as unknown as { deleted?: boolean; isEmpty?: () => boolean }
    if (state.deleted === true || state.isEmpty?.() === true || (editor.div && !editor.div.isConnected)) {
      this.#signed.delete(id)
      return false
    }
    return true
  }

  #refreshSignedFields(): void {
    for (const overlay of document.querySelectorAll<HTMLElement>('.signatureFieldOverlay')) {
      overlay.classList.toggle('is-signed', this.#isSigned(overlay.dataset.fieldId ?? ''))
    }
  }

  async #signField(pageIndex: number, widget: WidgetData, initials: boolean): Promise<void> {
    const host = this.#host
    host.signatures.setPlacement({
      onPlaced: (editor) => {
        const placed = editor as EditorGeometry
        this.#fitToField(placed, pageIndex, widget)
        this.#signed.set(widget.id, placed)
        this.#refreshSignedFields()
        void host.switchTool('none')
      },
      onCancelled: () => { void host.switchTool('none') }
    }, initials ? 'initials' : 'signature')
    await host.switchTool('signature')
    const layer = (host.viewer.getPageView(pageIndex) as PageView | undefined)?.annotationEditorLayer?.annotationEditorLayer
    if (!layer) {
      host.signatures.setPlacement(null)
      host.showMessage('Could not open the signature field.', 'error')
      return
    }
    layer.addNewEditor()
  }

  /** Scale the placed signature to fit the field (keeping its aspect ratio) and centre it there. */
  #fitToField(editor: EditorGeometry, pageIndex: number, widget: WidgetData): void {
    const view = this.#host.viewer.getPageView(pageIndex) as PageView | undefined
    const page = view?.pdfPage
    if (!page || view.viewport.rotation % 360 !== 0) return
    const [vx0, , vx1, vy1] = page.view as [number, number, number, number]
    const pageWidth = vx1 - vx0
    const pageHeight = vy1 - (page.view[1] ?? 0)
    const [r0, r1, r2, r3] = widget.rect as [number, number, number, number]
    const fieldWidth = Math.abs(r2 - r0)
    const fieldHeight = Math.abs(r3 - r1)
    if (!(fieldWidth > 2 && fieldHeight > 2 && editor.width > 0 && editor.height > 0)) return
    const aspect = (editor.width * pageWidth) / (editor.height * pageHeight)
    let height = fieldHeight * 0.9
    let width = height * aspect
    if (width > fieldWidth * 0.96) {
      width = fieldWidth * 0.96
      height = width / aspect
    }
    editor.width = width / pageWidth
    editor.height = height / pageHeight
    editor.setDims?.()
    editor._onResized?.()
    editor.x = (Math.min(r0, r2) - vx0 + (fieldWidth - width) / 2) / pageWidth
    editor.y = (vy1 - Math.max(r1, r3) + (fieldHeight - height) / 2) / pageHeight
    editor.fixAndSetPosition?.()
    editor._onTranslated?.()
    editor.onScaleChanging?.()
  }

  #makeCombosEditable(view: PageView, widgets: WidgetData[]): void {
    const storage = this.#document?.annotationStorage
    if (!storage) return
    for (const widget of widgets) {
      if (widget.fieldType !== 'Ch' || !widget.combo || !((widget.fieldFlags ?? 0) & FLAG_EDIT) || widget.readOnly) continue
      const select = view.div.querySelector<HTMLSelectElement>(`select[data-element-id="${CSS.escape(widget.id)}"]`)
      if (!select || select.parentElement?.querySelector('.surffish-combo-edit')) continue
      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'surffish-combo-edit'
      input.name = select.name
      input.setAttribute('aria-label', `${widget.fieldName ?? 'Field'} (type or pick)`)
      const list = document.createElement('datalist')
      list.id = `combo-${widget.id}`
      for (const option of widget.options ?? []) {
        const entry = document.createElement('option')
        entry.value = option.displayValue
        list.append(entry)
      }
      input.setAttribute('list', list.id)
      const display = (value: unknown): string => {
        const text = typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
        return widget.options?.find((option) => option.exportValue === text)?.displayValue ?? text
      }
      input.value = display((storage.getValue(widget.id, { value: widget.fieldValue }) as { value?: unknown }).value)
      input.style.fontSize = select.style.fontSize
      input.addEventListener('change', () => {
        const typed = input.value
        const match = widget.options?.find((option) => option.displayValue === typed || option.exportValue === typed)
        const value = match?.exportValue ?? typed
        storage.setValue(widget.id, { value, formattedValue: null })
        for (const option of select.options) option.selected = option.value === value
      })
      select.addEventListener('change', () => { input.value = display(select.value) })
      select.addEventListener('resetform', () => { input.value = display(widget.defaultFieldValue) })
      select.tabIndex = -1
      select.parentElement?.append(input, list)
    }
  }

  async #sortTabOrder(view: PageView): Promise<void> {
    const order = this.#tabOrder.get(view.id - 1)
    const layer = view.annotationLayer?.div
    if (!layer || (order !== 'R' && order !== 'C')) return
    const widgets = await this.#widgets(view.id - 1)
    const rects = new Map(widgets.map((widget) => [widget.id, widget.rect]))
    const sections = [...layer.children].filter((child): child is HTMLElement => child instanceof HTMLElement && rects.has(child.dataset.annotationId ?? ''))
    const key = (section: HTMLElement): [number, number] => {
      const rect = rects.get(section.dataset.annotationId ?? '') ?? [0, 0, 0, 0]
      const top = -Math.max(rect[1]!, rect[3]!)
      const left = Math.min(rect[0]!, rect[2]!)
      return order === 'R' ? [Math.round(top / 4), left] : [Math.round(left / 4), top]
    }
    const sorted = [...sections].sort((a, b) => {
      const [a0, a1] = key(a)
      const [b0, b1] = key(b)
      return a0 - b0 || a1 - b1
    })
    if (sorted.every((section, index) => section === sections[index])) return
    for (const section of sorted) layer.append(section)
  }

  // --- Tab across pages ----------------------------------------------------------------------

  #controls(root: ParentNode): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(FORM_CONTROLS)].filter((element) => element.tabIndex >= 0 && !element.closest('[hidden]') && !element.classList.contains('is-signed'))
  }

  #onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target as HTMLElement | null
    const pageDiv = target?.closest<HTMLElement>('.page[data-page-number]')
    if (!target || !pageDiv || !target.matches(FORM_CONTROLS)) return
    const controls = this.#controls(pageDiv)
    const index = controls.indexOf(target)
    const atEdge = event.shiftKey ? index === 0 : index === controls.length - 1
    if (index < 0 || !atEdge || !this.#document) return
    const pageIndex = Number(pageDiv.dataset.pageNumber) - 1
    const step = event.shiftKey ? -1 : 1
    let next = pageIndex + step
    while (next >= 0 && next < this.#document.numPages && !this.#pagesWithFields.has(next)) next += step
    if (next < 0 || next >= this.#document.numPages) return
    event.preventDefault()
    const view = this.#host.viewer.getPageView(next) as PageView | undefined
    const ready = view?.annotationLayer?.div ? this.#controls(view.div) : []
    this.#host.viewer.scrollPageIntoView({ pageNumber: next + 1 })
    if (ready.length > 0) (event.shiftKey ? ready[ready.length - 1] : ready[0])?.focus()
    else this.#pendingFocus = { pageIndex: next, last: event.shiftKey }
  }

  // --- Reset / required / flatten --------------------------------------------------------------

  /** Reset form: every field back to its default value (as a ResetForm action would). */
  reset(): void {
    const document_ = this.#document
    if (!document_ || !this.#fieldObjects) return
    const storage = document_.annotationStorage
    const ids: string[] = []
    for (const fields of this.#fieldObjects) {
      for (const field of fields) {
        if (!field.id || field.kidIds) continue
        let value: unknown
        if (field.type === 'text' || field.type === 'combobox' || field.type === 'listbox') value = field.defaultValue || ''
        else if (field.type === 'checkbox' || field.type === 'radiobutton') value = field.defaultValue === field.exportValues
        else continue
        ids.push(field.id)
        storage.setValue(field.id, { value, formattedValue: null })
        for (const element of document.querySelectorAll(`[data-element-id="${CSS.escape(field.id)}"]`)) element.dispatchEvent(new Event('resetform'))
      }
    }
    this.#host.eventBus.dispatch('dispatcheventinsandbox', { source: window, detail: { id: 'app', ids, name: 'ResetForm' } })
    document.body.classList.remove('show-required')
    this.#host.showMessage('Form reset')
  }

  /** Required fields that are still empty (on any page), highlighted where they are on screen. */
  async markEmptyRequired(): Promise<number> {
    const document_ = this.#document
    if (!document_ || !this.#fieldObjects) return 0
    const storage = document_.annotationStorage
    const pages = [...this.#pagesWithFields].filter((index) => index < document_.numPages)
    const widgets = (await Promise.all(pages.map((index) => this.#widgets(index)))).flat()
    const groups = new Map<string, { empty: boolean; ids: string[] }>()
    for (const widget of widgets) {
      if (!widget.required || widget.readOnly || widget.hidden || widget.fieldType === 'Sig' || (widget.fieldType === 'Btn' && !widget.checkBox && !widget.radioButton)) continue
      const stored = (storage.getValue(widget.id, { value: undefined }) as { value?: unknown }).value
      let filled: boolean
      if (widget.checkBox || widget.radioButton) {
        const initial = widget.fieldValue === (widget.radioButton ? widget.buttonValue : widget.exportValue)
        filled = stored === undefined ? initial : stored === true || (typeof stored === 'string' && stored !== 'Off' && stored !== '')
      } else {
        const value = stored === undefined ? widget.fieldValue : stored
        filled = Array.isArray(value) ? value.some((item) => item !== '') : typeof value === 'string' ? value.trim() !== '' : Boolean(value)
      }
      const key = widget.fieldName ?? widget.id
      const group = groups.get(key) ?? { empty: true, ids: [] }
      group.empty &&= !filled
      group.ids.push(widget.id)
      groups.set(key, group)
    }
    let empty = 0
    for (const element of document.querySelectorAll('.is-empty-required')) element.classList.remove('is-empty-required')
    for (const group of groups.values()) {
      if (!group.empty) continue
      empty += 1
      for (const id of group.ids) for (const element of document.querySelectorAll(`[data-element-id="${CSS.escape(id)}"]`)) element.classList.add('is-empty-required')
    }
    document.body.classList.toggle('show-required', empty > 0)
    return empty
  }

  #clearRequiredMark(target: EventTarget | null): void {
    if (!(target instanceof HTMLElement)) return
    target.classList.remove('is-empty-required')
    const name = target.getAttribute('name')
    if (name) for (const element of document.querySelectorAll(`.is-empty-required[name="${CSS.escape(name)}"]`)) element.classList.remove('is-empty-required')
  }
}

/** Flatten on save: draw every field's appearance into its page and drop the form (pdf-lib). */
export async function flattenForm(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const document_ = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const form = document_.getForm()
  // pdf-lib's form.flatten() throws on the first widget without an appearance (an unsigned signature
  // field, say) and regenerating appearances with its Helvetica would lose non-Latin text. pdf.js has
  // already written appearances for the filled values, so draw those, skip widgets with none.
  const internals = form as unknown as {
    findWidgetPage(widget: PDFWidgetAnnotation): PDFPage
    findWidgetAppearanceRef(field: PDFField, widget: PDFWidgetAnnotation): PDFRef
  }
  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      try {
        if (widget.hasFlag(AnnotationFlags.Hidden)) continue
        const page = internals.findWidgetPage(widget)
        const appearance = internals.findWidgetAppearanceRef(field, widget)
        const name = page.node.newXObject('FlatWidget', appearance)
        const { x, y } = widget.getRectangle()
        page.pushOperators(pushGraphicsState(), translate(x, y), drawObject(name), popGraphicsState())
      } catch {
        // No appearance to draw (empty signature field, odd widget): it just goes away.
      }
    }
  }
  // form.removeField() trips over the same missing appearances, so drop the widgets and the form here.
  for (const page of document_.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    for (let index = annots.size() - 1; index >= 0; index -= 1) {
      const annot = annots.lookup(index)
      if (annot instanceof PDFDict && annot.get(PDFName.of('Subtype')) === PDFName.of('Widget')) annots.remove(index)
    }
  }
  document_.catalog.delete(PDFName.of('AcroForm'))
  return new Uint8Array(await document_.save({ useObjectStreams: false }))
}
