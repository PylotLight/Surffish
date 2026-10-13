import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isMainWindowRenderer, sendToMainWindowRenderers, setBrowserChromeState } from './browser-shell'
import { getMainWindow } from './window'

/**
 * The always-loaded half of Feeds: IPC handlers and "open the Feeds view". The feed store, poller,
 * parser and network code live in ./feeds, which loads after the first window paints (or on the
 * first IPC call, whichever comes first), so launch never pays for it.
 */
type FeedsModule = typeof import('./feeds')
let feedsModule: Promise<FeedsModule> | null = null

export function loadFeeds(): Promise<FeedsModule> {
  feedsModule ??= import('./feeds')
  feedsModule.catch(() => { feedsModule = null })
  return feedsModule
}

/** After the first paint: read feeds.json and arm the poller (no timer when nothing is followed). */
export function startFeedsAfterFirstPaint(): void {
  void loadFeeds().then((module) => module.initializeFeeds()).catch((error: unknown) => console.warn('Could not start feeds:', error))
}

export function disposeFeeds(): void {
  // Only if it was ever loaded: quitting must not import it.
  void feedsModule?.then((module) => module.disposeFeeds()).catch(() => undefined)
}

/** Show Settings → Integrations → Feeds; `discover` asks the view to look for feeds on the current page. */
export function revealFeeds(options: { discover?: boolean; feedId?: string } = {}): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  setBrowserChromeState({ sidebarMode: 'feeds' })
  if (options.discover || options.feedId) {
    // Let the section mount before asking it.
    setTimeout(() => {
      try { sendToMainWindowRenderers('browser:feeds:reveal', { discover: options.discover === true, feedId: options.feedId ?? null }) } catch { /* window closing */ }
    }, 200)
  }
}

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) throw new Error('Feeds are available only to the app window.')
}

/** Validation and fetch failures come back as { ok: false, error }; only a wrong sender throws. */
function failure(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

export function registerFeedIpc(): void {
  const handle = (channel: string, run: (module: FeedsModule, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      assertMainRenderer(event)
      try {
        return await run(await loadFeeds(), ...args)
      } catch (error) {
        console.warn(`[feeds] ${channel} failed:`, error)
        return failure(error)
      }
    })
  }
  handle('browser:feeds:list', (module) => module.feedsSnapshot())
  handle('browser:feeds:items', (module, feedId, options) => module.feedItems(feedId, options))
  handle('browser:feeds:add', (module, input) => module.addFeed(input))
  handle('browser:feeds:update', (module, id, patch) => module.updateFeed(id, patch))
  handle('browser:feeds:remove', (module, id) => module.removeFeed(id))
  handle('browser:feeds:refresh', (module, id) => module.refreshFeeds(id))
  handle('browser:feeds:mark-read', (module, feedId, itemKey) => module.markRead(feedId, itemKey))
  handle('browser:feeds:open-item', (module, feedId, itemKey) => module.openFeedItem(feedId, itemKey))
  handle('browser:feeds:discover', (module) => module.discoverFeedsOnActivePage())
  handle('browser:feeds:settings:set', (module, input) => module.setFeedSettings(input))
}
