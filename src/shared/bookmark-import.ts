import type { ImportedBookmarkNode } from './bookmarks.ts'
import type { PlistValue } from './bplist.ts'

/**
 * Pure parsers for other browsers' bookmark formats, plus Netscape bookmarks HTML export.
 * File discovery, copying and SQLite live in main; everything here works on already-read data.
 * Passwords are never read: Bramble owns those.
 */

export type BookmarkImportBrowser = 'chrome' | 'brave' | 'edge' | 'arc' | 'firefox' | 'safari'

export interface ImportedHistoryEntry {
  url: string
  title: string
  visitedAt: number
}

// Chromium/WebKit timestamps count microseconds from 1601-01-01 UTC.
const WINDOWS_EPOCH_OFFSET_MS = 11_644_473_600_000
const MAC_EPOCH_MS = Date.UTC(2001, 0, 1)
const MIN_REASONABLE_MS = Date.UTC(1995, 0, 1)

function reasonable(ms: number): number | undefined {
  return Number.isFinite(ms) && ms >= MIN_REASONABLE_MS && ms <= Date.now() + 366 * 86_400_000 ? Math.round(ms) : undefined
}

export function chromiumTimeToMs(value: unknown): number | undefined {
  if (typeof value === 'number') return reasonable(value / 1000 - WINDOWS_EPOCH_OFFSET_MS)
  if (typeof value === 'bigint') return reasonable(Number(value / 1000n) - WINDOWS_EPOCH_OFFSET_MS)
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) return undefined
  return reasonable(Number(BigInt(value) / 1000n) - WINDOWS_EPOCH_OFFSET_MS)
}

/** Firefox PRTime: microseconds since the Unix epoch. */
export function prTimeToMs(value: unknown): number | undefined {
  const number = typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : NaN
  return reasonable(number / 1000)
}

/** Safari History.db visit_time: seconds since 2001-01-01. */
export function macAbsoluteTimeToMs(value: unknown): number | undefined {
  const number = typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : NaN
  return reasonable(MAC_EPOCH_MS + number * 1000)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// ---------------------------------------------------------------------------
// Chromium (Chrome, Brave, Edge, Arc): <profile>/Bookmarks is JSON.

const CHROMIUM_ROOT_LABELS: Record<string, string> = {
  bookmark_bar: 'Bookmarks bar',
  other: 'Other bookmarks',
  synced: 'Mobile bookmarks'
}

function chromiumNode(value: unknown, depth: number): ImportedBookmarkNode | null {
  if (!isRecord(value) || depth > 100) return null
  const dateAdded = chromiumTimeToMs(value.date_added)
  if (value.type === 'url') {
    return { title: text(value.name), url: text(value.url), ...(dateAdded ? { dateAdded } : {}) }
  }
  if (value.type === 'folder' || Array.isArray(value.children)) {
    const children = Array.isArray(value.children)
      ? value.children.map((child) => chromiumNode(child, depth + 1)).filter((child): child is ImportedBookmarkNode => child !== null)
      : []
    return { title: text(value.name), children, ...(dateAdded ? { dateAdded } : {}) }
  }
  return null
}

/** One folder per non-empty Chromium root (bar, other, mobile), keeping each root's own name. */
export function parseChromiumBookmarks(value: unknown): ImportedBookmarkNode[] {
  if (!isRecord(value) || !isRecord(value.roots)) throw new Error('This is not a Chromium Bookmarks file.')
  const roots = value.roots
  const result: ImportedBookmarkNode[] = []
  const keys = ['bookmark_bar', 'other', 'synced', ...Object.keys(roots).filter((key) => !(key in CHROMIUM_ROOT_LABELS))]
  for (const key of keys) {
    const node = chromiumNode(roots[key], 0)
    if (!node?.children || node.children.length === 0) continue
    result.push({ ...node, title: node.title || CHROMIUM_ROOT_LABELS[key] || key })
  }
  return result
}

/** `Local State` maps profile directories ("Default", "Profile 2") to the names people chose. */
export function parseChromiumProfileNames(value: unknown): Map<string, string> {
  const names = new Map<string, string>()
  if (!isRecord(value) || !isRecord(value.profile) || !isRecord(value.profile.info_cache)) return names
  for (const [directory, info] of Object.entries(value.profile.info_cache)) {
    const name = isRecord(info) ? text(info.name).trim() : ''
    if (name) names.set(directory, name)
  }
  return names
}

// ---------------------------------------------------------------------------
// Firefox: places.sqlite rows (moz_bookmarks joined with moz_places).

export interface FirefoxBookmarkRow {
  id: number
  type: number
  parent: number
  position: number
  title: string | null
  guid: string | null
  url: string | null
  dateAdded: number | null
}

const FIREFOX_ROOT_LABELS: Record<string, string> = {
  'toolbar_____': 'Bookmarks Toolbar',
  'menu________': 'Bookmarks Menu',
  'unfiled_____': 'Other Bookmarks',
  'mobile______': 'Mobile Bookmarks'
}
const FIREFOX_ROOT_ORDER = ['toolbar_____', 'menu________', 'unfiled_____', 'mobile______']

export function buildFirefoxBookmarkTree(rows: readonly FirefoxBookmarkRow[]): ImportedBookmarkNode[] {
  const byParent = new Map<number, FirefoxBookmarkRow[]>()
  for (const row of rows) {
    const list = byParent.get(row.parent) ?? []
    list.push(row)
    byParent.set(row.parent, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position)
  const build = (row: FirefoxBookmarkRow, depth: number): ImportedBookmarkNode | null => {
    const dateAdded = prTimeToMs(row.dateAdded)
    if (row.type === 1) return { title: row.title ?? '', url: row.url ?? '', ...(dateAdded ? { dateAdded } : {}) }
    if (row.type !== 2 || depth > 100) return null
    const children = (byParent.get(row.id) ?? []).map((child) => build(child, depth + 1)).filter((child): child is ImportedBookmarkNode => child !== null)
    return { title: row.title ?? '', children, ...(dateAdded ? { dateAdded } : {}) }
  }
  const roots = rows.filter((row) => row.guid && row.guid in FIREFOX_ROOT_LABELS)
  roots.sort((a, b) => FIREFOX_ROOT_ORDER.indexOf(a.guid!) - FIREFOX_ROOT_ORDER.indexOf(b.guid!))
  const result: ImportedBookmarkNode[] = []
  for (const root of roots) {
    const node = build(root, 0)
    if (!node?.children || node.children.length === 0) continue
    result.push({ ...node, title: FIREFOX_ROOT_LABELS[root.guid!]! })
  }
  return result
}

export interface FirefoxProfileEntry {
  name: string
  path: string
  isRelative: boolean
  isDefault: boolean
}

/** profiles.ini: [ProfileN] sections with Name/Path/IsRelative; [Install…] Default= wins as default. */
export function parseFirefoxProfilesIni(source: string): FirefoxProfileEntry[] {
  const sections: Array<{ name: string; values: Record<string, string> }> = []
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      sections.push({ name: header[1]!, values: {} })
      continue
    }
    const equals = line.indexOf('=')
    if (equals > 0 && sections.length > 0) sections.at(-1)!.values[line.slice(0, equals).trim()] = line.slice(equals + 1).trim()
  }
  const installDefaults = new Set(sections.filter((section) => section.name.startsWith('Install')).map((section) => section.values.Default).filter(Boolean))
  return sections.filter((section) => /^Profile\d+$/.test(section.name) && section.values.Path).map((section) => ({
    name: section.values.Name || section.values.Path!,
    path: section.values.Path!,
    isRelative: section.values.IsRelative !== '0',
    isDefault: installDefaults.size > 0 ? installDefaults.has(section.values.Path!) : section.values.Default === '1'
  }))
}

