import { app, ipcMain, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  archiveAfterMs,
  archiveBlocker,
  findDuplicateTabs,
  findOpenTabForUrl,
  sanitizeArchivedTab,
  selectTabsToArchive,
  tabActivitySnapshot,
  TAB_ARCHIVE_CHECK_INTERVAL_MS,
  type ArchivedTab,
  type TabArchiveCandidate
} from '../shared/tab-archive'
import { isSearchEngineId, SURFFISH_QUICK_LINKS_URL } from '../shared/navigation'
import type { SearchEngineId } from '../shared/types'
import {
  activateBrowserTab,
  captureBrowserTabForArchive,
  closeBrowserTab,
  closeBrowserTabForArchive,
  flashBrowserStatus,
  getBrowserTabArchiveCandidates,
  getBrowserTabIdsInSameWindow,
  getBrowserTabs,
  openArchivedBrowserTab,
  setBrowserTabMenuExtras
} from './browser'
import { isMainWindowRenderer } from './browser-shell'
import { resolveAddressInput } from './search-keywords'
import {
  addToArchive,
  clearArchive,
  getArchivedTab,
  getArchivedTabs,
  getTabArchiveSettings,
  getTabArchiveSnapshot,
  recordTabActivity,
  removeFromArchive,
  setTabArchiveSettings
} from './tab-archive-store'

/**
 * Tab archive (Arc-style) and tab tidying: idle tabs close into the Archived list, Archive Tab /
 * Archive Other Tabs, restore, Close Duplicate Tabs and "switch to the open tab" from the omnibox.
 * browser.ts only exposes small hooks; the rules live in shared/tab-archive.ts.
 */

let checkTimer: ReturnType<typeof setInterval> | null = null

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Close tabs into the archive. Returns how many were archived. */
export function archiveBrowserTabs(ids: readonly string[], reason: ArchivedTab['reason']): number {
  const now = Date.now()
  const archived: ArchivedTab[] = []
  for (const id of ids) {
    const capture = captureBrowserTabForArchive(id)
    if (!capture) continue
    const entry = sanitizeArchivedTab({ id: randomUUID(), ...capture, archivedAt: now, reason })
    // Closing can be refused (unsaved PDF edits prompt); only archive what actually closed.
    if (!closeBrowserTabForArchive(id)) continue
    if (entry) archived.push(entry)
  }
  addToArchive(archived)
  return archived.length
}

function candidate(id: string): TabArchiveCandidate | undefined {
  return getBrowserTabArchiveCandidates().find((tab) => tab.id === id)
}

export function canArchiveBrowserTab(id: string | undefined): boolean {
  const tab = id ? candidate(id) : undefined
  return Boolean(tab && archiveBlocker(tab, true) === null)
}

export function archiveBrowserTab(id: string | undefined): boolean {
  if (!id || !canArchiveBrowserTab(id)) return false
  const count = archiveBrowserTabs([id], 'manual')
  if (count > 0) flashBrowserStatus('Tab archived · restore it from Archived in the sidebar')
  return count > 0
}

/** Everything but `keepId` that auto-archive could take (pinned, audible, private, unsaved-PDF tabs stay). */
function otherArchivableTabs(keepId: string): string[] {
  // "Other tabs" are the other tabs of the same window; other windows are left alone.
  const sameWindow = new Set(getBrowserTabIdsInSameWindow(keepId))
  return getBrowserTabArchiveCandidates()
    .filter((tab) => tab.id !== keepId && sameWindow.has(tab.id) && !tab.pinned && archiveBlocker({ ...tab, active: false }, false) === null)
    .map((tab) => tab.id)
}

export function canArchiveOtherBrowserTabs(keepId: string | undefined): boolean {
  return Boolean(keepId && otherArchivableTabs(keepId).length > 0)
}

export function archiveOtherBrowserTabs(keepId: string | undefined): number {
  if (!keepId) return 0
  const count = archiveBrowserTabs(otherArchivableTabs(keepId), 'manual')
  flashBrowserStatus(count > 0 ? `Archived ${plural(count, 'tab')}` : 'No other tabs to archive')
  return count
}

/** One auto-archive pass. Cheap: a walk over the tab list, no page access unless something is due. */
export function runTabArchiveCheck(now = Date.now()): number {
  const candidates = getBrowserTabArchiveCandidates()
  recordTabActivity(tabActivitySnapshot(candidates, now))
  const ids = selectTabsToArchive(candidates, now, archiveAfterMs(getTabArchiveSettings().archiveAfter))
  if (ids.length === 0) return 0
  return archiveBrowserTabs(ids, 'auto')
}

export function restoreArchivedTab(id: unknown, activate = true): string | null {
  if (typeof id !== 'string') return null
  const entry = getArchivedTab(id)
  if (!entry) return null
  // Already open (restored before, or opened again since): just switch to it.
  const open = findOpenTabForUrl(getBrowserTabs(), entry.url)
  const tabId = open ? (activate && activateBrowserTab(open.id), open.id) : openArchivedBrowserTab(entry.url, entry.history, activate)
  if (tabId) removeFromArchive([id])
  return tabId
}

export function restoreLastArchivedTab(): string | null {
  const latest = getArchivedTabs()[0]
  return latest ? restoreArchivedTab(latest.id) : null
}

