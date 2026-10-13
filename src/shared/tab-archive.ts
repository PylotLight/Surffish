/**
 * Tab archive (Arc-style): unused tabs close themselves into an "Archived" list you can search and
 * restore, plus duplicate-tab detection. Pure, so main, the renderers and the unit tests share it.
 */
import { normalizeCachedFaviconDataUrl, normalizeFaviconUrl, normalizeSessionUrl } from './persistence'
import { matchFields } from './command-palette'

export type TabArchiveAfter = 'off' | '12h' | '24h' | '7d'

export const TAB_ARCHIVE_AFTER_MS: Record<Exclude<TabArchiveAfter, 'off'>, number> = {
  '12h': 12 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000
}
export const TAB_ARCHIVE_AFTER_OPTIONS: readonly TabArchiveAfter[] = ['off', '12h', '24h', '7d']
/** Default when the user accepts the one-time prompt. */
export const SUGGESTED_TAB_ARCHIVE_AFTER: TabArchiveAfter = '24h'
export const MAX_ARCHIVED_TABS = 500
/** Only the newest entries keep their page state (scroll position, form state); older ones keep URLs only. */
export const MAX_ARCHIVED_WITH_PAGE_STATE = 100
export const MAX_ARCHIVED_HISTORY_ENTRIES = 10
export const MAX_ARCHIVED_PAGE_STATE_CHARS = 16 * 1024
const MAX_ARCHIVED_FAVICON_DATA_CHARS = 8 * 1024
const MAX_TITLE_CHARS = 300
/** How often main looks for tabs to archive. */
export const TAB_ARCHIVE_CHECK_INTERVAL_MS = 10 * 60_000

export interface TabArchiveSettings {
  archiveAfter: TabArchiveAfter
  /** The one-time "turn on auto-archive?" prompt in Settings was answered (either way). */
  prompted: boolean
  /** Typing the address of an already open tab in the omnibox switches to that tab instead. */
  switchToOpenTab: boolean
}

export const DEFAULT_TAB_ARCHIVE_SETTINGS: TabArchiveSettings = { archiveAfter: 'off', prompted: false, switchToOpenTab: false }

export interface ArchivedHistoryEntry {
  url: string
  title: string
  /** Chromium page state (scroll position, form values); current entry only and size-capped. */
  pageState?: string
}

export interface ArchivedTab {
  id: string
  url: string
  title: string
  faviconUrl: string | null
  archivedAt: number
  reason: 'auto' | 'manual'
  /** Back/forward list at archive time, when the tab was loaded (sleeping tabs only have their URL). */
  history?: { entries: ArchivedHistoryEntry[]; index: number }
}

export interface TabArchiveSnapshot {
  settings: TabArchiveSettings
  /** Newest first. */
  tabs: ArchivedTab[]
}

/** What main knows about an open tab when deciding whether it may be archived. */
export interface TabArchiveCandidate {
  id: string
  url: string
  pinned: boolean
  active: boolean
  audible: boolean
  private: boolean
  /** Extension UI page (needs its preload wiring; can't be brought back from a URL). */
  extensionPage: boolean
  /** Open in the PDF editor with unsaved edits. */
  unsavedPdfEdits: boolean
  /** When the tab stopped being the active tab; null while it is active. */
  inactiveSince: number | null
}

export type ArchiveBlocker = 'pinned' | 'active' | 'audible' | 'private' | 'extension' | 'pdf-edits' | 'not-web'

export function isTabArchiveAfter(value: unknown): value is TabArchiveAfter {
  return typeof value === 'string' && (TAB_ARCHIVE_AFTER_OPTIONS as readonly string[]).includes(value)
}

export function archiveAfterMs(value: TabArchiveAfter): number | null {
  return value === 'off' ? null : TAB_ARCHIVE_AFTER_MS[value]
}