// ---------------------------------------------------------------------------
// Safari: ~/Library/Safari/Bookmarks.plist (binary plist, decoded by bplist.ts or plutil).

const SAFARI_FOLDER_LABELS: Record<string, string> = {
  BookmarksBar: 'Favorites',
  BookmarksMenu: 'Bookmarks Menu',
  'com.apple.ReadingList': 'Reading List'
}

function plistDate(value: PlistValue | undefined): number | undefined {
  return value instanceof Date ? reasonable(value.getTime()) : undefined
}

function safariNode(value: PlistValue | undefined, depth: number): ImportedBookmarkNode | null {
  if (!isRecord(value) || depth > 100) return null
  const record = value as Record<string, PlistValue>
  const type = record.WebBookmarkType
  if (type === 'WebBookmarkTypeLeaf') {
    const uri = isRecord(record.URIDictionary) ? record.URIDictionary as Record<string, PlistValue> : {}
    const reading = isRecord(record.ReadingList) ? record.ReadingList as Record<string, PlistValue> : {}
    const dateAdded = plistDate(reading.DateAdded)
    return { title: text(uri.title) || text(record.Title), url: text(record.URLString), ...(dateAdded ? { dateAdded } : {}) }
  }
  if (type === 'WebBookmarkTypeList') {
    const children = Array.isArray(record.Children)
      ? record.Children.map((child) => safariNode(child, depth + 1)).filter((child): child is ImportedBookmarkNode => child !== null)
      : []
    const title = text(record.Title)
    return { title: SAFARI_FOLDER_LABELS[title] ?? title, children }
  }
  // WebBookmarkTypeProxy (the History entry) and anything unknown are skipped.
  return null
}

export function parseSafariBookmarks(value: PlistValue): ImportedBookmarkNode[] {
  if (!isRecord(value) || (value as Record<string, PlistValue>).WebBookmarkType !== 'WebBookmarkTypeList') {
    throw new Error('This is not a Safari Bookmarks.plist file.')
  }
  const root = safariNode(value, 0)
  return (root?.children ?? []).filter((node) => !node.children || node.children.length > 0)
}

// ---------------------------------------------------------------------------
// Netscape bookmarks HTML (every browser imports and exports it).

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', '#39': "'" }

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  for (const match of source.matchAll(pattern)) attributes[match[1]!.toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '')
  return attributes
}

