/**
 * Read Aloud for PDFs: pdf.js text items (positioned runs of text, one page at a time) → paragraphs →
 * sentences, with the noise a PDF's layout adds taken out: lines are rebuilt from positions (not
 * pdf.js's item order), two-column pages read left column then right, words hyphenated across a line
 * break are joined, page headers/footers repeated on most pages and bare page numbers are dropped,
 * table-of-contents dot leaders are trimmed, and a paragraph cut by a page break is joined back up.
 * Pure and DOM-free: the engine page runs it on what pdf.js extracts, and the unit tests cover it.
 */
import { MAX_READ_ALOUD_CHARS, splitSentences } from "./read-aloud-text";

/** One run of text in top-left page coordinates (PDF points, y down to the baseline). */
export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  /** Font size (glyph height). */
  size: number;
}

export interface PdfPageText {
  width: number;
  height: number;
  items: PdfTextItem[];
}

export interface PdfReadingText {
  sentences: string[];
  /** pageStarts[p] = index of the first sentence on page p (0-based), or sentences.length past the end. */
  pageStarts: number[];
}

interface Line {
  text: string;
  x: number;
  right: number;
  y: number;
  size: number;
  /** Column region the line came from (0 = full width, 1 = left, 2 = right). */
  region: number;
}

/** Header/footer band: lines this close to the page's top or bottom edge (fraction of its height). */
const EDGE_BAND = 0.12;
const PAGE_NUMBER =
  /^(?:page\s+)?[-–—([]?\s*(?:\d{1,4}|[ivxlcdm]{1,7})\s*[-–—)\]]?(?:\s*(?:of|\/)\s*\d{1,4})?$/i;
const DOT_LEADER = /\s*(?:\.\s*){4,}\s*(?:\d{1,4}|[ivxlcdm]{1,7})?\s*$/i;
const TERMINAL = /[.!?…:;]["'”’)\]]*$/;
const HYPHEN_END = /[\p{L}][-\u2010\u00ad]$/u;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function usable(items: PdfTextItem[]): PdfTextItem[] {
  return items.filter(
    (item) =>
      item.text.trim() !== "" &&
      Number.isFinite(item.x) &&
      Number.isFinite(item.y) &&
      item.size > 0,
  );
}

/**
 * The gutter of a two-column page: an x between 35% and 65% of the width that no more than a few
 * runs cross, with plenty of text on each side over the same stretch of the page. Null for one column.
 */
export function columnGutter(page: PdfPageText): number | null {
  const items = usable(page.items);
  if (items.length < 12 || page.width <= 0) return null;
  let best: { x: number; crossing: number } | null = null;
  for (let x = page.width * 0.35; x <= page.width * 0.65; x += 2) {
    let crossing = 0;
    for (const item of items)
      if (item.x < x - 1 && item.x + item.width > x + 1) crossing += 1;
    if (!best || crossing < best.crossing) best = { x, crossing };
  }
  if (!best || best.crossing > Math.max(2, items.length * 0.08)) return null;
  const gutter = best.x;
  const left = items.filter((item) => item.x + item.width <= gutter + 1);
  const right = items.filter((item) => item.x >= gutter - 1);
  if (left.length < items.length * 0.2 || right.length < items.length * 0.2)
    return null;
  // Both columns must run alongside each other (not a short label column next to body text).
  const span = (list: PdfTextItem[]): [number, number] => [
    Math.min(...list.map((item) => item.y)),
    Math.max(...list.map((item) => item.y)),
  ];
  const [leftTop, leftBottom] = span(left);
  const [rightTop, rightBottom] = span(right);
  const overlap =
    Math.min(leftBottom, rightBottom) - Math.max(leftTop, rightTop);
  if (overlap < page.height * 0.1) return null;
  // Lines in a text column share a left edge; a table's cells start all over the place.
  const aligned = (list: PdfTextItem[]): boolean =>
    new Set(list.map((item) => Math.round(item.x / 4))).size <=
    Math.max(3, list.length * 0.5);
  if (!aligned(left) || !aligned(right)) return null;
  return gutter;
}

/** Runs of one region → lines (grouped by baseline, ordered left to right, spaces where there's a gap). */
function linesOf(items: PdfTextItem[], region: number): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: PdfTextItem[][] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    const anchor = last?.[0];
    if (
      last &&
      anchor &&
      Math.abs(item.y - anchor.y) <= Math.max(anchor.size, item.size) * 0.5
    )
      last.push(item);
    else groups.push([item]);
  }
  const lines: Line[] = [];
  for (const group of groups) {
    group.sort((a, b) => a.x - b.x);
    const size = median(group.map((item) => item.size));
    let text = "";
    let end = -Infinity;
    for (const item of group) {
      const gap = item.x - end;
      if (
        text &&
        !/\s$/.test(text) &&
        !/^\s/.test(item.text) &&
        gap > size * 0.12
      )
        text += " ";
      text += item.text;
      end = Math.max(end, item.x + item.width);
    }
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    lines.push({
      text: clean,
      x: group[0]!.x,
      right: end,
      y: median(group.map((item) => item.y)),
      size,
      region,
    });
  }
  return lines;
}

