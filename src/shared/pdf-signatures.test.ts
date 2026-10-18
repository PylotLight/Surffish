import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { addSavedSignature, MAX_SAVED_SIGNATURES, parseSavedSignatures, sanitizeNewSignature, type SavedSignature } from './pdf-signatures'

const drawn = { type: 'draw', curves: [{ points: [1, 2, 3.333, 4] }], width: 560, height: 180, thickness: 3 }

test('new signatures are validated and normalised', () => {
  assert.deepEqual(sanitizeNewSignature({ kind: 'initials', description: '  AL\n', source: { type: 'text', text: 'A.L.' } }), {
    kind: 'initials', description: 'AL', source: { type: 'text', text: 'A.L.' }
  })
  assert.deepEqual(sanitizeNewSignature({ source: drawn })?.source, { ...drawn, curves: [{ points: [1, 2, 3.3, 4] }] })
  assert.equal(sanitizeNewSignature({ source: drawn })?.description, 'Signature')
  assert.equal(sanitizeNewSignature({ source: { type: 'text', text: '   ' } }), null)
  assert.equal(sanitizeNewSignature({ source: { ...drawn, curves: [{ points: [1, 2, 3] }] } }), null)
  assert.equal(sanitizeNewSignature({ source: { ...drawn, curves: [{ points: [1, Number.NaN] }] } }), null)
  assert.equal(sanitizeNewSignature({ source: { type: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' } })?.source.type, 'image')
  assert.equal(sanitizeNewSignature({ source: { type: 'image', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } }), null)
  assert.equal(sanitizeNewSignature({ source: { type: 'image', dataUrl: 'https://example.test/sig.png' } }), null)
  assert.equal(sanitizeNewSignature('nope'), null)
})

test('stored lists drop bad entries and duplicates', () => {
  const parsed = parseSavedSignatures({
    signatures: [
      { id: 'aaaaaaaa-1', kind: 'signature', description: 'Mine', source: drawn, createdAt: 5 },
      { id: 'aaaaaaaa-1', kind: 'signature', description: 'Dup', source: drawn, createdAt: 6 },
      { id: 'bad id!', kind: 'signature', source: drawn },
      { id: 'bbbbbbbb-2', kind: 'initials', source: { type: 'text', text: 'AL' } },
      null
    ]
  })
  assert.deepEqual(parsed.map((entry) => [entry.id, entry.description]), [['aaaaaaaa-1', 'Mine'], ['bbbbbbbb-2', 'Initials']])
  assert.deepEqual(parseSavedSignatures(null), [])
})

test('adding keeps newest first and caps the list', () => {
  let list: SavedSignature[] = []
  for (let index = 0; index < MAX_SAVED_SIGNATURES + 3; index += 1) {
    list = addSavedSignature(list, { id: `sig-0000${index}`, kind: 'signature', description: String(index), source: { type: 'text', text: 'x' }, createdAt: index })
  }
  assert.equal(list.length, MAX_SAVED_SIGNATURES)
  assert.equal(list[0]?.description, String(MAX_SAVED_SIGNATURES + 2))
})
