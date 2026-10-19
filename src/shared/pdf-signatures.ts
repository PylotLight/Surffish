// Saved signatures and initials for the built-in PDF editor. Stored by main (encrypted with
// safeStorage in userData); the editor page only ever sees this validated shape. What is kept is the
// signature's *source* (pen strokes, typed text or a small image), which pdf.js turns back into a
// signature editor sized for whichever page it lands on.

export type SavedSignatureKind = 'signature' | 'initials'

/** Pen colours: realistic ballpoint / fountain inks rather than pure #000. */
export const SIGNATURE_INKS = {
  black: { label: 'Black ink', hex: '#1b1b1f', rgb: [27, 27, 31] },
  blue: { label: 'Blue ballpoint', hex: '#1f3a8a', rgb: [31, 58, 138] },
  fountain: { label: 'Fountain blue', hex: '#2a4fb5', rgb: [42, 79, 181] }
} as const satisfies Record<string, { label: string; hex: string; rgb: readonly [number, number, number] }>
export type SignatureInk = keyof typeof SIGNATURE_INKS
export const DEFAULT_SIGNATURE_INK: SignatureInk = 'black'

/**
 * A drawn stroke: pad coordinates as x,y pairs, plus (optional, newer entries) one pen-width factor
 * per point from pressure or speed. Older entries have no widths and draw at an even width.
 */
export interface SignatureCurve { points: number[]; widths?: number[] }

export type SavedSignatureSource =
  | { type: 'draw'; curves: SignatureCurve[]; width: number; height: number; thickness: number }
  /** font: one of the editor's signature font ids (unknown ids fall back to the default); weight 400 | 700. */
  | { type: 'text'; text: string; font?: string; weight?: 400 | 700 }
  | { type: 'image'; dataUrl: string }

export interface SavedSignature {
  id: string
  kind: SavedSignatureKind
  description: string
  source: SavedSignatureSource
  /** Ink colour (entries saved before inks existed read as black). */
  ink: SignatureInk
  createdAt: number
}

/** A new signature from the editor (main assigns id and createdAt). */
export type NewSavedSignature = Pick<SavedSignature, 'kind' | 'description' | 'source'> & { ink?: SignatureInk }

export const MAX_SAVED_SIGNATURES = 24
const MAX_SIGNATURE_DESCRIPTION = 80
const MAX_SIGNATURE_TEXT = 80
const MAX_CURVES = 400
const MAX_POINTS = 40_000
const MAX_PAD_SIZE = 4096
/** Uploaded images are downscaled in the editor first; this caps what main will store. */
export const MAX_SIGNATURE_IMAGE_CHARS = 700_000
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const ID = /^[A-Za-z0-9-]{8,64}$/
const FONT_ID = /^[a-z0-9-]{1,32}$/
const MIN_WIDTH_FACTOR = 0.05
const MAX_WIDTH_FACTOR = 4

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : ''
}

function sanitizeSignatureSource(value: unknown): SavedSignatureSource | null {
  if (!isRecord(value)) return null
  if (value['type'] === 'text') {
    const text = cleanText(value['text'], MAX_SIGNATURE_TEXT)
    if (!text) return null
    const source: SavedSignatureSource = { type: 'text', text }
    const font = value['font']
    if (typeof font === 'string' && FONT_ID.test(font)) source.font = font
    if (value['weight'] === 700 || value['weight'] === 400) source.weight = value['weight']
    return source
  }
  if (value['type'] === 'image') {
    const dataUrl = value['dataUrl']
    return typeof dataUrl === 'string' && dataUrl.length <= MAX_SIGNATURE_IMAGE_CHARS && IMAGE_DATA_URL.test(dataUrl) ? { type: 'image', dataUrl } : null
  }
  if (value['type'] !== 'draw') return null
  const width = finite(value['width'], 1, MAX_PAD_SIZE)
  const height = finite(value['height'], 1, MAX_PAD_SIZE)
  const thickness = finite(value['thickness'], 0.5, 50)
  const curvesIn = value['curves']
  if (width === null || height === null || thickness === null || !Array.isArray(curvesIn) || curvesIn.length === 0 || curvesIn.length > MAX_CURVES) return null
  let total = 0
  const curves: SignatureCurve[] = []
  for (const curve of curvesIn) {
    const points = isRecord(curve) ? curve['points'] : null
    if (!Array.isArray(points) || points.length < 2 || points.length % 2 !== 0) return null
    total += points.length
    if (total > MAX_POINTS) return null
    const clean: number[] = []
    for (const point of points) {
      const number = finite(point, -MAX_PAD_SIZE, MAX_PAD_SIZE * 2)
      if (number === null) return null
      clean.push(Math.round(number * 10) / 10)
    }
    const widthsIn = isRecord(curve) ? curve['widths'] : undefined
    if (widthsIn === undefined) {
      curves.push({ points: clean })
      continue
    }
    // Widths are optional, but when present they must match the points (one per x,y pair).
    if (!Array.isArray(widthsIn) || widthsIn.length !== clean.length / 2) return null
    const widths: number[] = []
    for (const factor of widthsIn) {
      const number = finite(factor, MIN_WIDTH_FACTOR, MAX_WIDTH_FACTOR)
      if (number === null) return null
      widths.push(Math.round(number * 100) / 100)
    }
    curves.push({ points: clean, widths })
  }
  return { type: 'draw', curves, width, height, thickness }
}

/** Validate a signature coming from the editor page. */
export function sanitizeNewSignature(value: unknown): (NewSavedSignature & { ink: SignatureInk }) | null {
  if (!isRecord(value)) return null
  const source = sanitizeSignatureSource(value['source'])
  if (!source) return null
  const kind: SavedSignatureKind = value['kind'] === 'initials' ? 'initials' : 'signature'
  const description = cleanText(value['description'], MAX_SIGNATURE_DESCRIPTION) || (kind === 'initials' ? 'Initials' : 'Signature')
  return { kind, description, source, ink: signatureInk(value['ink']) }
}

/** A stored / requested ink id, or the default for anything unknown or missing. */
export function signatureInk(value: unknown): SignatureInk {
  return typeof value === 'string' && Object.hasOwn(SIGNATURE_INKS, value) ? (value as SignatureInk) : DEFAULT_SIGNATURE_INK
}

/** Parse the decrypted store; anything malformed is dropped rather than failing the whole list. */
export function parseSavedSignatures(value: unknown): SavedSignature[] {
  const list = isRecord(value) && Array.isArray(value['signatures']) ? value['signatures'] : Array.isArray(value) ? value : []
  const result: SavedSignature[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    if (!isRecord(entry)) continue
    const id = entry['id']
    if (typeof id !== 'string' || !ID.test(id) || seen.has(id)) continue
    const clean = sanitizeNewSignature(entry)
    if (!clean) continue
    const createdAt = finite(entry['createdAt'], 0, Number.MAX_SAFE_INTEGER) ?? 0
    seen.add(id)
    result.push({ id, createdAt, ...clean })
    if (result.length >= MAX_SAVED_SIGNATURES) break
  }
  return result
}

/** Newest first, capped: adding past the cap drops the oldest. */
export function addSavedSignature(list: SavedSignature[], entry: SavedSignature): SavedSignature[] {
  return [entry, ...list.filter((item) => item.id !== entry.id)].slice(0, MAX_SAVED_SIGNATURES)
}
