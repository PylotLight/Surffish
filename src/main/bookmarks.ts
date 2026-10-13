import { app } from 'electron'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { deferWrite, cancelDeferredWrite } from './deferred-writes'
import { sendToMainWindowRenderers } from './browser-shell'
import {
  addBookmark,
  addBookmarkFolder,
  applyFavouriteSites,
  BOOKMARKS_ROOT_ID,
  bookmarksSnapshot,
  FAVOURITES_FOLDER_ID,
  FAVOURITES_FOLDER_TITLE,
  favouriteSites,
  findBookmarksByUrl,
  getBookmarkNode,
  importBookmarkTree,
  migratePinnedSitesToBookmarks,
  moveBookmarkNode,
  moveBookmarkNodes,
  normalizeBookmarkUrl,
  parseBookmarkStore,
  removeBookmarkNodes,
  serializeBookmarkStore,
  toImportedTree,
  updateBookmarkFavicons,
  updateBookmarkNode,
  type BookmarkImportResult,
  type BookmarkStore,
  type ImportedBookmarkNode
} from '../shared/bookmarks'
import { MAX_PINNED_SITES, parseBrowserPreferences } from '../shared/persistence'
import { exportNetscapeBookmarks } from '../shared/bookmark-import'
import type { BookmarkNode, BookmarksSnapshot, PinnedSite } from '../shared/types'

/**
 * The bookmark tree lives in its own file (bookmarks.json), written through the coalesced
 * deferred-write helper. On first run it is seeded from the old 12-site pinned strip, which
 * stays untouched in browser-preferences.json so an older build still finds it.
 */

const BOOKMARKS_FILE = 'bookmarks.json'
const LEGACY_PREFERENCES_FILE = 'browser-preferences.json'
const WRITE_DELAY_MS = 800

let store: BookmarkStore | null = null
let snapshotCache: BookmarksSnapshot | null = null
let notifyScheduled = false

function filePath(filename: string): string {
  return join(app.getPath('userData'), filename)
}

function readJsonFile(filename: string): { exists: boolean; value: unknown; error: boolean } {
  const path = filePath(filename)
  if (!existsSync(path)) return { exists: false, value: null, error: false }
  try {
    return { exists: true, value: JSON.parse(readFileSync(path, 'utf8')) as unknown, error: false }
  } catch (error) {
    console.warn(`Could not read ${filename}:`, error)
    return { exists: true, value: null, error: true }
  }
}

function writeJsonFile(filename: string, value: unknown): boolean {
  const directory = app.getPath('userData')
  const path = join(directory, filename)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(temporaryPath, JSON.stringify(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    if (process.platform !== 'win32') chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, path)
    return true
  } catch (error) {
    try { rmSync(temporaryPath, { force: true }) } catch { /* best-effort cleanup */ }
    console.error(`Could not save ${filename}:`, error)
    return false
  }
}

function legacyPinnedSites(): PinnedSite[] {
  return parseBrowserPreferences(readJsonFile(LEGACY_PREFERENCES_FILE).value).pinnedSites
}

function loadStore(): BookmarkStore {
  if (store) return store
  const saved = readJsonFile(BOOKMARKS_FILE)
  const parsed = saved.exists ? parseBookmarkStore(saved.value) : null
  if (parsed) {
    store = parsed
    return store
  }
  if (saved.exists) {
    // Keep an unreadable file aside instead of overwriting someone's bookmarks with an empty tree.
    try {
      renameSync(filePath(BOOKMARKS_FILE), filePath(`${BOOKMARKS_FILE}.unreadable-${Date.now()}`))
    } catch (error) {
      console.error('Could not set aside the unreadable bookmarks file:', error)
    }
  }
  store = migratePinnedSitesToBookmarks(legacyPinnedSites())
  writeJsonFile(BOOKMARKS_FILE, serializeBookmarkStore(store))
  return store
}

function persist(): void {
  snapshotCache = null
  const current = store
  if (!current) return
  deferWrite('bookmarks', () => writeJsonFile(BOOKMARKS_FILE, serializeBookmarkStore(current)), WRITE_DELAY_MS)
  scheduleNotify()
}

function scheduleNotify(): void {
  if (notifyScheduled) return
  notifyScheduled = true
  // Batch a burst of edits (drag + drop, multi-delete) into one renderer update.
  setImmediate(() => {
    notifyScheduled = false
    sendToMainWindowRenderers('browser:bookmarks-changed', getBookmarksSnapshot())
  })
}

/** Run a mutation, then queue the write and the renderer update (nothing is saved if it throws). */
function mutate<T>(change: (current: BookmarkStore) => T): T {
  const result = change(loadStore())
  persist()
  return result
}

export function getBookmarksSnapshot(): BookmarksSnapshot {
  if (!snapshotCache) snapshotCache = bookmarksSnapshot(loadStore())
  return snapshotCache
}

/** The sidebar strip / new tab favourites: the first 12 bookmarks in Favourites. */
export function getFavouriteSites(): PinnedSite[] {
  return favouriteSites(loadStore(), MAX_PINNED_SITES)
}

