// Saved signatures and initials for the built-in PDF editor. Stored by main (encrypted with
// safeStorage in userData); the editor page only ever sees this validated shape. What is kept is the
// signature's *source* (pen strokes, typed text or a small image), which pdf.js turns back into a
// signature editor sized for whichever page it lands on.

export type SavedSignatureKind = 'signature' | 'initials'

export type SavedSignatureSource =
  | { type: 'draw'; curves: { points: number[] }[]; width: number; height: number; thickness: number }
  | { type: 'text'; text: string }
  | { type: 'image'; dataUrl: string }

export interface SavedSignature {
  id: string
  kind: SavedSignatureKind
  description: string
  source: SavedSignatureSource
  createdAt: number
}

/** A new signature from the editor (main assigns id and createdAt). */
export type NewSavedSignature = Pick<SavedSignature, 'kind' | 'description' | 'source'>

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
    return text ? { type: 'text', text } : null
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
  const curves: { points: number[] }[] = []
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
    curves.push({ points: clean })
  }
  return { type: 'draw', curves, width, height, thickness }
}

/** Validate a signature coming from the editor page. */
export function sanitizeNewSignature(value: unknown): NewSavedSignature | null {
  if (!isRecord(value)) return null
  const source = sanitizeSignatureSource(value['source'])
  if (!source) return null
  const kind: SavedSignatureKind = value['kind'] === 'initials' ? 'initials' : 'signature'
  const description = cleanText(value['description'], MAX_SIGNATURE_DESCRIPTION) || (kind === 'initials' ? 'Initials' : 'Signature')
  return { kind, description, source }
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
