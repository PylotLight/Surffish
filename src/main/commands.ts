import { normalizeHttpOrigin } from '../shared/persistence'
import type { BrowserSidebarMode } from '../shared/types'
import type { CommandDescriptor, CommandPaletteSnapshot } from '../shared/command-palette'
import {
  TAB_COMMAND_SHORTCUTS,
  browserPictureInPicture,
  focusAdjacentSplitPane,
  getActiveTabWebContents,
  getBrowserState,
  getBrowserTabSplitStatus,
  popOutBrowserSplitPane,
  swapBrowserSplitPanes,
  toggleBrowserSplitView,
  getBrowserTabs,
  hasRecentlyClosedBrowserTabs,
  newBrowserTab,
  newPrivateBrowserTab,
  reopenClosedBrowserTab,
  runTabCommand,
  savePdfEditor,
  selectBrowserTabByNumber,
  setBrowserTabMuted,
  suspendOtherBrowserTabs,
  togglePdfEditor,
  type TabCommand
} from './browser'
import { getBrowserPinnedSites } from './browser-persistence'
import { focusVisibleShellPage, getBrowserChromeState, isNativeOverlayMode, sendFocusAddressToVisibleRenderer, setBrowserChromeState } from './browser-shell'
import { getDefaultBrowserStatus, makeDefaultBrowser } from './external-links'
import { isTabOverviewOpen, toggleTabOverview } from './tab-overview'
import { createBrowserWindow, getMainWindow } from './window'
import { APP_SHORTCUTS } from './app-shortcuts'
import { getRecentCommandIds, noteCommandUsed, openCommandPalette } from './command-palette'
import { archiveBrowserTab, archiveOtherBrowserTabs, canArchiveBrowserTab, canArchiveOtherBrowserTabs, closeDuplicateBrowserTabs, hasDuplicateBrowserTabs, restoreLastArchivedTab, runTabArchiveCheck } from './tab-archive'
import { getArchivedTabs, getTabArchiveSettings } from './tab-archive-store'
import { takeScreenshot } from './screenshot'
import { readerStateFor, toggleReaderMode } from './reader-mode'

/**
 * Command registry: every browser action the palette (and anything else later) can list and run.
 * Shortcut labels come from TAB_COMMAND_SHORTCUTS / APP_SHORTCUTS, the same tables the app menu
 * and the page key handler read, so they can't drift.
 */
interface BrowserCommand {
  id: string
  title: string | (() => string)
  keywords?: string[]
  accelerator?: string | null
  section: string
  enabled?: () => boolean
  run: () => unknown
  /** Hand keyboard focus back to the page afterwards (the command doesn't open UI of its own). */
  refocusPage?: boolean
}

function activeTab(): ReturnType<typeof getBrowserTabs>[number] | undefined {
  return getBrowserTabs().find((tab) => tab.active)
}

function activeIsWebPage(): boolean {
  return Boolean(normalizeHttpOrigin(getBrowserState().url))
}

function activeIsBookmarked(): boolean {
  const origin = normalizeHttpOrigin(getBrowserState().url)
  return Boolean(origin && getBrowserPinnedSites().some((site) => normalizeHttpOrigin(site.url) === origin))
}

function tabCommand(id: string, command: TabCommand, title: BrowserCommand['title'], extra: Partial<BrowserCommand> = {}): BrowserCommand {
  return { id, title, accelerator: TAB_COMMAND_SHORTCUTS[command].accelerator, section: 'Tab', run: () => runTabCommand(command), refocusPage: true, ...extra }
}

function openPanel(mode: BrowserSidebarMode): void {
  if (isTabOverviewOpen()) toggleTabOverview()
  setBrowserChromeState({ sidebarMode: mode })
  // Full panels (settings, downloads) show in the content renderer; give it the keyboard.
  focusVisibleShellPage()
}

