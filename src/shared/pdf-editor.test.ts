import assert from 'node:assert/strict'
import test from 'node:test'
import {
  editedPdfFilename,
  isEditablePdfSource,
  isPdfEditorUrl,
  looksLikePdf,
  PDF_EDITOR_URL,
  pdfEditorAssetPath,
  pdfEditorTabTitle,
  pdfNameFromUrl,
  withPdfExtension
} from './pdf-editor.ts'

test('PDF names come from the URL path, decoded and safe for the file system', () => {
  assert.equal(pdfNameFromUrl('https://example.test/files/Annual%20Report.pdf?token=x#page=2'), 'Annual Report.pdf')
  assert.equal(pdfNameFromUrl('https://example.test/download'), 'download.pdf')
  assert.equal(pdfNameFromUrl('https://example.test/'), 'example.test.pdf')
  assert.equal(pdfNameFromUrl('file:///Users/me/Docs/lease.PDF'), 'lease.PDF')
  assert.equal(pdfNameFromUrl('https://example.test/a%3Ab%2Fc.pdf'), 'a_b_c.pdf')
  assert.equal(pdfNameFromUrl('not a url'), 'document.pdf')
})

test('edited filename appends -edited once', () => {
  assert.equal(editedPdfFilename('report.pdf'), 'report-edited.pdf')
  assert.equal(editedPdfFilename('report-edited.pdf'), 'report-edited.pdf')
  assert.equal(editedPdfFilename('Scan.PDF'), 'Scan-edited.pdf')
  assert.equal(editedPdfFilename(''), 'document-edited.pdf')
  assert.equal(withPdfExtension('/tmp/out'), '/tmp/out.pdf')
  assert.equal(withPdfExtension('/tmp/out.PDF'), '/tmp/out.PDF')
})

test('editor tab title marks unsaved changes', () => {
  assert.equal(pdfEditorTabTitle('report.pdf', false), 'Editing – report.pdf')
  assert.equal(pdfEditorTabTitle('report.pdf', true), '• Editing – report.pdf')
})

test('the editor scheme only serves the editor page and bundled assets', () => {
  assert.equal(pdfEditorAssetPath(PDF_EDITOR_URL), 'pdf-editor.html')
  assert.equal(pdfEditorAssetPath('surffish-pdf://editor/assets/pdf-editor-abc123.js'), 'assets/pdf-editor-abc123.js')
  assert.equal(pdfEditorAssetPath('surffish-pdf://editor/pdfjs/cmaps/78-H.bcmap'), 'pdfjs/cmaps/78-H.bcmap')
  assert.equal(pdfEditorAssetPath('surffish-pdf://editor/index.html'), null)
  assert.equal(pdfEditorAssetPath('surffish-pdf://editor/assets/../../main/index.js'), null)
  assert.equal(pdfEditorAssetPath('surffish-pdf://editor/assets/%2e%2e/secret'), null)
  assert.equal(pdfEditorAssetPath('surffish-pdf://editor/assets/a%2F..%2F..%2Fb'), null)
  assert.equal(pdfEditorAssetPath('surffish-pdf://other/pdf-editor.html'), null)
  assert.equal(pdfEditorAssetPath('https://editor/pdf-editor.html'), null)
  assert.equal(isPdfEditorUrl(`${PDF_EDITOR_URL}#x`), true)
  assert.equal(isPdfEditorUrl('surffish-pdf://editor/assets/x.js'), false)
})

test('only http(s) and local file PDFs can be opened in the editor', () => {
  assert.equal(isEditablePdfSource('https://example.test/a.pdf'), true)
  assert.equal(isEditablePdfSource('file:///tmp/a.pdf'), true)
  assert.equal(isEditablePdfSource('file://server/share/a.pdf'), false)
  assert.equal(isEditablePdfSource('https://user:pw@example.test/a.pdf'), false)
  assert.equal(isEditablePdfSource('chrome-extension://abc/a.pdf'), false)
  assert.equal(isEditablePdfSource('data:application/pdf;base64,JVBERi0='), false)
})

test('PDF magic number check tolerates a short preamble', () => {
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
  assert.equal(looksLikePdf(encode('%PDF-1.7\n')), true)
  assert.equal(looksLikePdf(encode('\n\n  %PDF-1.4')), true)
  assert.equal(looksLikePdf(encode('<!doctype html>')), false)
  assert.equal(looksLikePdf(new Uint8Array()), false)
})
