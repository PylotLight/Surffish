import {
  degrees,
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFString,
  PDFTextField,
  type PDFField,
  type PDFForm
} from 'pdf-lib'

// "Add field" tools for the PDF editor: create, change, move and delete AcroForm fields with pdf-lib.
// The editor bakes pending edits into bytes (pdf.js saveDocument()), runs one op here and reopens the
// result, so new fields are fillable straight away and every op is undoable by restoring bytes.
// Rects are [x1, y1, x2, y2] in the page's default user space (what pdf.js reports as a widget rect).

export type FieldKind = 'text' | 'multiline' | 'checkbox' | 'radio' | 'dropdown' | 'date' | 'signature'
export type FieldRect = [number, number, number, number]
export const DATE_FORMATS = ['dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]
/** pdf.js's auto-size (font size 0) path mis-measures text, so new fields always get a fixed size. */
export const DEFAULT_FONT_SIZE = 10
export const MIN_FONT_SIZE = 4
export const MAX_FONT_SIZE = 72

export interface NewField {
  kind: FieldKind
  name: string
  /** 0-based page index. */
  page: number
  rect: FieldRect
  required?: boolean
  readOnly?: boolean
  /** Text/date: initial text. Checkbox: 'on' to start checked. Radio/dropdown: the option to start on. */
  defaultValue?: string
  fontSize?: number
  /** Radio and dropdown choices. */
  options?: string[]
  dateFormat?: DateFormat
}

export interface FieldChanges {
  name?: string
  required?: boolean
  readOnly?: boolean
  defaultValue?: string
  fontSize?: number
  /** Dropdown only (a radio group's buttons are fixed once placed). */
  options?: string[]
  dateFormat?: DateFormat
}

/** A widget annotation by object reference (pdf.js widget ids are "12R", or "12R3" for generation 3). */
export interface WidgetRef { num: number; gen: number }

export type FieldOp =
  | { type: 'add'; field: NewField }
  | { type: 'update'; name: string; changes: FieldChanges }
  | { type: 'move'; widget: WidgetRef; rect: FieldRect }
  | { type: 'delete'; widget: WidgetRef }

export class FieldOpError extends Error {}

const KIND_PREFIX: Record<FieldKind, string> = {
  text: 'Text', multiline: 'Paragraph', checkbox: 'Check', radio: 'Choice', dropdown: 'Dropdown', date: 'Date', signature: 'Signature'
}
/** Size (points) of a field placed with a click rather than a drag. */
export const DEFAULT_FIELD_SIZE: Record<FieldKind, [number, number]> = {
  text: [160, 20], multiline: [220, 60], checkbox: [14, 14], radio: [70, 14], dropdown: [140, 20], date: [90, 20], signature: [180, 44]
}
export const DEFAULT_OPTIONS: Partial<Record<FieldKind, string[]>> = {
  radio: ['Yes', 'No'],
  dropdown: ['Option 1', 'Option 2', 'Option 3']
}
const MIN_SIDE = 6
const FLAG_READ_ONLY = 1
const FLAG_REQUIRED = 2

export function parseWidgetId(id: string): WidgetRef | null {
  const match = /^(\d+)R(\d+)?$/.exec(id)
  return match ? { num: Number(match[1]), gen: Number(match[2] ?? 0) } : null
}

/** First free `<Kind>N` name, e.g. Text1, Text2. */
export function suggestFieldName(kind: FieldKind, existing: Iterable<string>): string {
  const taken = new Set(existing)
  const prefix = KIND_PREFIX[kind]
  for (let index = 1; ; index += 1) {
    const name = `${prefix}${index}`
    if (!taken.has(name) && !nameConflict(name, taken)) return name
  }
}

function nameConflict(name: string, taken: Iterable<string>): string | null {
  for (const other of taken) {
    if (other === name) return `A field called “${name}” already exists.`
    if (other.startsWith(`${name}.`) || name.startsWith(`${other}.`)) return `“${name}” clashes with the field “${other}”.`
  }
  return null
}

export function checkFieldName(name: string, existing: Iterable<string>, current?: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Give the field a name.'
  if (trimmed.length > 120) return 'That name is too long.'
  if (/^\.|\.$|\.\./.test(trimmed)) return 'A field name can’t start or end with a dot, or have two in a row.'
  return nameConflict(trimmed, [...existing].filter((other) => other !== current))
}

export function normalizeOptions(options: readonly string[] | undefined): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const option of options ?? []) {
    const value = option.trim()
    if (value && !seen.has(value)) { seen.add(value); result.push(value) }
  }
  return result
}

