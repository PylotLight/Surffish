import { describe, expect, test } from 'bun:test'
import { cleanPdfLines, columnGutter, joinLine, pageLines, pdfReadingText, pdfTextItem, type PdfPageText, type PdfTextItem } from './read-aloud-pdf'

const W = 612
const H = 792

/** A run of text at (x, y), ~0.5em per character wide. */
function run(text: string, x: number, y: number, size = 10): PdfTextItem {
  return { text, x, y, width: text.length * size * 0.5, size }
}

/** Body lines starting at y, 12pt apart. */
function body(lines: string[], x = 72, y = 120, size = 10): PdfTextItem[] {
  return lines.map((text, index) => run(text, x, y + index * 12, size))
}

function page(items: PdfTextItem[]): PdfPageText {
  return { width: W, height: H, items }
}

describe('read aloud: PDF text', () => {
  test('runs on one baseline become one line, spaced by their gaps', () => {
    const lines = pageLines(page([run('world.', 130, 100.4), run('Hello', 72, 100), run('again', 200, 300)]))
    expect(lines.map((line) => line.text)).toEqual(['Hello world.', 'again'])
  })

  test('touching runs (a word split into pieces) join without a space', () => {
    const lines = pageLines(page([{ text: 'Sur', x: 72, y: 100, width: 15, size: 10 }, { text: 'ffish', x: 87, y: 100, width: 25, size: 10 }]))
    expect(lines[0]!.text).toBe('Surffish')
  })

  test('hyphenated words are joined across lines, real hyphens kept before capitals', () => {
    expect(joinLine('an extra-', 'ordinary day')).toBe('an extraordinary day')
    expect(joinLine('the Austro-', 'Hungarian empire')).toBe('the Austro- Hungarian empire')
    expect(joinLine('pages 3 -', 'and more')).toBe('pages 3 - and more')
    const text = pdfReadingText([page(body(['Reading aloud works with hyphen-', 'ated words in a paragraph that wraps.']))])
    expect(text.sentences).toEqual(['Reading aloud works with hyphenated words in a paragraph that wraps.'])
  })

  test('repeated headers/footers and page numbers are dropped', () => {
    const pages = [1, 2, 3, 4].map((n) => page([
      run('ACME Quarterly Report 2026', 72, 40, 8),
      ...body([`This is the body of page ${n}, a complete sentence.`]),
      run(`Page ${n} of 4`, 280, 760, 8)
    ]))
    const lines = cleanPdfLines(pages)
    expect(lines.flat().map((line) => line.text)).toEqual([1, 2, 3, 4].map((n) => `This is the body of page ${n}, a complete sentence.`))
  })

  test('a bare page number is dropped even on a single page, body numbers are kept', () => {
    const lines = cleanPdfLines([page([...body(['Chapter text here.', '42']), run('7', 300, 770)])])
    expect(lines[0]!.map((line) => line.text)).toEqual(['Chapter text here.', '42'])
  })

  test('a line repeated at the top of a page but only once is kept', () => {
    const pages = [page([run('Introduction', 72, 40, 14), ...body(['First page text.'])]), page(body(['Second page text.'])), page(body(['Third page text.']))]
    expect(cleanPdfLines(pages)[0]![0]!.text).toBe('Introduction')
  })

  test('table of contents dot leaders are trimmed', () => {
    const lines = cleanPdfLines([page(body(['Introduction .......... 3', 'Methods . . . . . . . 12']))])
    expect(lines[0]!.map((line) => line.text)).toEqual(['Introduction', 'Methods'])
  })

  test('two-column pages read the left column, then the right', () => {
    const left = Array.from({ length: 10 }, (_, i) => `Left column line ${i + 1} goes`)
    const right = Array.from({ length: 10 }, (_, i) => `Right column line ${i + 1} goes`)
    const items = [run('A Two Column Paper Title', 180, 70, 16), ...body(left, 50, 120), ...body(right, 330, 120)]
    expect(columnGutter(page(items))).not.toBeNull()
    const lines = pageLines(page(items)).map((line) => line.text)
    expect(lines[0]).toBe('A Two Column Paper Title')
    expect(lines.slice(1, 11)).toEqual(left)
    expect(lines.slice(11)).toEqual(right)
  })

  test('a one-column page has no gutter', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `A long single column line number ${i + 1} that spans across the page width`)
    expect(columnGutter(page(body(lines)))).toBeNull()
  })

  test('paragraphs break on gaps and headings, sentences split', () => {
    const items = [
      run('Getting Started', 72, 100, 16),
      ...body(['The first paragraph has two lines that wrap', 'onto a second line. And a second sentence.'], 72, 130),
      ...body(['A new paragraph after a blank gap.'], 72, 190)
    ]
    expect(pdfReadingText([page(items)]).sentences).toEqual([
      'Getting Started',
      'The first paragraph has two lines that wrap onto a second line.',
      'And a second sentence.',
      'A new paragraph after a blank gap.'
    ])
  })

  test('a sentence cut by a page break is joined; pageStarts point at each page', () => {
    const pages = [
      page(body(['Page one starts here.', 'This sentence runs over the'])),
      page(body(['page break and ends here.', 'Then page two goes on.'])),
      page([]),
      page(body(['Page four.']))
    ]
    const text = pdfReadingText(pages)
    expect(text.sentences).toEqual(['Page one starts here.', 'This sentence runs over the page break and ends here.', 'Then page two goes on.', 'Page four.'])
    expect(text.pageStarts).toEqual([0, 2, 3, 3])
  })

  test('a scanned PDF (no text) has no sentences', () => {
    expect(pdfReadingText([page([]), page([run('   ', 10, 10)])])).toEqual({ sentences: [], pageStarts: [0, 0] })
  })

  test('pdf.js items: viewport transform to top-left coordinates, rotated runs dropped', () => {
    // A 612x792 page at scale 1: viewport [1, 0, 0, -1, 0, 792].
    const viewport = [1, 0, 0, -1, 0, 792]
    expect(pdfTextItem('Hello', [12, 0, 0, 12, 72, 700], viewport, 30)).toEqual({ text: 'Hello', x: 72, y: 92, width: 30, size: 12 })
    expect(pdfTextItem('arXiv:2610.00001', [0, 12, -12, 0, 20, 300], viewport, 90)).toBeNull()
    expect(pdfTextItem('', [12, 0, 0, 12, 72, 700], viewport, 0)).toBeNull()
  })
})