/** A page's lines in reading order: full-width lines above the columns, the left column, the right one, the rest. */
export function pageLines(page: PdfPageText): Line[] {
  const items = usable(page.items);
  const gutter = columnGutter(page);
  if (gutter === null) return linesOf(items, 0);
  const left = items.filter((item) => item.x + item.width <= gutter + 1);
  const right = items.filter(
    (item) => item.x >= gutter - 1 && item.x + item.width > gutter + 1,
  );
  const spanning = items.filter(
    (item) => !left.includes(item) && !right.includes(item),
  );
  const columnsTop = Math.min(...[...left, ...right].map((item) => item.y));
  const above = spanning.filter((item) => item.y < columnsTop);
  const below = spanning.filter((item) => item.y >= columnsTop);
  return [
    ...linesOf(above, 0),
    ...linesOf(left, 1),
    ...linesOf(right, 2),
    ...linesOf(below, 0),
  ];
}

function edgeKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

function inEdgeBand(line: Line, page: PdfPageText): boolean {
  return (
    page.height > 0 &&
    (line.y < page.height * EDGE_BAND || line.y > page.height * (1 - EDGE_BAND))
  );
}

/**
 * Header/footer lines repeated (digits ignored, so "Page 3 of 9" matches "Page 4 of 9") near the top or
 * bottom edge of at least 40% of the pages (and of two or more).
 */
