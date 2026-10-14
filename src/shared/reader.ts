import { urlHostname } from './url-host'

// Shared, side-effect free helpers for Reader view. Detection runs Mozilla Readability's
// isProbablyReaderable in an isolated world of the page; extraction runs Readability itself there.
// The article is rendered on a privileged scheme, on an in-memory session with no network; its
// images are proxied through main with the tab's own session.

export const READER_SCHEME = 'surffish-reader'
export const READER_HOST = 'reader'
export const READER_ORIGIN = `${READER_SCHEME}://${READER_HOST}`
export const READER_PAGE = 'reader.html'
export const READER_URL = `${READER_ORIGIN}/${READER_PAGE}`
/** Path on the reader origin that proxies one article image through main. */
export const READER_IMAGE_PATH = '/image'
/** Isolated world the detection and extraction scripts run in (pages can't see or patch it). */
export const READER_WORLD_ID = 1310
/** Extracted article HTML bigger than this is refused (a runaway page, not an article). */
export const MAX_READER_CONTENT_CHARS = 4 * 1024 * 1024
export const MAX_READER_IMAGE_BYTES = 15 * 1024 * 1024
/** Readability's own defaults are 140/20; keep them so the button matches Firefox's. */
export const READERABLE_OPTIONS = { minContentLength: 140, minScore: 20 } as const

export type ReaderFont = 'serif' | 'sans'
export type ReaderWidth = 'narrow' | 'medium' | 'wide'
export type ReaderTheme = 'light' | 'sepia' | 'dark'

export interface ReaderSettings {
  font: ReaderFont
  /** Body text size in CSS pixels. */
  fontSize: number
  width: ReaderWidth
  theme: ReaderTheme
}

export const READER_FONT_SIZE_MIN = 14
export const READER_FONT_SIZE_MAX = 30
export const DEFAULT_READER_SETTINGS: ReaderSettings = { font: 'serif', fontSize: 19, width: 'medium', theme: 'light' }

export function normalizeReaderSettings(value: unknown, base: ReaderSettings = DEFAULT_READER_SETTINGS): ReaderSettings {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const font = record.font === 'serif' || record.font === 'sans' ? record.font : base.font
  const width = record.width === 'narrow' || record.width === 'medium' || record.width === 'wide' ? record.width : base.width
  const theme = record.theme === 'light' || record.theme === 'sepia' || record.theme === 'dark' ? record.theme : base.theme
  const size = typeof record.fontSize === 'number' && Number.isFinite(record.fontSize) ? Math.round(record.fontSize) : base.fontSize
  return { font, width, theme, fontSize: Math.min(READER_FONT_SIZE_MAX, Math.max(READER_FONT_SIZE_MIN, size)) }
}

/** Only ordinary web pages are checked; internal pages, files and the PDF viewer never are. */
export function isReaderCandidateUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  // A site's front page is almost never an article; Readability agrees often enough to skip the work.
  if ((url.pathname === '/' || url.pathname === '') && !url.search) return false
  return !/\.(?:pdf|png|jpe?g|gif|webp|svg|avif|mp4|webm|mp3|zip|json|xml|txt)$/i.test(url.pathname)
}

/**
 * Wrap Readability's CommonJS source so it runs as a plain script in an isolated world and hands
 * back its export. `body` is the expression evaluated with the export bound to `exported`.
 */
function wrapCommonJs(source: string, body: string): string {
  return `(() => {\n  const module = { exports: {} };\n  ${source}\n;\n  const exported = module.exports;\n  try {\n    ${body}\n  } catch (error) {\n    return { error: String(error && error.message || error) };\n  }\n})()`
}

/** Detection script: true/false for "this looks like an article". Cheap: no clone, no parse. */
export function buildReaderableScript(readerableSource: string): string {
  return wrapCommonJs(readerableSource, `if (!document.body || document.contentType && !/html/i.test(document.contentType)) return false;\n    return exported(document, ${JSON.stringify(READERABLE_OPTIONS)}) === true;`)
}

/** Extraction script: Readability.parse() on a clone of the live document. */
export function buildExtractScript(readabilitySource: string): string {
  return wrapCommonJs(readabilitySource, `const article = new exported(document.cloneNode(true), { charThreshold: 400 }).parse();
    if (!article) return null;
    return {
      title: article.title || document.title || '',
      byline: article.byline || '',
      siteName: article.siteName || '',
      excerpt: article.excerpt || '',
      lang: article.lang || document.documentElement.lang || '',
      dir: article.dir || '',
      publishedTime: article.publishedTime || '',
      content: article.content || '',
      textContent: (article.textContent || '').slice(0, 2000000)
    };`)
}

/** The detection script's result: anything but a literal true means "no". */
export function parseReaderableResult(value: unknown): boolean {
  return value === true
}

