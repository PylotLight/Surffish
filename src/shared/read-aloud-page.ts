/**
 * Read Aloud on the live page (not Reader view): the sentence being spoken is highlighted with the
 * CSS Custom Highlight API (no DOM changes, so the page's own scripts and layout never see it), and
 * "Read from Here" finds where the right-click landed. The script below runs in an isolated world;
 * when a sentence can't be found in the page's text (text the article extraction rewrote, a page
 * that re-rendered) nothing is highlighted and the reading carries on.
 *
 * Matching ignores everything but letters and digits, case-folded, so whitespace, quotes, dashes and
 * entities that differ between Readability's text and the DOM don't matter.
 */

/** The ::highlight() name; main inserts its style as a user stylesheet while a reading runs. */
export const READ_ALOUD_HIGHLIGHT_NAME = 'surffish-read-aloud'
export const READ_ALOUD_HIGHLIGHT_CSS = `::highlight(${READ_ALOUD_HIGHLIGHT_NAME}) { background-color: rgba(255, 200, 61, 0.42); color: inherit; }`

/** Letters and digits of `text`, lower-cased. */
export function foldText(text: string): string {
  let out = ''
  for (const char of text) {
    if (!/[\p{L}\p{N}]/u.test(char)) continue
    const lower = char.toLowerCase()
    out += lower.length === char.length ? lower : char
  }
  return out
}

/**
 * Where `needle` sits in `folded` (already foldText'ed), searching from `from`: the whole needle,
 * else its first 32 folded chars (a footnote marker or a rewritten word later in the sentence),
 * extended by the needle's length. [start, end) in folded offsets, or null. Self-contained: it is
 * inlined into the page script.
 */
export function locateFolded(folded: string, needle: string, from = 0): [number, number] | null {
  let wanted = ''
  for (const char of needle) {
    if (!/[\p{L}\p{N}]/u.test(char)) continue
    const lower = char.toLowerCase()
    wanted += lower.length === char.length ? lower : char
  }
  if (wanted.length < 2) return null
  const start = Math.max(0, from)
  let at = folded.indexOf(wanted, start)
  if (at >= 0) return [at, at + wanted.length]
  if (wanted.length <= 32) return null
  at = folded.indexOf(wanted.slice(0, 32), start)
  return at >= 0 ? [at, Math.min(folded.length, at + wanted.length)] : null
}

/**
 * The sentence `probe` (text from a point in the page onwards) starts in, or null when it isn't in
 * them: the probe's first ~60 letters/digits are looked up in the sentences joined together.
 */
export function sentenceIndexForProbe(sentences: readonly string[], probe: string): number | null {
  const starts: number[] = []
  let joined = ''
  for (const sentence of sentences) {
    starts.push(joined.length)
    joined += foldText(sentence)
  }
  const head = foldText(probe).slice(0, 60)
  if (head.length < 4) return null
  const found = locateFolded(joined, head)
  if (!found) return null
  let index = 0
  while (index + 1 < starts.length && starts[index + 1]! <= found[0]) index += 1
  return index
}

/**
 * Source of the isolated-world script: defines `window.__surffishReadAloud` with
 * mark(text) → boolean, clear(), and fromPoint(x, y) → { probe, rest } | null.
 */
export function pageScriptSource(): string {
  return `(() => {
  if (window.__surffishReadAloud) return true
  const locateFolded = ${locateFolded.toString()}
  const NAME = ${JSON.stringify(READ_ALOUD_HIGHLIGHT_NAME)}
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT', 'OPTION', 'svg', 'math', 'CODE', 'PRE'])
  const BLOCKS = 'p,div,li,dt,dd,h1,h2,h3,h4,h5,h6,blockquote,td,th,section,article,header,footer,aside,main,figure,pre'
  const MAX_REST = 400000
  let index = null
  let from = 0
  let userScrolled = 0
  const noteScroll = () => { userScrolled = Date.now() }
  addEventListener('wheel', noteScroll, { passive: true, capture: true })
  addEventListener('touchmove', noteScroll, { passive: true, capture: true })
  const skipped = (node) => {
    for (let element = node.parentElement; element; element = element.parentElement) if (SKIP.has(element.tagName)) return true
    return false
  }
  const textNodes = (root, start) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    if (start) walker.currentNode = start
    return walker
  }
  const build = () => {
    const nodes = []
    const nodeAt = []
    const offsetAt = []
    let text = ''
    const walker = textNodes(document.body || document.documentElement)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (skipped(node)) continue
      let offset = 0
      for (const char of node.data) {
        if (/[\\p{L}\\p{N}]/u.test(char)) {
          const lower = char.toLowerCase()
          text += lower.length === char.length ? lower : char
          nodeAt.push(nodes.length)
          offsetAt.push(offset)
        }
        offset += char.length
      }
      nodes.push(node)
      if (text.length > MAX_REST * 2) break
    }
    return { text, nodes, nodeAt, offsetAt }
  }
  const rangeFor = (found) => {
    const first = index.nodes[index.nodeAt[found[0]]]
    const last = index.nodes[index.nodeAt[found[1] - 1]]
    if (!first || !last || !first.isConnected || !last.isConnected) return null
    const range = document.createRange()
    range.setStart(first, index.offsetAt[found[0]])
    const lastOffset = index.offsetAt[found[1] - 1]
    range.setEnd(last, Math.min(last.data.length, lastOffset + (last.data.codePointAt(lastOffset) > 0xffff ? 2 : 1)))
    return range
  }
  const mark = (sentence) => {
    if (typeof Highlight !== 'function' || !CSS.highlights) return false
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!index || attempt === 1) { index = build(); from = 0 }
      const found = locateFolded(index.text, sentence, from) || locateFolded(index.text, sentence, 0)
      const range = found && rangeFor(found)
      if (!range) continue
      from = found[0]
      CSS.highlights.set(NAME, new Highlight(range))
      const box = range.getBoundingClientRect()
      const offScreen = box.bottom < 0 || box.top > innerHeight
      if (offScreen && Date.now() - userScrolled > 5000) range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return true
    }
    CSS.highlights.delete(NAME)
    return false
  }
  const clear = () => {
    if (window.CSS && CSS.highlights) CSS.highlights.delete(NAME)
    index = null
    from = 0
  }
  const fromPoint = (x, y) => {
    let node = null
    let offset = 0
    const selection = getSelection()
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      node = range.startContainer
      offset = range.startOffset
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y)
      if (range) { node = range.startContainer; offset = range.startOffset }
    }
    if (!node) return null
    if (node.nodeType !== Node.TEXT_NODE) {
      const child = node.childNodes[offset] || node
      node = child.nodeType === Node.TEXT_NODE ? child : textNodes(child).nextNode()
      offset = 0
      if (!node) return null
    }
    // Back to the start of the sentence the point is in (within its text node).
    const before = node.data.slice(0, offset)
    const boundary = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '))
    let rest = node.data.slice(boundary >= 0 ? boundary + 2 : 0)
    let block = node.parentElement && node.parentElement.closest(BLOCKS)
    const walker = textNodes(document.body || document.documentElement, node)
    for (let next = walker.nextNode(); next && rest.length < MAX_REST; next = walker.nextNode()) {
      if (skipped(next)) continue
      const nextBlock = next.parentElement && next.parentElement.closest(BLOCKS)
      if (nextBlock !== block) { rest += '\\n\\n'; block = nextBlock }
      rest += next.data
    }
    return { probe: rest.slice(0, 400), rest: rest.slice(0, MAX_REST) }
  }
  window.__surffishReadAloud = { mark, clear, fromPoint }
  return true
})()`
}