export function archiveAfterLabel(value: TabArchiveAfter): string {
  return value === 'off' ? 'Never' : value === '12h' ? 'After 12 hours' : value === '24h' ? 'After a day' : 'After a week'
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * Why a tab can't be archived, or null when it can. Auto-archive never touches pinned, active,
 * audible, private, extension or unsaved-PDF tabs. `manual` (Archive Tab in the menu / palette) is the
 * user asking, so pinned, active and audible tabs may go, and unsaved PDF edits get the usual
 * discard prompt from closing; private tabs are still never persisted.
 */
export function archiveBlocker(tab: TabArchiveCandidate, manual = false): ArchiveBlocker | null {
  if (tab.private) return 'private'
  if (tab.extensionPage) return 'extension'
  if (!isWebUrl(tab.url)) return 'not-web'
  if (tab.unsavedPdfEdits && !manual) return 'pdf-edits'
  if (manual) return null
  if (tab.pinned) return 'pinned'
  if (tab.active) return 'active'
  if (tab.audible) return 'audible'
  return null
}

/** Tabs auto-archive should close now: eligible and not activated for at least `afterMs`. */
export function selectTabsToArchive(tabs: readonly TabArchiveCandidate[], now: number, afterMs: number | null): string[] {
  if (afterMs === null || !(afterMs > 0)) return []
  return tabs.flatMap((tab) => {
    if (tab.inactiveSince === null || archiveBlocker(tab) !== null) return []
    return now - tab.inactiveSince >= afterMs ? [tab.id] : []
  })
}

// ---------------------------------------------------------------------------
// Duplicates

/** Two tabs are duplicates when their URLs match ignoring the #fragment (and a trailing-slash-only path). */
export function duplicateKey(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url.replace(/#.*$/, '')
  }
}

export interface DuplicateCandidate {
  id: string
  url: string
  active: boolean
  pinned: boolean
  private: boolean
}

/**
 * Ids to close so each URL is open once. Private and regular tabs are never merged with each other.
 * The tab kept per URL is the active one, else a pinned one, else the first in order.
 */
export function findDuplicateTabs(tabs: readonly DuplicateCandidate[]): string[] {
  const groups = new Map<string, DuplicateCandidate[]>()
  for (const tab of tabs) {
    if (!isWebUrl(tab.url)) continue
    const key = `${tab.private ? 'p' : 'r'}|${duplicateKey(tab.url)}`
    const group = groups.get(key)
    if (group) group.push(tab)
    else groups.set(key, [tab])
  }
  const close: string[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const keep = group.find((tab) => tab.active) ?? group.find((tab) => tab.pinned) ?? group[0]!
    for (const tab of group) if (tab !== keep && !tab.pinned) close.push(tab.id)
  }
  return close
}

/** The open tab (other than `excludeId`) already showing `url`, for "switch to tab" in the omnibox. */
export function findOpenTabForUrl<T extends DuplicateCandidate>(tabs: readonly T[], url: string, options: { excludeId?: string | null; private?: boolean } = {}): T | null {
  if (!isWebUrl(url)) return null
  const key = duplicateKey(url)
  return tabs.find((tab) => tab.id !== options.excludeId && tab.private === Boolean(options.private) && duplicateKey(tab.url) === key) ?? null
}

// ---------------------------------------------------------------------------
// The archived list

function cleanTitle(value: unknown, fallback: string): string {
  const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS) : ''
  return title || fallback
}

function cleanFavicon(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.startsWith('data:')) return value.length <= MAX_ARCHIVED_FAVICON_DATA_CHARS ? normalizeCachedFaviconDataUrl(value) : null
  return normalizeFaviconUrl(value)
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || url
  } catch {
    return url
  }
}

function cleanHistory(value: unknown, currentUrl: string): ArchivedTab['history'] | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { entries?: unknown; index?: unknown }
  if (!Array.isArray(record.entries) || typeof record.index !== 'number' || !Number.isInteger(record.index)) return undefined
  const raw = record.entries
  const index = Math.min(Math.max(record.index, 0), raw.length - 1)
  // Keep a window of entries around the current one (mostly the back list).
  const start = Math.max(0, Math.min(index - (MAX_ARCHIVED_HISTORY_ENTRIES - 3), raw.length - MAX_ARCHIVED_HISTORY_ENTRIES))
  const entries: ArchivedHistoryEntry[] = []
  let newIndex = -1
  raw.slice(start, start + MAX_ARCHIVED_HISTORY_ENTRIES).forEach((item, offset) => {
    if (typeof item !== 'object' || item === null) return
    const entry = item as { url?: unknown; title?: unknown; pageState?: unknown }
    const url = normalizeSessionUrl(entry.url)
    if (!url) return
    const isCurrent = start + offset === index
    const next: ArchivedHistoryEntry = { url, title: cleanTitle(entry.title, hostLabel(url)) }
    // Page state belongs to the exact URL it was recorded for; a cleaned URL drops it.
    if (isCurrent && typeof entry.pageState === 'string' && entry.pageState.length <= MAX_ARCHIVED_PAGE_STATE_CHARS && url === entry.url) next.pageState = entry.pageState
    if (isCurrent) newIndex = entries.length
    entries.push(next)
  })
  if (newIndex < 0 || entries.length < 2 && !entries[0]?.pageState) return undefined
  if (entries[newIndex]!.url !== currentUrl) return undefined
  return { entries, index: newIndex }
}

/** Validate one stored or freshly captured entry; null when it isn't restorable. */
export function sanitizeArchivedTab(value: unknown): ArchivedTab | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const url = normalizeSessionUrl(record.url)
  if (!url) return null
  const id = typeof record.id === 'string' && /^[\w-]{1,64}$/.test(record.id) ? record.id : null
  const archivedAt = typeof record.archivedAt === 'number' && Number.isFinite(record.archivedAt) && record.archivedAt > 0 ? Math.round(record.archivedAt) : null
  if (!id || archivedAt === null) return null
  const tab: ArchivedTab = {
    id,
    url,
    title: cleanTitle(record.title, hostLabel(url)),
    faviconUrl: cleanFavicon(record.faviconUrl),
    archivedAt,
    reason: record.reason === 'manual' ? 'manual' : 'auto'
  }
  const history = cleanHistory(record.history, url)
  if (history) tab.history = history
  return tab
}