/** Legacy pinned-sites API: replace the visible strip. */
export function saveFavouriteSites(sites: readonly PinnedSite[]): PinnedSite[] {
  mutate((current) => applyFavouriteSites(current, sites, MAX_PINNED_SITES))
  return getFavouriteSites()
}

export function findBookmarksForUrl(url: string): BookmarkNode[] {
  return findBookmarksByUrl(loadStore(), url)
}

export function isUrlBookmarked(url: string): boolean {
  return findBookmarksForUrl(url).length > 0
}

export interface CreateBookmarkRequest {
  parentId?: unknown
  title?: unknown
  url?: unknown
  index?: unknown
  faviconUrl?: unknown
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalIndex(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

export function createBookmark(request: CreateBookmarkRequest): BookmarkNode {
  if (typeof request.url !== 'string') throw new Error('Only http(s) addresses can be bookmarked.')
  return mutate((current) => addBookmark(current, {
    parentId: optionalString(request.parentId),
    title: optionalString(request.title),
    url: request.url as string,
    index: optionalIndex(request.index),
    faviconUrl: optionalString(request.faviconUrl)
  }))
}

export function createBookmarkFolder(request: { parentId?: unknown; title?: unknown; index?: unknown }): BookmarkNode {
  return mutate((current) => addBookmarkFolder(current, {
    parentId: optionalString(request.parentId),
    title: optionalString(request.title),
    index: optionalIndex(request.index)
  }))
}

export function editBookmark(id: unknown, patch: { title?: unknown; url?: unknown; parentId?: unknown }): BookmarkNode {
  if (typeof id !== 'string') throw new Error('That bookmark no longer exists.')
  return mutate((current) => {
    let node = updateBookmarkNode(current, id, { title: patch.title, url: patch.url })
    if (typeof patch.parentId === 'string' && patch.parentId !== node.parentId) node = moveBookmarkNode(current, id, patch.parentId)
    return node
  })
}

export function moveBookmarks(ids: unknown, parentId: unknown, index?: unknown): number {
  if (!Array.isArray(ids) || typeof parentId !== 'string') return 0
  const list = ids.filter((id): id is string => typeof id === 'string').slice(0, 10_000)
  // `index` is the slot in the target folder as it looks now (before the dragged items leave it).
  return mutate((current) => moveBookmarkNodes(current, list, parentId, optionalIndex(index)))
}

export function deleteBookmarks(ids: unknown): number {
  if (!Array.isArray(ids)) return 0
  const list = ids.filter((id): id is string => typeof id === 'string').slice(0, 10_000)
  return mutate((current) => removeBookmarkNodes(current, list))
}

/** Star / Cmd+D: bookmark the page into Favourites (or return the existing bookmark). */
export function bookmarkPage(url: string, title: string, faviconUrl: string | null, isPrivate: boolean): { node: BookmarkNode; created: boolean } | null {
  if (!normalizeBookmarkUrl(url)) return null
  const existing = findBookmarksForUrl(url)[0]
  if (existing) return { node: existing, created: false }
  // Private tabs may bookmark on an explicit action, but never leave a favicon behind.
  const node = createBookmark({ parentId: FAVOURITES_FOLDER_ID, title, url, faviconUrl: isPrivate ? undefined : faviconUrl ?? undefined })
  return { node, created: true }
}

/** Tab menu "Remove Bookmark": drop every bookmark of that exact page. */
export function removeBookmarksForUrl(url: string): number {
  const ids = findBookmarksForUrl(url).map((node) => node.id)
  return ids.length > 0 ? deleteBookmarks(ids) : 0
}

/** Cmd+Shift+D: a new top-level folder holding every given page. */
export function bookmarkPagesInNewFolder(pages: ReadonlyArray<{ url: string; title: string }>, folderTitle: string): { folder: BookmarkNode; added: number } | null {
  const valid = pages.filter((page) => normalizeBookmarkUrl(page.url))
  if (valid.length === 0) return null
  return mutate((current) => {
    const folder = addBookmarkFolder(current, { parentId: BOOKMARKS_ROOT_ID, title: folderTitle })
    for (const page of valid) addBookmark(current, { parentId: folder.id, title: page.title, url: page.url })
    return { folder: getBookmarkNode(current, folder.id)!, added: valid.length }
  })
}

/** Called for non-private page loads only (see persistPageFavicon). */
export function recordBookmarkFavicon(pageUrl: string, faviconUrl: string): void {
  const current = loadStore()
  if (updateBookmarkFavicons(current, pageUrl, faviconUrl)) persist()
}

export function importBookmarks(sourceLabel: string, items: readonly ImportedBookmarkNode[]): BookmarkImportResult {
  return mutate((current) => importBookmarkTree(current, sourceLabel, items))
}

export function exportBookmarksHtml(): string {
  return exportNetscapeBookmarks(toImportedTree(loadStore()), { toolbarFolderTitle: FAVOURITES_FOLDER_TITLE })
}

/** Flush now (tests / quit paths); normal edits go through deferWrite. */
export function flushBookmarks(): void {
  cancelDeferredWrite('bookmarks')
  if (store) writeJsonFile(BOOKMARKS_FILE, serializeBookmarkStore(store))
}