export function normalizeRect(rect: readonly number[]): FieldRect {
  const [a = 0, b = 0, c = 0, d = 0] = rect
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]
}

/** Lay a radio group's buttons out inside its rect: a row if it is wider than tall, else a column. */
export function radioButtonRects(rect: FieldRect, count: number): FieldRect[] {
  const [x1, y1, x2, y2] = normalizeRect(rect)
  const width = x2 - x1
  const height = y2 - y1
  const row = width >= height
  const cell = (row ? width : height) / Math.max(count, 1)
  const side = Math.max(MIN_SIDE, Math.min(18, cell * 0.8, row ? height : width))
  return Array.from({ length: count }, (_value, index) => {
    if (row) {
      const x = x1 + index * cell
      const y = y1 + (height - side) / 2
      return [x, y, x + side, y + side]
    }
    const top = y2 - index * cell
    const x = x1
    return [x, top - side, x + side, top]
  })
}

export function checkNewField(field: NewField, existing: Iterable<string>, pageCount: number): string | null {
  if (!Number.isInteger(field.page) || field.page < 0 || field.page >= pageCount) return 'That page does not exist.'
  if (!(field.kind in KIND_PREFIX)) return 'Unknown field type.'
  const [x1, y1, x2, y2] = normalizeRect(field.rect)
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 - x1 < MIN_SIDE || y2 - y1 < MIN_SIDE) return 'The field is too small.'
  const nameProblem = checkFieldName(field.name, existing)
  if (nameProblem) return nameProblem
  if (field.fontSize !== undefined && !(field.fontSize >= MIN_FONT_SIZE && field.fontSize <= MAX_FONT_SIZE)) return `Font size must be between ${MIN_FONT_SIZE} and ${MAX_FONT_SIZE}.`
  if (field.kind === 'radio' || field.kind === 'dropdown') {
    const options = normalizeOptions(field.options)
    if (options.length < (field.kind === 'radio' ? 2 : 1)) return field.kind === 'radio' ? 'A radio group needs at least two choices.' : 'A dropdown needs at least one option.'
    if (field.defaultValue && !options.includes(field.defaultValue)) return 'The default must be one of the options.'
  }
  if (field.kind === 'date' && field.dateFormat && !DATE_FORMATS.includes(field.dateFormat)) return 'Unknown date format.'
  return null
}

function dateActions(document: PDFDocument, format: DateFormat): PDFDict {
  const context = document.context
  const js = (code: string) => context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(code) })
  return context.obj({ F: js(`AFDate_FormatEx("${format}");`), K: js(`AFDate_KeystrokeEx("${format}");`) })
}

/** pdf-lib's createWidget adds the border width to the size and swaps it on rotated pages. */
function placement(rect: FieldRect, rotation: number, borderWidth: number) {
  const [x1, y1, x2, y2] = normalizeRect(rect)
  const width = x2 - x1
  const height = y2 - y1
  const sideways = rotation === 90 || rotation === 270
  return {
    x: x1, y: y1,
    width: Math.max(1, (sideways ? height : width) - borderWidth),
    height: Math.max(1, (sideways ? width : height) - borderWidth),
    rotate: degrees(rotation),
    borderWidth
  }
}

