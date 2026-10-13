import { ipcMain } from 'electron'
import type { BaseWindow, WebContents } from 'electron'
import type { BrowserState, BrowserTabSummary } from '../shared/types'
import { diffTabs, FAVICON_REF_PREFIX, type TabSyncState } from '../shared/tab-broadcast'
import { getShellWindowFor, getWindowRenderers, isMainWindowRenderer } from './browser-shell'

/**
 * Per-surface senders for `browser:tabs` (diffs, see shared/tab-broadcast) and `browser:state`
 * (skipped when byte-identical to the last one that surface got).
 */

interface SurfaceSnapshot {
  tabs: TabSyncState | null
  stateJson: string | null
}

const snapshots = new WeakMap<WebContents, SurfaceSnapshot>()

// Inline favicons get a short ref; the data crosses IPC once per surface while some tab uses it.
const MAX_ICON_REFS = 256
const refByIcon = new Map<string, string>()
const iconByRef = new Map<string, string>()
let nextIconRef = 1

function iconRef(dataUrl: string): string {
  const known = refByIcon.get(dataUrl)
  if (known) {
    // Keep recently used icons at the end of the eviction order.
    refByIcon.delete(dataUrl)
    refByIcon.set(dataUrl, known)
    return known
  }
  const ref = `${FAVICON_REF_PREFIX}${nextIconRef++}`
  refByIcon.set(dataUrl, ref)
  iconByRef.set(ref, dataUrl)
  while (refByIcon.size > MAX_ICON_REFS) {
    const [oldest, oldRef] = refByIcon.entries().next().value as [string, string]
    refByIcon.delete(oldest)
    iconByRef.delete(oldRef)
  }
  return ref
}

function encodeTabs(tabs: readonly BrowserTabSummary[]): BrowserTabSummary[] {
  return tabs.map((tab) => tab.faviconUrl?.startsWith('data:') ? { ...tab, faviconUrl: iconRef(tab.faviconUrl) } : tab)
}

function snapshotOf(contents: WebContents): SurfaceSnapshot {
  let snapshot = snapshots.get(contents)
  if (!snapshot) {
    snapshot = { tabs: null, stateJson: null }
    snapshots.set(contents, snapshot)
  }
  return snapshot
}

export function sendTabsToWindowRenderers(window: BaseWindow, tabs: readonly BrowserTabSummary[]): void {
  const encoded = encodeTabs(tabs)
  for (const contents of getWindowRenderers(window)) {
    const snapshot = snapshotOf(contents)
    const { patch, state } = diffTabs(snapshot.tabs, encoded, (ref) => iconByRef.get(ref))
    snapshot.tabs = state
    if (patch) contents.send('browser:tabs', patch)
  }
}

export function sendStateToWindowRenderers(window: BaseWindow, state: BrowserState): void {
  const json = JSON.stringify(state)
  for (const contents of getWindowRenderers(window)) {
    const snapshot = snapshotOf(contents)
    if (snapshot.stateJson === json) continue
    snapshot.stateJson = json
    contents.send('browser:state', state)
  }
}

let resyncHandler: ((window: BaseWindow) => void) | null = null

/** A surface (re)loaded and lost its tab list: forget what it was sent and send it the full list. */
export function setTabResyncHandler(handler: (window: BaseWindow) => void): void {
  resyncHandler = handler
}

ipcMain.on('browser:tabs:resync', (event) => {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) return
  const snapshot = snapshots.get(event.sender)
  if (snapshot) {
    snapshot.tabs = null
    snapshot.stateJson = null
  }
  const window = getShellWindowFor(event.sender)
  if (window && !window.isDestroyed()) resyncHandler?.(window)
})