function stripPageState(tab: ArchivedTab): ArchivedTab {
  if (!tab.history?.entries.some((entry) => entry.pageState !== undefined)) return tab
  return { ...tab, history: { index: tab.history.index, entries: tab.history.entries.map(({ url, title }) => ({ url, title })) } }
}

/** Newest first, one entry per URL (ignoring #fragments), capped; the oldest fall off the end. */
export function normalizeArchivedList(tabs: readonly ArchivedTab[], cap = MAX_ARCHIVED_TABS): ArchivedTab[] {
  const sorted = [...tabs].sort((a, b) => b.archivedAt - a.archivedAt)
  const seenUrls = new Set<string>()
  const seenIds = new Set<string>()
  const result: ArchivedTab[] = []
  for (const tab of sorted) {
    const key = duplicateKey(tab.url)
    if (seenUrls.has(key) || seenIds.has(tab.id)) continue
    seenUrls.add(key)
    seenIds.add(tab.id)
    result.push(result.length >= MAX_ARCHIVED_WITH_PAGE_STATE ? stripPageState(tab) : tab)
    if (result.length >= cap) break
  }
  return result
}

/** Add freshly archived tabs (re-archiving a URL moves it to the top). */
export function addArchivedTabs(list: readonly ArchivedTab[], added: readonly ArchivedTab[], cap = MAX_ARCHIVED_TABS): ArchivedTab[] {
  return normalizeArchivedList([...added, ...list], cap)
}

export function parseArchivedTabs(value: unknown): ArchivedTab[] {
  if (!Array.isArray(value)) return []
  return normalizeArchivedList(value.flatMap((item) => {
    const tab = sanitizeArchivedTab(item)
    return tab ? [tab] : []
  }))
}

export function parseTabArchiveSettings(value: unknown): TabArchiveSettings {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    archiveAfter: isTabArchiveAfter(record.archiveAfter) ? record.archiveAfter : DEFAULT_TAB_ARCHIVE_SETTINGS.archiveAfter,
    prompted: record.prompted === true,
    switchToOpenTab: record.switchToOpenTab === true
  }
}

/** Patch from the renderer; unknown or invalid fields are ignored. */
export function applyTabArchiveSettingsPatch(current: TabArchiveSettings, patch: unknown): TabArchiveSettings {
  if (typeof patch !== 'object' || patch === null) return current
  const record = patch as Record<string, unknown>
  return {
    archiveAfter: isTabArchiveAfter(record.archiveAfter) ? record.archiveAfter : current.archiveAfter,
    prompted: typeof record.prompted === 'boolean' ? record.prompted : current.prompted,
    switchToOpenTab: typeof record.switchToOpenTab === 'boolean' ? record.switchToOpenTab : current.switchToOpenTab
  }
}

// ---------------------------------------------------------------------------
// Last-activity times survive restarts (keyed by URL, since tab ids are per launch)

export const MAX_TRACKED_ACTIVITY = 1000

export function parseTabActivity(value: unknown): Map<string, number> {
  const map = new Map<string, number>()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return map
  for (const [url, at] of Object.entries(value as Record<string, unknown>)) {
    if (map.size >= MAX_TRACKED_ACTIVITY) break
    if (typeof at === 'number' && Number.isFinite(at) && at > 0 && isWebUrl(url)) map.set(duplicateKey(url), at)
  }
  return map
}

/** Most recent "last used" time per URL for the open tabs (an active tab counts as used now). */
export function tabActivitySnapshot(tabs: readonly TabArchiveCandidate[], now: number): Record<string, number> {
  const result: Record<string, number> = {}
  let count = 0
  for (const tab of tabs) {
    if (tab.private || !isWebUrl(tab.url) || count >= MAX_TRACKED_ACTIVITY) continue
    const key = duplicateKey(tab.url)
    const at = tab.inactiveSince ?? now
    if (result[key] === undefined) count += 1
    result[key] = Math.max(result[key] ?? 0, at)
  }
  return result
}

/** A restored tab's inactive-since time: what was saved, never in the future, else `fallback`. */
export function restoredInactiveSince(activity: ReadonlyMap<string, number>, url: string, fallback: number): number {
  const saved = activity.get(duplicateKey(url))
  return saved !== undefined && saved <= fallback ? saved : fallback
}

// ---------------------------------------------------------------------------
// Search

export function searchArchivedTabs(tabs: readonly ArchivedTab[], query: string): ArchivedTab[] {
  const trimmed = query.trim()
  if (!trimmed) return [...tabs]
  return tabs
    .map((tab, index) => ({ tab, index, score: matchFields(trimmed, [tab.title, hostLabel(tab.url), tab.url], [1, 0.9, 0.5]) }))
    .filter((item): item is { tab: ArchivedTab; index: number; score: number } => item.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.tab)
}

/** "5m ago", "3h ago", "2d ago", or a short date. */
export function formatArchivedAge(archivedAt: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - archivedAt) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days}d ago`
  return new Date(archivedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