function fixRects(field: PDFField, from: number, rects: FieldRect[]): void {
  const widgets = field.acroField.getWidgets()
  rects.forEach((rect, index) => {
    const widget = widgets[from + index]
    if (!widget) return
    const [x1, y1, x2, y2] = normalizeRect(rect)
    widget.setRectangle({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 })
  })
}

function setDefault(field: PDFField, value: PDFHexString | PDFString | PDFName | null): void {
  if (value) field.acroField.dict.set(PDFName.of('DV'), value)
  else field.acroField.dict.delete(PDFName.of('DV'))
}

function setFlags(field: PDFField, required?: boolean, readOnly?: boolean): void {
  if (required !== undefined) field.acroField.setFlagTo(FLAG_REQUIRED, required)
  if (readOnly !== undefined) field.acroField.setFlagTo(FLAG_READ_ONLY, readOnly)
}

function addField(document: PDFDocument, form: PDFForm, spec: NewField): void {
  const page = document.getPage(spec.page)
  const rotation = ((page.getRotation().angle % 360) + 360) % 360
  const name = spec.name.trim()
  const fontSize = spec.fontSize ?? DEFAULT_FONT_SIZE
  const rect = normalizeRect(spec.rect)
  const font = form.getDefaultFont()
  switch (spec.kind) {
    case 'text':
    case 'multiline':
    case 'date': {
      const field = form.createTextField(name)
      if (spec.kind === 'multiline') field.enableMultiline()
      field.addToPage(page, { ...placement(rect, rotation, 1), font })
      fixRects(field, 0, [rect])
      field.setFontSize(fontSize)
      if (spec.kind === 'date') field.acroField.dict.set(PDFName.of('AA'), dateActions(document, spec.dateFormat ?? 'dd/mm/yyyy'))
      if (spec.defaultValue) {
        field.setText(spec.defaultValue)
        setDefault(field, PDFHexString.fromText(spec.defaultValue))
      }
      setFlags(field, spec.required, spec.readOnly)
      return
    }
    case 'checkbox': {
      const field = form.createCheckBox(name)
      field.addToPage(page, placement(rect, rotation, 1))
      fixRects(field, 0, [rect])
      if (spec.defaultValue === 'on') {
        field.check()
        setDefault(field, field.acroField.dict.get(PDFName.of('V')) as PDFName)
      }
      setFlags(field, spec.required, spec.readOnly)
      return
    }
    case 'radio': {
      const options = normalizeOptions(spec.options)
      const field = form.createRadioGroup(name)
      const rects = radioButtonRects(rect, options.length)
      options.forEach((option, index) => field.addOptionToPage(option, page, placement(rects[index]!, rotation, 1)))
      fixRects(field, 0, rects)
      if (spec.defaultValue) {
        field.select(spec.defaultValue)
        setDefault(field, field.acroField.dict.get(PDFName.of('V')) as PDFName)
      }
      setFlags(field, spec.required, spec.readOnly)
      return
    }
    case 'dropdown': {
      const field = form.createDropdown(name)
      field.addOptions(normalizeOptions(spec.options))
      field.addToPage(page, { ...placement(rect, rotation, 1), font })
      fixRects(field, 0, [rect])
      field.setFontSize(fontSize)
      if (spec.defaultValue) {
        field.select(spec.defaultValue)
        setDefault(field, PDFHexString.fromText(spec.defaultValue))
      }
      setFlags(field, spec.required, spec.readOnly)
      return
    }
    case 'signature': {
      // pdf-lib has no creator for signature fields: an unsigned /Sig field is a merged field+widget.
      const context = document.context
      const [x1, y1, x2, y2] = rect
      let flags = 0
      if (spec.required) flags |= FLAG_REQUIRED
      if (spec.readOnly) flags |= FLAG_READ_ONLY
      const dict = context.obj({
        Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFHexString.fromText(name), Rect: [x1, y1, x2, y2], F: 4, P: page.ref,
        MK: context.obj({ BC: [0, 0, 0], ...(rotation ? { R: rotation } : {}) }),
        ...(flags ? { Ff: flags } : {})
      })
      const ref = context.register(dict)
      page.node.addAnnot(ref)
      form.acroForm.addField(ref)
      return
    }
  }
}