export function repeatedEdgeLines(
  pages: PdfPageText[],
  lines: Line[][],
): Set<string> {
  const counts = new Map<string, number>();
  lines.forEach((pageLinesList, index) => {
    const page = pages[index]!;
    const keys = new Set(
      pageLinesList
        .filter((line) => inEdgeBand(line, page))
        .map((line) => edgeKey(line.text)),
    );
    for (const key of keys)
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const minimum = Math.max(2, Math.ceil(pages.length * 0.4));
  return new Set(
    [...counts].filter(([, count]) => count >= minimum).map(([key]) => key),
  );
}

/** Join a line onto the paragraph so far: a word hyphenated across the break is put back together. */
export function joinLine(paragraph: string, line: string): string {
  if (!paragraph) return line;
  if (HYPHEN_END.test(paragraph) && /^\p{Ll}/u.test(line))
    return paragraph.slice(0, -1) + line;
  return `${paragraph} ${line}`;
}

interface Paragraph {
  text: string;
  page: number;
}

function pageParagraphs(lines: Line[], page: number): Paragraph[] {
  const bodySize = median(lines.map((line) => line.size)) || 1;
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const dy = lines[i]!.y - lines[i - 1]!.y;
    if (
      lines[i]!.region === lines[i - 1]!.region &&
      dy > 0 &&
      Math.abs(lines[i]!.size - bodySize) < bodySize * 0.15
    )
      gaps.push(dy);
  }
  const spacing = median(gaps) || bodySize * 1.2;
  const extent = new Map<number, { left: number; right: number }>();
  for (const line of lines) {
    const known = extent.get(line.region);
    extent.set(line.region, {
      left: Math.min(known?.left ?? line.x, line.x),
      right: Math.max(known?.right ?? line.right, line.right),
    });
  }
  const isShort = (line: Line): boolean => {
    const box = extent.get(line.region);
    return (
      box !== undefined && line.right - box.left < (box.right - box.left) * 0.8
    );
  };
  const paragraphs: Paragraph[] = [];
  let text = "";
  let previous: Line | null = null;
  const close = (): void => {
    if (text) paragraphs.push({ text, page });
    text = "";
  };
  for (const line of lines) {
    const heading = line.size > bodySize * 1.15;
    if (previous) {
      const dy = line.y - previous.y;
      const sizeChange =
        Math.abs(line.size - previous.size) >
        Math.max(line.size, previous.size) * 0.15;
      const gap =
        dy > spacing * 1.6 ||
        dy < -spacing * 0.5 ||
        line.region !== previous.region;
      // A short line ending a sentence: the last line of a paragraph.
      const shortEnd = TERMINAL.test(previous.text) && isShort(previous);
      if (gap || sizeChange || shortEnd || heading) close();
    }
    text = joinLine(text, line.text);
    if (heading) close();
    previous = line;
  }
  close();
  return paragraphs;
}

/** Cleaned lines of every page (headers/footers, page numbers and dot leaders gone). */
export function cleanPdfLines(pages: PdfPageText[]): Line[][] {
  const lines = pages.map((page) => pageLines(page));
  const repeated = repeatedEdgeLines(pages, lines);
  return lines.map((pageLinesList, index) => {
    const page = pages[index]!;
    return pageLinesList
      .filter(
        (line) =>
          !(
            inEdgeBand(line, page) &&
            (repeated.has(edgeKey(line.text)) || PAGE_NUMBER.test(line.text))
          ),
      )
      .map((line) => ({
        ...line,
        text: line.text.replace(DOT_LEADER, "").trim(),
      }))
      .filter(
        (line) => line.text !== "" && !/^[\s\p{P}\p{S}]+$/u.test(line.text),
      );
  });
}

/** The whole document as sentences, with the sentence each page starts at. */
export function pdfReadingText(pages: PdfPageText[]): PdfReadingText {
  const lines = cleanPdfLines(pages);
  const paragraphs: Paragraph[] = [];
  lines.forEach((pageLinesList, page) => {
    const own = pageParagraphs(pageLinesList, page);
    const first = own[0];
    const last = paragraphs[paragraphs.length - 1];
    // A sentence running over the page break: the previous page's last paragraph didn't end, and
    // this page goes on in lower case (or mid-word after a hyphen).
    if (
      first &&
      last &&
      !TERMINAL.test(last.text) &&
      /^\p{Ll}/u.test(first.text)
    ) {
      // Only the first sentence moves back, so this page still starts at its own next sentence.
      const [head = "", ...rest] = splitSentences(first.text);
      last.text = joinLine(last.text, head);
      if (rest.length > 0) own[0] = { text: rest.join(" "), page };
      else own.shift();
    }
    paragraphs.push(...own);
  });
  const sentences: string[] = [];
  const pageStarts = new Array<number>(pages.length).fill(-1);
  let chars = 0;
  for (const paragraph of paragraphs) {
    if (chars >= MAX_READ_ALOUD_CHARS) break;
    const own = splitSentences(paragraph.text);
    if (own.length === 0) continue;
    if (pageStarts[paragraph.page] === -1)
      pageStarts[paragraph.page] = sentences.length;
    for (const sentence of own) {
      chars += sentence.length;
      sentences.push(sentence);
    }
  }
  // Pages without text of their own start where the next page with text does.
  let next = sentences.length;
  for (let page = pages.length - 1; page >= 0; page -= 1) {
    if (pageStarts[page] === -1) pageStarts[page] = next;
    else next = pageStarts[page]!;
  }
  return { sentences, pageStarts };
}

/**
 * pdf.js text content item → PdfTextItem: its transform composed with the page viewport's (top-left
 * origin). Rotated or vertical runs (margin stamps like arXiv's) are dropped.
 */
export function pdfTextItem(
  text: string,
  transform: number[],
  viewport: number[],
  width: number,
): PdfTextItem | null {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = transform;
  const [va = 1, vb = 0, vc = 0, vd = 1, ve = 0, vf = 0] = viewport;
  const m = [
    va * a + vc * b,
    vb * a + vd * b,
    va * c + vc * d,
    vb * c + vd * d,
    va * e + vc * f + ve,
    vb * e + vd * f + vf,
  ];
  const size = Math.hypot(m[2]!, m[3]!);
  if (!text || size <= 0) return null;
  if (Math.abs(m[1]!) > Math.abs(m[0]!) * 0.1) return null;
  const scale = Math.hypot(va, vb) || 1;
  return { text, x: m[4]!, y: m[5]!, width: Math.abs(width * scale), size };
}