const COMMANDS: BrowserCommand[] = [
  // Tabs
  { id: 'tab.new', title: 'New Tab', accelerator: APP_SHORTCUTS.newTab, section: 'Tab', keywords: ['open'], run: () => newBrowserTab() },
  { id: 'tab.newPrivate', title: 'New Private Tab', accelerator: APP_SHORTCUTS.newPrivateTab, section: 'Tab', keywords: ['incognito', 'private', 'burner'], run: () => newPrivateBrowserTab() },
  { id: 'tab.reopenClosed', title: 'Reopen Closed Tab', accelerator: APP_SHORTCUTS.reopenClosedTab, section: 'Tab', keywords: ['undo close', 'restore'], enabled: hasRecentlyClosedBrowserTabs, run: () => reopenClosedBrowserTab() },
  tabCommand('tab.close', 'close', 'Close Tab', { refocusPage: false }),
  tabCommand('tab.closeOthers', 'closeOthers', 'Close Other Tabs', { enabled: () => getBrowserTabs().length > 1 }),
  tabCommand('tab.duplicate', 'duplicate', 'Duplicate Tab', { keywords: ['clone', 'copy tab'] }),
  tabCommand('tab.pin', 'pin', () => (activeTab()?.pinned ? 'Unpin Tab' : 'Pin Tab'), { enabled: () => Boolean(activeTab()) }),
  {
    id: 'tab.mute', title: () => (activeTab()?.muted ? 'Unmute Tab' : 'Mute Tab'), section: 'Tab', keywords: ['audio', 'sound', 'silence'], refocusPage: true,
    enabled: () => Boolean(getActiveTabWebContents()),
    run: () => { const tab = activeTab(); if (tab) setBrowserTabMuted(tab.id, !tab.muted) }
  },
  tabCommand('tab.bookmark', 'bookmark', () => (activeIsBookmarked() ? 'Remove Bookmark' : 'Bookmark Tab'), { keywords: ['favorite', 'favourite', 'star'], enabled: activeIsWebPage }),
  tabCommand('tab.copyLink', 'copyLink', 'Copy Link', { keywords: ['url', 'address'], enabled: activeIsWebPage }),
  tabCommand('tab.copyCleanLink', 'copyCleanLink', 'Copy Clean Link', { keywords: ['url', 'tracking', 'utm', 'strip'], enabled: activeIsWebPage }),
  tabCommand('tab.reload', 'reload', 'Reload Tab', { keywords: ['refresh'] }),
  tabCommand('tab.hardReload', 'hardReload', 'Hard Reload Tab', { keywords: ['refresh', 'cache', 'bypass'] }),
  tabCommand('tab.next', 'nextTab', 'Select Next Tab', { refocusPage: false, enabled: () => getBrowserTabs().length > 1 }),
  tabCommand('tab.previous', 'previousTab', 'Select Previous Tab', { refocusPage: false, enabled: () => getBrowserTabs().length > 1 }),
  { id: 'tab.last', title: 'Select Last Tab', accelerator: 'CmdOrCtrl+9', section: 'Tab', enabled: () => getBrowserTabs().length > 1, run: () => selectBrowserTabByNumber(9) },
  {
    id: 'tab.suspendOthers', title: 'Hibernate Other Tabs', section: 'Tab', keywords: ['suspend', 'sleep', 'memory', 'discard'], refocusPage: true,
    run: () => { const tab = activeTab(); if (tab) suspendOtherBrowserTabs(tab.id) }
  },
  // Tab archive and tidying
  { id: 'tab.archive', title: 'Archive Tab', section: 'Tab', keywords: ['tidy', 'declutter', 'put away'], refocusPage: true, enabled: () => canArchiveBrowserTab(activeTab()?.id), run: () => archiveBrowserTab(activeTab()?.id) },
  { id: 'tab.archiveOthers', title: 'Archive Other Tabs', section: 'Tab', keywords: ['tidy', 'declutter', 'clean up'], refocusPage: true, enabled: () => canArchiveOtherBrowserTabs(activeTab()?.id), run: () => archiveOtherBrowserTabs(activeTab()?.id) },
  { id: 'tab.archiveIdle', title: 'Archive Idle Tabs Now', section: 'Tab', keywords: ['auto archive', 'tidy', 'unused'], refocusPage: true, enabled: () => getTabArchiveSettings().archiveAfter !== 'off', run: () => runTabArchiveCheck() },
  { id: 'tab.restoreArchived', title: 'Restore Last Archived Tab', section: 'Tab', keywords: ['unarchive', 'archived', 'bring back'], enabled: () => getArchivedTabs().length > 0, run: () => restoreLastArchivedTab() },
  { id: 'tab.searchArchived', title: 'Search Open and Archived Tabs…', section: 'Tab', keywords: ['archived', 'find tab', 'unarchive'], run: () => openCommandPalette('tabs') },
  { id: 'tab.closeDuplicates', title: 'Close Duplicate Tabs', section: 'Tab', keywords: ['dedupe', 'duplicates', 'tidy', 'same url'], refocusPage: true, enabled: hasDuplicateBrowserTabs, run: () => closeDuplicateBrowserTabs() },
  { id: 'tab.search', title: 'Search Tabs…', accelerator: APP_SHORTCUTS.tabSearch, section: 'Tab', keywords: ['find tab', 'switch', 'go to tab'], run: () => openCommandPalette('tabs') },
  { id: 'tab.overview', title: 'Tab Overview', accelerator: APP_SHORTCUTS.tabOverview, section: 'Tab', keywords: ['expose', 'grid', 'all tabs'], run: () => toggleTabOverview() },

  // Navigation
  tabCommand('nav.back', 'back', 'Back', { section: 'Navigation', enabled: () => getBrowserState().canGoBack }),
  tabCommand('nav.forward', 'forward', 'Forward', { section: 'Navigation', enabled: () => getBrowserState().canGoForward }),
  { id: 'nav.openLocation', title: 'Open Location…', accelerator: APP_SHORTCUTS.openLocation, section: 'Navigation', keywords: ['address bar', 'url', 'omnibox'], run: () => sendFocusAddressToVisibleRenderer() },
  tabCommand('nav.find', 'find', 'Find in Page…', { section: 'Navigation', keywords: ['search page'], refocusPage: false, enabled: () => Boolean(getActiveTabWebContents()) }),

  // View
  tabCommand('view.zoomIn', 'zoomIn', 'Zoom In', { section: 'View', keywords: ['bigger', 'larger'], enabled: activeIsWebPage }),
  tabCommand('view.zoomOut', 'zoomOut', 'Zoom Out', { section: 'View', keywords: ['smaller'], enabled: activeIsWebPage }),
  tabCommand('view.zoomReset', 'zoomReset', 'Actual Size', { section: 'View', keywords: ['zoom reset', '100%'], enabled: activeIsWebPage }),
  {
    id: 'view.toggleSidebar', title: () => (getBrowserChromeState().sidebarPinned ? 'Hide Sidebar' : 'Show Sidebar'), section: 'View', keywords: ['toggle sidebar', 'pin sidebar', 'tabs list'], refocusPage: true,
    run: () => setBrowserChromeState({ sidebarPinned: !getBrowserChromeState().sidebarPinned })
  },
  { id: 'view.pip', title: 'Picture in Picture', section: 'View', keywords: ['video', 'pip', 'float'], enabled: activeIsWebPage, refocusPage: true, run: () => browserPictureInPicture() },
  {
    id: 'view.screenshot', title: 'Take Screenshot…', accelerator: TAB_COMMAND_SHORTCUTS.screenshot.accelerator, section: 'View',
    keywords: ['capture', 'snapshot', 'region', 'annotate', 'screen grab'], enabled: () => Boolean(getActiveTabWebContents()), run: () => takeScreenshot('choose')
  },
  { id: 'view.screenshotVisible', title: 'Screenshot Visible Area', section: 'View', keywords: ['capture', 'snapshot', 'screen grab'], enabled: () => Boolean(getActiveTabWebContents()), run: () => takeScreenshot('visible') },
  { id: 'view.screenshotFull', title: 'Screenshot Full Page', section: 'View', keywords: ['capture', 'snapshot', 'whole page', 'scrolling', 'screen grab'], enabled: () => Boolean(getActiveTabWebContents()), run: () => takeScreenshot('full') },
  {
    id: 'view.reader', title: () => (readerStateFor(getActiveTabWebContents()) === 'active' ? 'Exit Reader View' : 'Reader View'), accelerator: APP_SHORTCUTS.readerView, section: 'View',
    keywords: ['reader mode', 'article', 'readability', 'distraction free', 'clean'], enabled: () => readerStateFor(getActiveTabWebContents()) !== null, run: () => toggleReaderMode()
  },
  // Split view
  {
    id: 'view.splitView', title: () => (getBrowserTabSplitStatus().split ? 'Unsplit Tabs' : 'Split with Last Used Tab'), accelerator: TAB_COMMAND_SHORTCUTS.splitView.accelerator, section: 'View',
    keywords: ['split view', 'side by side', 'two tabs', 'tile', 'unsplit'], refocusPage: true, enabled: () => getBrowserTabSplitStatus().canSplit, run: () => toggleBrowserSplitView()
  },
  { id: 'view.splitSwap', title: 'Swap Split Panes', section: 'View', keywords: ['split view', 'swap sides', 'flip'], refocusPage: true, enabled: () => getBrowserTabSplitStatus().split, run: () => swapBrowserSplitPanes() },
  { id: 'view.splitPopOut', title: 'Open Pane as Its Own Tab', section: 'View', keywords: ['split view', 'pop out', 'separate', 'unsplit pane'], refocusPage: true, enabled: () => getBrowserTabSplitStatus().split, run: () => popOutBrowserSplitPane() },
  tabCommand('view.splitClosePane', 'close', 'Close Focused Pane', { section: 'View', keywords: ['split view', 'close pane'], refocusPage: false, enabled: () => getBrowserTabSplitStatus().split }),
  { id: 'view.splitFocusLeft', title: 'Focus Left Pane', accelerator: TAB_COMMAND_SHORTCUTS.focusPaneLeft.accelerator, section: 'View', keywords: ['split view', 'pane', 'switch pane'], enabled: () => getBrowserTabSplitStatus().split, run: () => focusAdjacentSplitPane(-1) },
  { id: 'view.splitFocusRight', title: 'Focus Right Pane', accelerator: TAB_COMMAND_SHORTCUTS.focusPaneRight.accelerator, section: 'View', keywords: ['split view', 'pane', 'switch pane'], enabled: () => getBrowserTabSplitStatus().split, run: () => focusAdjacentSplitPane(1) },
  { id: 'view.history', title: 'Show History', accelerator: TAB_COMMAND_SHORTCUTS.history.accelerator, section: 'View', keywords: ['visited'], run: () => openPanel('history') },
  { id: 'view.downloads', title: 'Show Downloads', accelerator: TAB_COMMAND_SHORTCUTS.downloads.accelerator, section: 'View', run: () => openPanel('downloads') },

  // PDF
  {
    id: 'pdf.toggleEditor', title: () => (getBrowserState().pdf === 'editor' ? 'Back to PDF Viewer' : 'Edit PDF'), accelerator: APP_SHORTCUTS.editPdf, section: 'PDF',
    keywords: ['annotate', 'sign', 'signature', 'form', 'rotate pages'], enabled: () => getBrowserState().pdf !== null, run: () => togglePdfEditor()
  },
  { id: 'pdf.save', title: 'Save Edited PDF…', accelerator: APP_SHORTCUTS.savePdf, section: 'PDF', enabled: () => getBrowserState().pdf === 'editor', run: () => savePdfEditor() },

  // Settings
  { id: 'settings.general', title: 'Settings: General', section: 'Settings', keywords: ['preferences', 'search engine', 'proxy', 'socks', 'keywords'], run: () => openPanel('settings') },
  { id: 'settings.newTab', title: 'Settings: New Tab', section: 'Settings', keywords: ['preferences', 'clock', 'weather', 'background'], run: () => openPanel('newtab') },
  { id: 'settings.extensions', title: 'Settings: Extensions', section: 'Settings', keywords: ['preferences', 'chrome web store', 'bramble', 'addons'], run: () => openPanel('integrations') },
  { id: 'settings.site', title: 'Settings: This Site', section: 'Settings', keywords: ['permissions', 'adblock', 'clipboard', 'popups'], enabled: activeIsWebPage, run: () => openPanel('site') },
  { id: 'settings.watchers', title: 'Page Watchers', section: 'Settings', keywords: ['watch', 'monitor', 'changes', 'diff', 'notify'], run: () => openPanel('watchers') },
  { id: 'tools.network', title: 'Network Inspector', section: 'Tools', keywords: ['requests', 'devtools', 'debug', 'har'], run: () => openPanel('network') },
  {
    id: 'settings.defaultBrowser', title: 'Make Surffish the Default Browser', section: 'Settings', keywords: ['default browser', 'open links'],
    enabled: () => { const status = getDefaultBrowserStatus(); return status.canSet && !status.isDefault },
    run: () => makeDefaultBrowser()
  },

  // Window
  { id: 'window.new', title: 'New Window', accelerator: APP_SHORTCUTS.newWindow, section: 'Window', keywords: ['open window'], run: () => createBrowserWindow(false) },
  { id: 'window.newPrivate', title: 'New Private Window', accelerator: APP_SHORTCUTS.newPrivateWindow, section: 'Window', keywords: ['incognito', 'private', 'burner'], run: () => createBrowserWindow(true) },
  {
    id: 'window.close', title: 'Close Window', accelerator: APP_SHORTCUTS.closeWindow, section: 'Window', keywords: ['quit'],
    run: () => { const win = getMainWindow(); if (win && !win.isDestroyed()) win.close() }
  }
]

const COMMANDS_BY_ID = new Map(COMMANDS.map((command) => [command.id, command]))

function isEnabled(command: BrowserCommand): boolean {
  try {
    return command.enabled ? command.enabled() : true
  } catch {
    return false
  }
}

export function listCommands(): CommandDescriptor[] {
  return COMMANDS.map((command) => ({
    id: command.id,
    title: typeof command.title === 'function' ? command.title() : command.title,
    keywords: command.keywords ?? [],
    accelerator: command.accelerator ?? null,
    section: command.section,
    enabled: isEnabled(command)
  }))
}

export function getCommandPaletteSnapshot(): CommandPaletteSnapshot {
  return { commands: listCommands(), recentCommandIds: getRecentCommandIds() }
}

/** Focus the live page (or the New Tab renderer) after the palette closes. */
export function focusActivePage(): void {
  if (isNativeOverlayMode()) getActiveTabWebContents()?.focus()
  else focusVisibleShellPage()
}

export async function runCommand(id: unknown): Promise<boolean> {
  if (typeof id !== 'string') return false
  const command = COMMANDS_BY_ID.get(id)
  if (!command || !isEnabled(command)) return false
  noteCommandUsed(id)
  if (command.refocusPage) focusActivePage()
  await command.run()
  return true
}