function fieldKindOf(field: PDFField): FieldKind | 'other' {
  if (field instanceof PDFTextField) {
    const format = actionCode(field.acroField.dict, 'F')
    if (format && /AFDate_Format/.test(format)) return 'date'
    return field.isMultiline() ? 'multiline' : 'text'
  }
  if (field instanceof PDFCheckBox) return 'checkbox'
  if (field instanceof PDFRadioGroup) return 'radio'
  if (field instanceof PDFDropdown) return 'dropdown'
  if (field instanceof PDFSignature) return 'signature'
  return 'other'
}

function actionCode(dict: PDFDict, key: string): string | null {
  const aa = dict.lookupMaybe(PDFName.of('AA'), PDFDict)
  const action = aa?.lookupMaybe(PDFName.of(key), PDFDict)
  const js = action?.lookup(PDFName.of('JS'))
  return js instanceof PDFHexString || js instanceof PDFString ? js.decodeText() : null
}

function updateField(document: PDFDocument, form: PDFForm, name: string, changes: FieldChanges): void {
  const field = form.getFieldMaybe(name)
  if (!field) throw new FieldOpError(`There is no field called “${name}”.`)
  const kind = fieldKindOf(field)
  if (changes.name !== undefined && changes.name.trim() !== name) {
    const next = changes.name.trim()
    const problem = checkFieldName(next, form.getFields().map((other) => other.getName()), name)
    if (problem) throw new FieldOpError(problem)
    const dot = name.lastIndexOf('.')
    const prefix = dot >= 0 ? name.slice(0, dot + 1) : ''
    if (!next.startsWith(prefix) || next.slice(prefix.length).includes('.')) throw new FieldOpError(prefix ? `This field is part of the group “${prefix.slice(0, -1)}”, so its new name must start with “${prefix}” and have no other dots.` : 'A field name can only have dots when it was created inside a group.')
    field.acroField.setPartialName(next.slice(prefix.length))
  }
  setFlags(field, changes.required, changes.readOnly)
  if (changes.fontSize !== undefined) {
    if (!(changes.fontSize >= MIN_FONT_SIZE && changes.fontSize <= MAX_FONT_SIZE)) throw new FieldOpError(`Font size must be between ${MIN_FONT_SIZE} and ${MAX_FONT_SIZE}.`)
    if (field instanceof PDFTextField || field instanceof PDFDropdown) field.setFontSize(changes.fontSize)
  }
  if (kind === 'date' && changes.dateFormat) {
    if (!DATE_FORMATS.includes(changes.dateFormat)) throw new FieldOpError('Unknown date format.')
    field.acroField.dict.set(PDFName.of('AA'), dateActions(document, changes.dateFormat))
  }
  if (field instanceof PDFDropdown && changes.options) {
    const options = normalizeOptions(changes.options)
    if (options.length === 0) throw new FieldOpError('A dropdown needs at least one option.')
    const selected = field.getSelected()[0]
    field.setOptions(options)
    if (selected && options.includes(selected)) field.select(selected)
  }
  if (changes.defaultValue !== undefined) {
    const value = changes.defaultValue
    if (field instanceof PDFTextField) {
      setDefault(field, value ? PDFHexString.fromText(value) : null)
      field.setText(value || undefined)
    } else if (field instanceof PDFCheckBox) {
      if (value === 'on') field.check()
      else field.uncheck()
      setDefault(field, value === 'on' ? (field.acroField.dict.get(PDFName.of('V')) as PDFName) : null)
    } else if (field instanceof PDFRadioGroup) {
      if (value) {
        if (!field.getOptions().includes(value)) throw new FieldOpError('The default must be one of the choices.')
        field.select(value)
        setDefault(field, field.acroField.dict.get(PDFName.of('V')) as PDFName)
      } else {
        field.clear()
        setDefault(field, null)
      }
    } else if (field instanceof PDFDropdown) {
      if (value) {
        if (!field.getOptions().includes(value)) throw new FieldOpError('The default must be one of the options.')
        field.select(value)
        setDefault(field, PDFHexString.fromText(value))
      } else {
        field.clear()
        setDefault(field, null)
      }
    }
  }
}