/** Restore everything (or the given ids); the newest becomes the active tab, the rest open asleep. */
export function restoreArchivedTabs(ids?: unknown): number {
  const wanted = Array.isArray(ids) ? new Set(ids.filter((id): id is string => typeof id === 'string')) : null
  const entries = getArchivedTabs().filter((tab) => !wanted || wanted.has(tab.id))
  let restored = 0
  // Oldest first so the newest ends up last in the tab list and active.
  entries.reverse().forEach((entry, index) => {
    if (restoreArchivedTab(entry.id, index === entries.length - 1)) restored += 1
  })
  return restored
}

export function closeDuplicateBrowserTabs(): number {
  const ids = findDuplicateTabs(getBrowserTabs())
  // Plain closes, so Reopen Closed Tab can bring one back.
  for (const id of ids) closeBrowserTab(id)
  flashBrowserStatus(ids.length > 0 ? `Closed ${plural(ids.length, 'duplicate tab')}` : 'No duplicate tabs')
  return ids.length
}

export function hasDuplicateBrowserTabs(): boolean {
  return findDuplicateTabs(getBrowserTabs()).length > 0
}

/**
 * Omnibox submit with "switch to open tab" on: when the typed address is already open in another
 * tab, switch there instead of loading it again. A blank New Tab you typed into is closed.
 */
export function switchToOpenTabForInput(input: unknown, engine?: SearchEngineId): boolean {
  if (typeof input !== 'string' || !getTabArchiveSettings().switchToOpenTab) return false
  const url = resolveAddressInput(input, engine)
  if (!url) return false
  const tabs = getBrowserTabs()
  const active = tabs.find((tab) => tab.active)
  const match = findOpenTabForUrl(tabs, url, { excludeId: active?.id ?? null, private: active?.private ?? false })
  if (!match) return false
  activateBrowserTab(match.id)
  if (active && active.url === SURFFISH_QUICK_LINKS_URL) closeBrowserTabForArchive(active.id)
  return true
}

function tabMenuItems(id: string): MenuItemConstructorOptions[] {
  return [
    { label: 'Archive Tab', enabled: canArchiveBrowserTab(id), click: () => { archiveBrowserTab(id) } },
    { label: 'Archive Other Tabs', enabled: canArchiveOtherBrowserTabs(id), click: () => { archiveOtherBrowserTabs(id) } },
    { label: 'Close Duplicate Tabs', enabled: hasDuplicateBrowserTabs(), click: () => { closeDuplicateBrowserTabs() } },
    { type: 'separator' }
  ]
}

export function initializeTabArchive(): void {
  setBrowserTabMenuExtras(tabMenuItems)
  if (checkTimer) return
  checkTimer = setInterval(() => {
    try {
      runTabArchiveCheck()
    } catch (error) {
      console.warn('Tab archive check failed:', error)
    }
  }, TAB_ARCHIVE_CHECK_INTERVAL_MS)
  checkTimer.unref?.()
  // Save last-used times on the way out so idle time keeps counting across restarts.
  app.on('before-quit', () => {
    try {
      recordTabActivity(tabActivitySnapshot(getBrowserTabArchiveCandidates(), Date.now()))
    } catch {
      // Window already gone; the last periodic snapshot stands.
    }
  })
}

export function disposeTabArchive(): void {
  if (checkTimer) clearInterval(checkTimer)
  checkTimer = null
  setBrowserTabMenuExtras(null)
}

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) {
    throw new Error('This browser operation is available only to the app window.')
  }
}

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 1000) : []
}

export function registerTabArchiveIpc(): void {
  ipcMain.handle('browser:tab-archive:get', (event) => {
    assertMainRenderer(event)
    return getTabArchiveSnapshot()
  })
  ipcMain.handle('browser:tab-archive:settings:set', (event, patch: unknown) => {
    assertMainRenderer(event)
    const settings = setTabArchiveSettings(patch)
    // Turning it on (or shortening it) acts now rather than up to 10 minutes later.
    runTabArchiveCheck()
    return settings
  })
  ipcMain.handle('browser:tab-archive:archive', (event, id: unknown) => {
    assertMainRenderer(event)
    return typeof id === 'string' ? archiveBrowserTab(id) : false
  })
  ipcMain.handle('browser:tab-archive:restore', (event, id: unknown) => {
    assertMainRenderer(event)
    return restoreArchivedTab(id)
  })
  ipcMain.handle('browser:tab-archive:restore-all', (event, ids: unknown) => {
    assertMainRenderer(event)
    return restoreArchivedTabs(ids === undefined ? undefined : idList(ids))
  })
  ipcMain.handle('browser:tab-archive:delete', (event, ids: unknown) => {
    assertMainRenderer(event)
    return removeFromArchive(idList(ids))
  })
  ipcMain.handle('browser:tab-archive:clear', (event) => {
    assertMainRenderer(event)
    return clearArchive()
  })
  ipcMain.handle('browser:tab-archive:switch-to-open-tab', (event, input: unknown, engine: unknown) => {
    assertMainRenderer(event)
    return switchToOpenTabForInput(input, isSearchEngineId(engine) ? engine : undefined)
  })
}
