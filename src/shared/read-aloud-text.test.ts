import { describe, expect, test } from 'bun:test'
import { articleTextFromHtml, decodeEntities, locateSentence, MAX_SENTENCE_CHARS, splitSentences } from './read-aloud-text'

describe('splitSentences', () => {
  test('splits at sentence ends with whitespace after them', () => {
    expect(splitSentences('Hello there. How are you? I am fine! Great.')).toEqual(['Hello there.', 'How are you?', 'I am fine!', 'Great.'])
  })

  test('keeps abbreviations, initials, decimals and URLs together', () => {
    expect(splitSentences('Dr. Smith met Mr. J. K. Rowling at 3.14 p.m. on Main St. today. It cost $4.50, e.g. a coffee.')).toEqual([
      'Dr. Smith met Mr. J. K. Rowling at 3.14 p.m. on Main St. today.',
      'It cost $4.50, e.g. a coffee.'
    ])
    expect(splitSentences('See example.com/a.b for more. Then stop.')).toEqual(['See example.com/a.b for more.', 'Then stop.'])
  })

  test('closing quotes and brackets stay with their sentence', () => {
    expect(splitSentences('She said "Stop." Then (quietly) left.) Next one.')).toEqual(['She said "Stop."', 'Then (quietly) left.)', 'Next one.'])
    expect(splitSentences('“Is it?” he asked. Yes.')).toEqual(['“Is it?”', 'he asked.', 'Yes.'])
  })

  test('paragraph breaks end a sentence even without punctuation (headings)', () => {
    expect(splitSentences('A heading\n\nThe first paragraph starts here. And ends here.')).toEqual(['A heading', 'The first paragraph starts here.', 'And ends here.'])
  })

  test('an ellipsis followed by lowercase carries on', () => {
    expect(splitSentences('Well... maybe not. Fine… Next.')).toEqual(['Well... maybe not.', 'Fine…', 'Next.'])
  })

  test('long sentences split at a clause, never mid-word, within the limit', () => {
    const long = `${'word '.repeat(50).trim()}, ${'more '.repeat(40).trim()}; ${'tail '.repeat(30).trim()}.`
    const pieces = splitSentences(long)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS)
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(long)
    expect(splitSentences('x'.repeat(700)).every((piece) => piece.length <= MAX_SENTENCE_CHARS)).toBe(true)
  })

  test('drops pieces with nothing to say', () => {
    expect(splitSentences('… — * * *\n\nReal text.')).toEqual(['Real text.'])
    expect(splitSentences('   ')).toEqual([])
  })
})

describe('articleTextFromHtml', () => {
  test('blocks become paragraphs; code, captions, footnotes and scripts are skipped', () => {
    const html = '<h1>Title</h1><p>First <b>bold</b> line.<br>Second&nbsp;line &amp; more.</p><figure><img src="x"><figcaption>A caption.</figcaption></figure><pre><code>const x = 1;</code></pre><p>After<sup>1</sup> code.</p><script>alert(1)</script><ul><li>One</li><li>Two</li></ul>'
    expect(articleTextFromHtml(html)).toBe('Title\n\nFirst bold line. Second line & more.\n\nAfter code.\n\nOne\n\nTwo')
  })

  test('decodes numeric and named entities, leaves unknown ones', () => {
    expect(decodeEntities('&#8220;Hi&#x201D; &mdash; &hellip; &bogus; &#0;')).toBe('“Hi” — … &bogus; ')
  })
})

describe('locateSentence', () => {
  test('finds a sentence across whitespace differences, from an offset', () => {
    const text = 'One two.\n  Three   four five. One two.'
    expect(locateSentence(text, 'Three four five.')).toEqual([11, 29])
    expect(locateSentence(text, 'One two.', 1)).toEqual([30, 38])
    expect(locateSentence(text, 'missing words')).toBeNull()
    expect(locateSentence(text, 'a (b) [c]? $d', 0)).toBeNull()
  })
})