function findWidget(form: PDFForm, document: PDFDocument, ref: WidgetRef): { field: PDFField; index: number } {
  const target = document.context.lookup(PDFRef.of(ref.num, ref.gen))
  if (target instanceof PDFDict) {
    for (const field of form.getFields()) {
      const index = field.acroField.getWidgets().findIndex((widget) => widget.dict === target)
      if (index >= 0) return { field, index }
    }
  }
  throw new FieldOpError('That field is no longer in the document.')
}

function moveWidget(document: PDFDocument, form: PDFForm, ref: WidgetRef, rect: FieldRect): void {
  const { field, index } = findWidget(form, document, ref)
  const widget = field.acroField.getWidgets()[index]!
  const [x1, y1, x2, y2] = normalizeRect(rect)
  if (x2 - x1 < MIN_SIDE || y2 - y1 < MIN_SIDE) throw new FieldOpError('The field is too small.')
  const before = widget.getRectangle()
  widget.setRectangle({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 })
  const resized = Math.abs(before.width - (x2 - x1)) > 0.5 || Math.abs(before.height - (y2 - y1)) > 0.5
  // A moved widget keeps its appearance; a resized one gets a new one (or it would be stretched).
  if (resized && !(field instanceof PDFSignature)) form.markFieldAsDirty(field.ref)
}

function removeFromArray(array: PDFArray | undefined, ref: PDFRef, dict: PDFDict, document: PDFDocument): boolean {
  if (!array) return false
  for (let index = array.size() - 1; index >= 0; index -= 1) {
    const entry = array.get(index)
    if (entry === ref || (entry instanceof PDFRef && document.context.lookup(entry) === dict)) {
      array.remove(index)
      return true
    }
  }
  return false
}

function deleteWidget(document: PDFDocument, form: PDFForm, ref: WidgetRef): void {
  const { field, index } = findWidget(form, document, ref)
  const widgets = field.acroField.getWidgets()
  const widget = widgets[index]!
  const widgetRef = PDFRef.of(ref.num, ref.gen)
  for (const page of document.getPages()) removeFromArray(page.node.Annots(), widgetRef, widget.dict, document)
  const fieldDict = field.acroField.dict
  const merged = widget.dict === fieldDict
  if (!merged) {
    removeFromArray(fieldDict.lookupMaybe(PDFName.of('Kids'), PDFArray), widgetRef, widget.dict, document)
    if (widgets.length > 1) return
  }
  // Last widget gone: drop the field itself from its parent (or the form) and the calculation order.
  const parent = fieldDict.lookupMaybe(PDFName.of('Parent'), PDFDict)
  const siblings = parent ? parent.lookupMaybe(PDFName.of('Kids'), PDFArray) : form.acroForm.dict.lookupMaybe(PDFName.of('Fields'), PDFArray)
  removeFromArray(siblings, field.ref, fieldDict, document)
  removeFromArray(form.acroForm.dict.lookupMaybe(PDFName.of('CO'), PDFArray), field.ref, fieldDict, document)
}

async function loadForEdit(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new FieldOpError(/encrypt/i.test(message) ? 'This PDF is encrypted, so fields can’t be added to it.' : 'Could not read this PDF to change its fields.')
  }
}

export interface FieldInfo {
  name: string
  kind: FieldKind | 'other'
  required: boolean
  readOnly: boolean
  /** As NewField.defaultValue: text, 'on' for a checked checkbox, or the chosen option. */
  defaultValue: string
  fontSize?: number
  options?: string[]
  /** Set when the field's date format is one of DATE_FORMATS (custom formats are left alone). */
  dateFormat?: DateFormat
}