function secondsToMs(value: string | undefined): number | undefined {
  if (!value || !/^\d{1,13}$/.test(value)) return undefined
  return reasonable(Number(value) * 1000)
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

/**
 * Tolerant reader: walks <H3> folders, <A> bookmarks and <DL> nesting, ignoring everything else
 * (<DT>, <p>, <DD> descriptions, comments). An <H3> owns the next <DL> that opens.
 */
export function parseNetscapeBookmarks(html: string): ImportedBookmarkNode[] {
  const source = html.replace(/<!--[\s\S]*?-->/g, '')
  if (!/<dl[\s>]/i.test(source) && !/<a\s/i.test(source)) throw new Error('This file has no bookmarks in it.')
  const root: ImportedBookmarkNode = { title: '', children: [] }
  const stack: ImportedBookmarkNode[] = [root]
  let pendingFolder: ImportedBookmarkNode | null = null
  let seenRootList = false
  const pattern = /<(\/?)(dl|h3|a)\b([^>]*)>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const closing = match[1] === '/'
    const tag = match[2]!.toLowerCase()
    const current = stack.at(-1)!
    if (tag === 'dl') {
      if (closing) {
        if (stack.length > 1) stack.pop()
        pendingFolder = null
      } else if (pendingFolder) {
        stack.push(pendingFolder)
        pendingFolder = null
      } else if (seenRootList) {
        // A stray <DL> with no heading: treat it as an untitled folder so nothing is lost.
        const folder: ImportedBookmarkNode = { title: 'Untitled folder', children: [] }
        current.children!.push(folder)
        stack.push(folder)
      }
      seenRootList = true
      continue
    }
    if (closing) continue
    const end = source.toLowerCase().indexOf(`</${tag}`, pattern.lastIndex)
    const inner = end >= 0 ? source.slice(pattern.lastIndex, end) : ''
    if (end >= 0) pattern.lastIndex = end
    const attributes = parseAttributes(match[3] ?? '')
    const dateAdded = secondsToMs(attributes.add_date)
    if (tag === 'h3') {
      const folder: ImportedBookmarkNode = { title: stripTags(inner), children: [], ...(dateAdded ? { dateAdded } : {}) }
      current.children!.push(folder)
      pendingFolder = folder
    } else if (attributes.href !== undefined) {
      current.children!.push({ title: stripTags(inner), url: attributes.href.trim(), ...(dateAdded ? { dateAdded } : {}) })
    }
  }
  return root.children!
}

export interface NetscapeExportOptions {
  /** Folder titles to mark as the toolbar folder for browsers that honour PERSONAL_TOOLBAR_FOLDER. */
  toolbarFolderTitle?: string
}

export function exportNetscapeBookmarks(nodes: readonly ImportedBookmarkNode[], options: NetscapeExportOptions = {}): string {
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>'
  ]
  const date = (ms: number | undefined): string => ms && ms >= 1000 ? ` ADD_DATE="${Math.floor(ms / 1000)}"` : ''
  const write = (list: readonly ImportedBookmarkNode[], depth: number, topLevel: boolean): void => {
    const indent = '    '.repeat(depth)
    for (const node of list) {
      if (node.children) {
        const toolbar = topLevel && options.toolbarFolderTitle && node.title === options.toolbarFolderTitle ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ''
        lines.push(`${indent}<DT><H3${date(node.dateAdded)}${toolbar}>${escapeHtml(node.title)}</H3>`)
        lines.push(`${indent}<DL><p>`)
        write(node.children, depth + 1, false)
        lines.push(`${indent}</DL><p>`)
      } else if (node.url) {
        lines.push(`${indent}<DT><A HREF="${escapeHtml(node.url)}"${date(node.dateAdded)}>${escapeHtml(node.title)}</A>`)
      }
    }
  }
  write(nodes, 1, true)
  lines.push('</DL><p>')
  return `${lines.join('\n')}\n`
}

export function countImportedBookmarks(nodes: readonly ImportedBookmarkNode[]): number {
  let count = 0
  for (const node of nodes) count += node.children ? countImportedBookmarks(node.children) : 1
  return count
}

// ---------------------------------------------------------------------------
// IPC shapes for Settings → Import and the bookmarks manager.

export interface BookmarkImportSource {
  /** Opaque id; main re-resolves it against its own scan, so no path comes back from the renderer. */
  id: string
  browser: BookmarkImportBrowser
  browserLabel: string
  profileName: string
  hasBookmarks: boolean
  hasHistory: boolean
}

export interface BookmarkImportSummary {
  sourceLabel: string
  bookmarks: { added: number; folders: number; duplicates: number; skipped: number; folderTitle: string } | null
  history: { found: number; added: number } | null
  errors: string[]
  /** macOS: Safari data is behind Full Disk Access. */
  needsFullDiskAccess: boolean
  cancelled?: boolean
}

/** What was picked in the native bookmark/folder right-click menu. */
export type BookmarkMenuAction = 'open' | 'open-new-tab' | 'open-private' | 'open-all' | 'edit' | 'delete' | 'new-folder'
