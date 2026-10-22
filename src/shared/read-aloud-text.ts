/**
 * Read Aloud text: Readability's article HTML → plain paragraphs → sentences, small enough for
 * Phonon to start speaking within one sentence (the engine streams one sentence while the next is
 * generated). Pure and DOM-free so main can run it on the extracted article and the unit tests can
 * cover it.
 */

/** Longest piece handed to the engine at once; longer sentences split at a clause or a space. */
export const MAX_SENTENCE_CHARS = 320;
/** Hard cap on what one reading takes (≈ a long book chapter). The rest is dropped. */
export const MAX_READ_ALOUD_CHARS = 400_000;

const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "mx",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "mt",
  "ft",
  "vs",
  "etc",
  "e.g",
  "i.e",
  "cf",
  "al",
  "no",
  "nos",
  "fig",
  "figs",
  "vol",
  "vols",
  "ch",
  "pp",
  "p",
  "ed",
  "eds",
  "est",
  "approx",
  "dept",
  "univ",
  "inc",
  "ltd",
  "co",
  "corp",
  "gov",
  "gen",
  "col",
  "lt",
  "sgt",
  "capt",
  "rev",
  "hon",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "u.s",
  "u.k",
  "a.m",
  "p.m",
  "ph.d",
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  middot: "·",
  bull: "•",
  times: "×",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  shy: "",
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : "";
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    },
  );
}

/** Elements whose text is not read: code, captions, footnote markers, embedded media and forms. */
const SKIPPED_ELEMENTS =
  /<(script|style|noscript|template|pre|code|figcaption|sup|svg|math|button|select|textarea|iframe|object|video|audio|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BLOCK_BOUNDARY =
  /<\/?(?:p|div|section|article|header|footer|aside|main|nav|h[1-6]|li|ul|ol|dl|dt|dd|blockquote|table|thead|tbody|tr|td|th|figure|hr|details|summary)\b[^>]*>/gi;

/**
 * The article's readable text, one paragraph per block element (separated by blank lines). Headings
 * become their own paragraph, so they're spoken as a sentence of their own.
 */
export function articleTextFromHtml(html: string): string {
  const text = html
    .slice(0, MAX_READ_ALOUD_CHARS * 4)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(SKIPPED_ELEMENTS, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(BLOCK_BOUNDARY, "\n\n")
    .replace(/<[^>]+>/g, "");
  return normalizeParagraphs(decodeEntities(text));
}

/** Collapse runs of spaces, keep blank lines as paragraph breaks, trim. */
export function normalizeParagraphs(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v\u00a0\u2000-\u200b\u202f\u205f\u3000]+/g, " ")
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n")
    .slice(0, MAX_READ_ALOUD_CHARS);
}

/** True when the word before a period is an abbreviation or an initial (not a sentence end). */
function isAbbreviation(before: string): boolean {
  const word = /([A-Za-z][A-Za-z.]*)$/.exec(before)?.[1];
  if (!word) return false;
  if (/^[A-Z]$/.test(word)) return true; // initials: "J. K. Rowling"
  return ABBREVIATIONS.has(word.toLowerCase());
}

/** A long sentence split at the last clause mark (or space) before the limit. */
function splitLong(sentence: string, limit: number): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    let cut = -1;
    for (const mark of ["; ", ": ", " — ", " – ", ", "]) {
      const at = window.lastIndexOf(mark);
      if (at > limit * 0.4) {
        cut = at + mark.trimEnd().length;
        break;
      }
    }
    if (cut < 0) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = limit;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Something worth speaking: has a letter or a digit. */
function speakable(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * Sentences of `text` in reading order. Ends at . ! ? … (with any closing quotes or brackets) followed
 * by whitespace, except after abbreviations and initials; decimals and URLs never split (no space).
 * Paragraph breaks always end a sentence. Pieces longer than `maxChars` split at a clause boundary.
 */
export function splitSentences(
  text: string,
  maxChars = MAX_SENTENCE_CHARS,
): string[] {
  const sentences: string[] = [];
  for (const paragraph of normalizeParagraphs(text).split("\n\n")) {
    let start = 0;
    const boundary = /[.!?…]+["'”’)\]»]*(?=\s+|$)/g;
    let match: RegExpExecArray | null;
    while ((match = boundary.exec(paragraph))) {
      const end = match.index + match[0].length;
      const punctuation = match[0];
      // "Dr. Smith" carries on; an abbreviation that ends the paragraph still ends it.
      if (
        punctuation === "." &&
        end < paragraph.length &&
        isAbbreviation(paragraph.slice(start, match.index))
      )
        continue;
      const next = paragraph.slice(end).trimStart();
      // "he said... and then" (lowercase after an ellipsis) carries on.
      if (/…|\.\.\./.test(punctuation) && /^[a-z]/.test(next)) continue;
      const sentence = paragraph.slice(start, end).trim();
      if (sentence) sentences.push(sentence);
      start = end;
    }
    const tail = paragraph.slice(start).trim();
    if (tail) sentences.push(tail);
  }
  return sentences
    .flatMap((sentence) => splitLong(sentence, maxChars))
    .filter(speakable);
}

/**
 * Where `needle` (a sentence) sits in `haystack` (the page's text), ignoring differences in
 * whitespace, starting at `from`. Returns [start, end) offsets into `haystack`, or null. Reader view
 * uses it to highlight the sentence being spoken.
 */
export function locateSentence(
  haystack: string,
  needle: string,
  from = 0,
): [number, number] | null {
  const words = needle.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const escaped = words.map((word) =>
    word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const pattern = new RegExp(escaped.join("\\s+"), "g");
  pattern.lastIndex = Math.max(0, from);
  const match = pattern.exec(haystack);
  return match ? [match.index, match.index + match[0].length] : null;
}