function decoded(value: unknown): string {
  if (value instanceof PDFHexString || value instanceof PDFString) return value.decodeText()
  if (value instanceof PDFName) return value.decodeText()
  if (value instanceof PDFArray) return decoded(value.lookup(0))
  return ''
}

function describe(field: PDFField): FieldInfo {
  const kind = fieldKindOf(field)
  const dict = field.acroField.dict
  const dv = dict.lookup(PDFName.of('DV'))
  const info: FieldInfo = { name: field.getName(), kind, required: field.isRequired(), readOnly: field.isReadOnly(), defaultValue: '' }
  const da = field.acroField.getDefaultAppearance?.() ?? ''
  const size = /(\d+(?:\.\d+)?)\s+Tf/.exec(da)
  if (size && Number(size[1]) > 0) info.fontSize = Number(size[1])
  if (field instanceof PDFTextField) info.defaultValue = decoded(dv)
  else if (field instanceof PDFCheckBox) info.defaultValue = dv instanceof PDFName && dv.decodeText() !== 'Off' ? 'on' : ''
  else if (field instanceof PDFRadioGroup) {
    info.options = field.getOptions()
    const onValues = field.acroField.getOnValues().map((value) => value.decodeText())
    info.defaultValue = dv instanceof PDFName ? info.options[onValues.indexOf(dv.decodeText())] ?? '' : ''
  } else if (field instanceof PDFDropdown) {
    info.options = field.getOptions()
    info.defaultValue = decoded(dv)
  }
  if (kind === 'date') {
    const format = /AFDate_FormatEx\("([^"]+)"\)/.exec(actionCode(dict, 'F') ?? '')?.[1]
    if (format && (DATE_FORMATS as readonly string[]).includes(format)) info.dateFormat = format as DateFormat
  }
  return info
}

/** Every field in the file (fully qualified names, e.g. "address.city") and its editable properties. */
export async function describeFields(bytes: Uint8Array): Promise<FieldInfo[]> {
  const document = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const acroForm = document.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
  if (!acroForm || acroForm.has(PDFName.of('XFA'))) return []
  return document.getForm().getFields().map((field) => {
    try {
      return describe(field)
    } catch {
      return { name: field.getName(), kind: 'other' as const, required: false, readOnly: false, defaultValue: '' }
    }
  })
}

/** Apply field ops in order and return the new file. `bytes` should already hold pending edits. */
export async function applyFieldOps(bytes: Uint8Array, ops: readonly FieldOp[]): Promise<Uint8Array<ArrayBuffer>> {
  const document = await loadForEdit(bytes)
  if (document.catalog.has(PDFName.of('AcroForm'))) {
    const xfa = document.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.has(PDFName.of('XFA'))
    // getForm() would silently strip the XFA form; refuse instead.
    if (xfa) throw new FieldOpError('This PDF has an XFA form, so fields can’t be added or changed here.')
  }
  const form = document.getForm()
  for (const op of ops) {
    try {
      if (op.type === 'add') {
        const problem = checkNewField(op.field, form.getFields().map((field) => field.getName()), document.getPageCount())
        if (problem) throw new FieldOpError(problem)
        addField(document, form, op.field)
      } else if (op.type === 'update') updateField(document, form, op.name, op.changes)
      else if (op.type === 'move') moveWidget(document, form, op.widget, op.rect)
      else if (op.type === 'delete') deleteWidget(document, form, op.widget)
      else throw new FieldOpError('Unknown field action.')
    } catch (error) {
      if (error instanceof FieldOpError) throw error
      throw new FieldOpError(`Could not change the field: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  try {
    return new Uint8Array(await document.save({ useObjectStreams: false }))
  } catch {
    // Regenerating an appearance can fail (text Helvetica can't encode, odd third-party widgets):
    // keep the existing appearances and ask viewers to rebuild them instead.
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), document.context.obj(true))
    return new Uint8Array(await document.save({ useObjectStreams: false, updateFieldAppearances: false }))
  }
}