export interface ReaderArticle {
  /** The page the article came from (what "Back to page" returns to). */
  url: string
  title: string
  byline: string
  siteName: string
  excerpt: string
  lang: string
  dir: 'ltr' | 'rtl' | 'auto'
  publishedTime: string
  /** Readability's HTML; unsanitized here, the reader page runs it through DOMPurify. */
  content: string
  readingMinutes: number
  wordCount: number
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

export type ExtractedArticleResult = { ok: true; article: ReaderArticle } | { ok: false; error: string }

/** Validate what came back from the page's world: shapes, sizes and a non-empty body. */
export function parseExtractedArticle(value: unknown, pageUrl: string): ExtractedArticleResult {
  if (value === null || value === undefined) return { ok: false, error: 'Reader view could not find an article on this page.' }
  if (typeof value !== 'object') return { ok: false, error: 'Reader view could not read this page.' }
  const record = value as Record<string, unknown>
  if (typeof record.error === 'string') return { ok: false, error: 'Reader view could not read this page.' }
  const content = typeof record.content === 'string' ? record.content : ''
  if (!content.trim()) return { ok: false, error: 'Reader view could not find an article on this page.' }
  if (content.length > MAX_READER_CONTENT_CHARS) return { ok: false, error: 'This article is too large for Reader view.' }
  const plain = typeof record.textContent === 'string' ? record.textContent : ''
  const words = countWords(plain)
  const dir = record.dir === 'rtl' || record.dir === 'ltr' ? record.dir : 'auto'
  const lang = text(record.lang, 35)
  return {
    ok: true,
    article: {
      url: pageUrl,
      title: text(record.title, 500) || urlHostname(pageUrl) || 'Article',
      byline: text(record.byline, 300),
      siteName: text(record.siteName, 200) || urlHostname(pageUrl),
      excerpt: text(record.excerpt, 600),
      lang: /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(lang) ? lang : '',
      dir,
      publishedTime: text(record.publishedTime, 80),
      content,
      readingMinutes: estimateReadingMinutes(plain),
      wordCount: words
    }
  }
}

// Han, Hiragana, Katakana, Hangul: no spaces between words, so count characters instead.
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/g

function wordCounts(value: string): { words: number; cjk: number } {
  const cjk = value.match(CJK)?.length ?? 0
  const words = value.replace(CJK, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0
  return { words, cjk }
}

/** Space-separated words, plus CJK characters counted two to a word. */
export function countWords(value: string): number {
  const { words, cjk } = wordCounts(value)
  return words + Math.round(cjk / 2)
}

/** ~230 words a minute (CJK: ~500 characters), rounded, never below one minute. */
export function estimateReadingMinutes(value: string, wordsPerMinute = 230): number {
  const { words, cjk } = wordCounts(value)
  return Math.max(1, Math.round(words / wordsPerMinute + cjk / 500))
}

export function formatReadingTime(minutes: number): string {
  return minutes <= 1 ? '1 min read' : `${minutes} min read`
}

/** surffish-reader://reader/image?d=<doc token>&u=<image url> */
export function readerImageUrl(documentToken: string, imageUrl: string): string {
  return `${READER_ORIGIN}${READER_IMAGE_PATH}?d=${encodeURIComponent(documentToken)}&u=${encodeURIComponent(imageUrl)}`
}

export function parseReaderImageRequest(requestUrl: string): { token: string; url: string } | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${READER_SCHEME}:` || url.host !== READER_HOST || url.pathname !== READER_IMAGE_PATH) return null
  const token = url.searchParams.get('d') ?? ''
  const target = url.searchParams.get('u') ?? ''
  if (!/^[A-Za-z0-9-]{8,64}$/.test(token) || !isProxiableImageUrl(target)) return null
  return { token, url: target }
}

export function isProxiableImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

function decodeBasicEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

/**
 * Only images the extracted article actually references are proxied: the reader page can't turn
 * main into a general fetcher for the tab's session (cookies, proxy).
 */
export function isArticleImageAllowed(imageUrl: string, articleContent: string): boolean {
  if (!isProxiableImageUrl(imageUrl)) return false
  if (articleContent.includes(imageUrl)) return true
  const decoded = decodeBasicEntities(articleContent)
  if (decoded.includes(imageUrl)) return true
  // The renderer resolves URLs through the DOM, which may percent-encode characters the HTML had raw.
  try {
    return decoded.includes(decodeURI(imageUrl))
  } catch {
    return false
  }
}

/** Static files the reader page may load: its HTML and Vite's hashed assets. */
const ASSET_PATH = /^assets\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/

export function readerAssetPath(requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${READER_SCHEME}:` || url.host !== READER_HOST || url.username || url.password) return null
  let path: string
  try {
    path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  } catch {
    return null
  }
  if (path === READER_PAGE) return path
  if (!ASSET_PATH.test(path) || path.split('/').some((part) => part === '.' || part === '..')) return null
  return path
}

export function isReaderUrl(value: string): boolean {
  try {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    return url.toString() === READER_URL
  } catch {
    return false
  }
}

/** What the omnibox shows for the active tab: nothing, a Reader button, or the button lit. */
export type ReaderTabState = 'available' | 'active' | null
