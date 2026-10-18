import { clipboard, shell } from 'electron'
import { isBookmarksBarVisible } from './bookmarks-bar'
import { normalizeHttpOrigin } from '../shared/persistence'
import type { BrowserSidebarMode } from '../shared/types'
import type { CommandDescriptor, CommandPaletteSnapshot } from '../shared/command-palette'
import {
  TAB_COMMAND_SHORTCUTS,
  browserPictureInPicture,
  flashBrowserStatus,
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
  stepActiveBrowserTabVolume,
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
import { openSettingsTab } from './browser'
import { cycleBrowserSpace, getBrowserSpacesSnapshot, moveBrowserTabToSpace, switchBrowserSpace } from './browser'
import { createBrowserSpace, deleteBrowserSpaceWithConfirm } from './spaces-ipc'
import { activeBrowserTabGroupId, addBrowserTabsToGroup, createBrowserTabGroup, listBrowserTabGroups, newBrowserTabInGroup, removeBrowserTabsFromGroup, toggleBrowserTabGroupCollapsed, ungroupBrowserTabGroup } from './browser'
import { closeBrowserTabGroupWithConfirm, renameBrowserTabGroup } from './tab-groups-ipc'
import { groupSelectedBrowserTabs, getSelectedBrowserTabIds } from './tab-selection'
import { DEFAULT_SPACE_ID } from '../shared/spaces'
import { isCommandHiddenByWatchers } from '../shared/page-watchers-feature'
import { pageWatchersEnabled } from './page-watchers-feature'
import { revealFeeds } from './feeds-ipc'
import { addTabToReadingList, showReadingList } from './reading-list-ipc'
import { glanceShiftClickEnabled, openGlance, setGlanceShiftClick } from './glance-entry'
import { glanceUrlFromText } from '../shared/glance'
import { canPopOutBrowserTab, getBrowserActiveTabId, hasMiniWindows } from './browser'
import { miniHeaderDebugEnabled, setMiniHeaderDebug } from './mini-header-debug'
import { castEnabled, isCasting, openCastPicker, stopCasting } from './cast-entry'
import { canMergeMiniWindows, canSplitMiniWindowTab, mergeMiniWindows, moveTabToMiniWindow, splitMiniWindowTab, stepMiniWindowTab, canSendToMenuBar, focusMiniWindow, getMiniWindowSettings, isMiniWindowTucked, listMiniWindows, popOutTabToMiniWindow, returnAllMiniWindows, returnMiniWindowToBrowser, sendMiniWindowToMenuBar, setMiniWindowGrouping, setMiniWindowHeaderPlacement, setMiniWindowPeekOnHover, setMiniWindowSettingsOpener, setMiniWindowThrowMomentum, toggleMiniWindow, tuckMiniWindow } from './mini-window-entry'

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

// The menu bar icon's "Mini Window Settings…": a browser window forward (a new one when none is open), Settings open.
setMiniWindowSettingsOpener(() => {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) createBrowserWindow()
  else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  openSettingsTab({ section: 'settings', focus: 'mini-window' })
  focusVisibleShellPage()
})

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
    id: 'tab.mute', title: () => (activeTab()?.muted ? 'Unmute Tab' : 'Mute Tab'), section: 'Tab', keywords: ['audio', 'sound', 'silence', 'volume mute'], refocusPage: true,
    enabled: () => Boolean(getActiveTabWebContents()),
    run: () => { const tab = activeTab(); if (tab) setBrowserTabMuted(tab.id, !tab.muted) }
  },
  { id: 'tab.volumeUp', title: 'Volume Up', section: 'Tab', keywords: ['tab volume', 'louder', 'sound', 'audio'], refocusPage: true, enabled: () => Boolean(getActiveTabWebContents()), run: () => stepActiveBrowserTabVolume(1) },
  { id: 'tab.volumeDown', title: 'Volume Down', section: 'Tab', keywords: ['tab volume', 'quieter', 'softer', 'sound', 'audio'], refocusPage: true, enabled: () => Boolean(getActiveTabWebContents()), run: () => stepActiveBrowserTabVolume(-1) },
  tabCommand('tab.bookmark', 'bookmark', () => (activeIsBookmarked() ? 'Remove Bookmark' : 'Bookmark Tab'), { keywords: ['favorite', 'favourite', 'star'], enabled: activeIsWebPage }),
  {
    id: 'readingList.add', title: 'Add to Reading List', accelerator: TAB_COMMAND_SHORTCUTS.readingList.accelerator, section: 'Tab',
    keywords: ['read later', 'save for later', 'look at later', 'todo', 'queue', 'pocket', 'instapaper'], refocusPage: true,
    enabled: () => activeIsWebPage() && !activeTab()?.private, run: () => addTabToReadingList(activeTab()?.id)
  },
  { id: 'readingList.show', title: 'Open Reading List', section: 'View', keywords: ['read later', 'saved for later', 'unread', 'reading list', 'queue'], run: () => showReadingList() },
  tabCommand('view.bookmarksBar', 'bookmarksBar', () => (isBookmarksBarVisible() ? 'Hide Bookmarks Bar' : 'Show Bookmarks Bar'), { section: 'View', keywords: ['favourites', 'favorites', 'toolbar'], refocusPage: false }),
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
  { id: 'view.screenshotScrolling', title: 'Scrolling Screenshot', section: 'View', keywords: ['capture', 'scroll', 'long', 'tall', 'stitch', 'screen grab'], enabled: () => Boolean(getActiveTabWebContents()), run: () => takeScreenshot('scrolling') },
  {
    id: 'view.reader', title: () => (readerStateFor(getActiveTabWebContents()) === 'active' ? 'Exit Reader View' : 'Reader View'), accelerator: APP_SHORTCUTS.readerView, section: 'View',
    keywords: ['reader mode', 'article', 'readability', 'distraction free', 'clean'], enabled: () => readerStateFor(getActiveTabWebContents()) !== null, run: () => toggleReaderMode()
  },
  // Cast (Chromecast)
  { id: 'cast.open', title: 'Cast…', section: 'View', keywords: ['chromecast', 'cast video', 'tv', 'google cast', 'mirror tab', 'screen'], enabled: castEnabled, run: () => openCastPicker() },
  { id: 'cast.stop', title: 'Stop Casting', section: 'View', keywords: ['chromecast', 'cast', 'tv', 'disconnect'], refocusPage: true, enabled: isCasting, run: () => stopCasting() },
  // Glance (link peek)
  {
    id: 'glance.openCopiedLink', title: 'Open Copied Link in Glance', section: 'View',
    keywords: ['glance', 'peek', 'preview', 'quick look', 'clipboard', 'paste link'],
    enabled: activeIsWebPage,
    run: async () => {
      const url = glanceUrlFromText(await clipboard.readText())
      const page = getActiveTabWebContents()
      if (!url) {
        flashBrowserStatus('Copy a link first to open it in Glance')
        return false
      }
      return page ? openGlance(page, url) : false
    }
  },
  {
    id: 'glance.toggleShiftClick', title: () => (glanceShiftClickEnabled() ? 'Turn Off Shift-Click Glance' : 'Turn On Shift-Click Glance'), section: 'Settings',
    keywords: ['glance', 'peek', 'shift click', 'link preview'], refocusPage: true,
    run: () => setGlanceShiftClick(!glanceShiftClickEnabled())
  },
  // Mini window
  {
    id: 'miniWindow.popOut', title: 'Pop Out to Mini Window', accelerator: TAB_COMMAND_SHORTCUTS.miniWindow.accelerator, section: 'View',
    keywords: ['mini window', 'float', 'always on top', 'picture in picture', 'pin', 'detach', 'pop out', 'overlay'],
    enabled: () => canPopOutBrowserTab(), run: () => popOutTabToMiniWindow()
  },
  {
    id: 'miniWindow.return', title: 'Return All Mini Windows', section: 'View',
    keywords: ['mini window', 'pop in', 'dock', 'back to browser', 'return mini window to browser', 'close mini windows'],
    enabled: () => hasMiniWindows(), run: () => returnAllMiniWindows()
  },
  {
    id: 'miniWindow.toggle', title: () => (hasMiniWindows() ? 'Show/Hide Mini Windows' : getMiniWindowSettings().defaultUrl ? 'Open Mini Window' : 'Toggle Mini Window'), section: 'View',
    keywords: ['mini window', 'float', 'always on top', 'ai chat', 'pinned page'],
    refocusPage: false,
    run: () => toggleMiniWindow()
  },
  {
    id: 'miniWindow.tuck', title: () => (isMiniWindowTucked() ? 'Slide Out Mini Window' : 'Tuck Mini Window to Screen Edge'), section: 'View',
    keywords: ['mini window', 'tuck', 'dock', 'edge', 'hide', 'side', 'drawer', 'slide'],
    refocusPage: false,
    enabled: () => hasMiniWindows() && getMiniWindowSettings().tuckToEdge,
    run: () => tuckMiniWindow()
  },
  {
    id: 'miniWindow.splitTab', title: 'Split Tab Off Mini Window', section: 'View',
    keywords: ['mini window', 'split', 'separate', 'tear off', 'own window', 'tab strip'],
    refocusPage: false,
    enabled: () => canSplitMiniWindowTab(),
    run: () => splitMiniWindowTab()
  },
  {
    id: 'miniWindow.merge', title: 'Merge Mini Windows', section: 'View',
    keywords: ['mini window', 'merge', 'combine', 'join', 'collect', 'tab strip'],
    refocusPage: false,
    enabled: () => canMergeMiniWindows(),
    run: () => mergeMiniWindows()
  },
  ...([[-1, 'Left'], [1, 'Right']] as const).map(([step, label]): BrowserCommand => ({
    id: `miniWindow.moveTab${label}`, title: `Move Mini Window Tab ${label}`, section: 'View',
    keywords: ['mini window', 'reorder', 'move tab', 'tab strip', label.toLowerCase()],
    refocusPage: false,
    enabled: () => canSplitMiniWindowTab(),
    run: () => stepMiniWindowTab(step)
  })),
  {
    id: 'miniWindow.menuBar', title: 'Send Mini Window to Menu Bar', section: 'View',
    keywords: ['mini window', 'menu bar', 'tray', 'status item', 'status bar', 'menubar', 'pop out'],
    refocusPage: false,
    enabled: () => canSendToMenuBar(canPopOutBrowserTab()),
    run: () => sendMiniWindowToMenuBar()
  },
  {
    // Diagnostics for a flashing mini window header / menu bar popout strip (main/mini-header-debug.ts);
    // the same as launching with SURFFISH_DEBUG_HEADER=1. Stopping shows the log file in Finder.
    id: 'miniWindow.debugHeader', title: () => (miniHeaderDebugEnabled() ? 'Stop Logging Mini Window Header Events (Show Log)' : 'Start Logging Mini Window Header Events'), section: 'Settings',
    keywords: ['mini window', 'menu bar', 'popout', 'header', 'strip', 'flash', 'flicker', 'debug', 'diagnostics', 'log', 'trace'], refocusPage: true,
    run: () => {
      const on = !miniHeaderDebugEnabled()
      const path = setMiniHeaderDebug(on)
      if (on) flashBrowserStatus('Logging mini window header events to ' + path, 5000)
      else setTimeout(() => shell.showItemInFolder(path), 400)
      return true
    }
  },
  {
    id: 'miniWindow.togglePeek', title: () => (getMiniWindowSettings().peekOnHover ? 'Turn Off Mini Window Peek on Hover' : 'Turn On Mini Window Peek on Hover'), section: 'Settings',
    keywords: ['mini window', 'peek', 'hover', 'tuck', 'edge', 'handle', 'slide out'], refocusPage: true,
    enabled: () => getMiniWindowSettings().tuckToEdge,
    run: () => setMiniWindowPeekOnHover(!getMiniWindowSettings().peekOnHover)
  },
  {
    id: 'miniWindow.toggleThrow', title: () => (getMiniWindowSettings().throwMomentum ? 'Turn Off Mini Window Throw with Momentum' : 'Turn On Mini Window Throw with Momentum'), section: 'Settings',
    keywords: ['mini window', 'throw', 'momentum', 'inertia', 'fling', 'glide', 'drag'], refocusPage: true,
    run: () => setMiniWindowThrowMomentum(!getMiniWindowSettings().throwMomentum)
  },
  ...(([['tabs', 'Tabs', ['tab strip', 'collection', 'merge']], ['stack', 'Stack', ['stack', 'edge group', 'slide out together']], ['separate', 'Separate', ['one window per tab', 'separate windows']]] as const).map(([grouping, label, extra]): BrowserCommand => ({
    id: `miniWindow.grouping.${grouping}`, title: `Mini Window Grouping: ${label}`, section: 'Settings',
    keywords: ['mini window', 'group', 'grouping', ...extra], refocusPage: true,
    enabled: () => getMiniWindowSettings().grouping !== grouping,
    run: () => setMiniWindowGrouping(grouping)
  }))),
  ...(([['float', 'Float Above', ['outside', 'above', 'never covers', 'panel']], ['push', 'Push Content', ['push', 'reflow', 'move page down']], ['overlay', 'Overlay', ['over the page', 'cover']]] as const).map(([placement, label, extra]): BrowserCommand => ({
    id: `miniWindow.header.${placement}`, title: `Mini Window Header: ${label}`, section: 'Settings',
    keywords: ['mini window', 'header', 'title bar', 'tab strip', ...extra], refocusPage: true,
    enabled: () => getMiniWindowSettings().headerPlacement !== placement,
    run: () => setMiniWindowHeaderPlacement(placement)
  }))),
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
  { id: 'settings.general', title: 'Settings: General', accelerator: APP_SHORTCUTS.settings, section: 'Settings', keywords: ['preferences', 'search engine', 'proxy', 'socks', 'keywords'], run: () => openPanel('settings') },
  { id: 'settings.newTab', title: 'Settings: New Tab', section: 'Settings', keywords: ['preferences', 'clock', 'weather', 'background'], run: () => openPanel('newtab') },
  { id: 'settings.extensions', title: 'Settings: Extensions', section: 'Settings', keywords: ['preferences', 'chrome web store', 'bramble', 'addons'], run: () => openPanel('integrations') },
  { id: 'settings.site', title: 'Settings: This Site', section: 'Settings', keywords: ['permissions', 'adblock', 'clipboard', 'popups'], enabled: activeIsWebPage, run: () => openPanel('site') },
  { id: 'settings.watchers', title: 'Page Watchers', section: 'Settings', keywords: ['watch', 'monitor', 'changes', 'diff', 'notify'], enabled: pageWatchersEnabled, run: () => openPanel('watchers') },
  { id: 'view.feeds', title: 'Feeds', section: 'View', keywords: ['rss', 'atom', 'feed', 'news', 'subscribe', 'github', 'ci', 'releases'], run: () => revealFeeds() },
  { id: 'feeds.addFromPage', title: 'Add Feed from This Site…', section: 'View', keywords: ['rss', 'atom', 'subscribe', 'follow', 'discover'], enabled: activeIsWebPage, run: () => revealFeeds({ discover: true }) },
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

/** Space accelerators: Ctrl+1..9 on macOS (Cmd+1..9 selects tabs), Ctrl+Shift+1..9 elsewhere. */
function spaceAccelerator(index: number): string | null {
  if (index >= 9) return null
  return process.platform === 'darwin' ? `Ctrl+${index + 1}` : `Ctrl+Shift+${index + 1}`
}

/** Space commands exist only while Spaces are on (and never in a private window). */
function spaceCommands(): BrowserCommand[] {
  const snapshot = getBrowserSpacesSnapshot()
  if (!snapshot.enabled) return []
  const label = (space: (typeof snapshot.spaces)[number]): string => `${space.icon ? `${space.icon} ` : ''}${space.name}`
  const tab = activeTab()
  const several = snapshot.spaces.length > 1
  const current = snapshot.spaces.find((space) => space.id === snapshot.activeSpaceId)
  return [
    { id: 'space.new', title: 'New Space', section: 'Space', keywords: ['workspace', 'profile', 'create space'], run: () => createBrowserSpace() },
    { id: 'space.next', title: 'Next Space', section: 'Space', keywords: ['switch space', 'workspace'], enabled: () => several, run: () => cycleBrowserSpace(1) },
    { id: 'space.previous', title: 'Previous Space', section: 'Space', keywords: ['switch space', 'workspace'], enabled: () => several, run: () => cycleBrowserSpace(-1) },
    ...snapshot.spaces.map((space, index): BrowserCommand => ({
      id: `space.switch:${space.id}`, title: `Switch to Space: ${label(space)}`, section: 'Space', accelerator: spaceAccelerator(index), keywords: ['go to space', 'workspace'],
      enabled: () => space.id !== snapshot.activeSpaceId, run: () => switchBrowserSpace(space.id)
    })),
    ...snapshot.spaces.map((space): BrowserCommand => ({
      id: `space.moveTab:${space.id}`, title: `Move Tab to Space: ${label(space)}`, section: 'Space', keywords: ['send tab', 'workspace'], refocusPage: true,
      enabled: () => Boolean(tab && !tab.private) && space.id !== snapshot.activeSpaceId, run: () => { if (tab) moveBrowserTabToSpace(tab.id, space.id) }
    })),
    {
      id: 'space.delete', title: `Delete Space${current && current.id !== DEFAULT_SPACE_ID ? `: ${label(current)}` : ''}…`, section: 'Space', keywords: ['remove space'],
      enabled: () => snapshot.activeSpaceId !== DEFAULT_SPACE_ID, run: () => deleteBrowserSpaceWithConfirm(snapshot.activeSpaceId)
    }
  ]
}

/** Tab group commands (work with Spaces on or off); "Add Tab to Group: …" lists this Space's groups. */
function tabGroupCommands(): BrowserCommand[] {
  const tab = activeTab()
  const groupId = activeBrowserTabGroupId()
  const groups = listBrowserTabGroups()
  const inGroup = (): boolean => Boolean(groupId)
  const canGroup = (): boolean => Boolean(tab && !tab.pinned)
  return [
    // Sidebar multi-select (Cmd/Ctrl-click, Shift-click): only offered while 2+ tabs are selected.
    { id: 'group.selected', title: () => { const count = getSelectedBrowserTabIds().length; return count >= 2 ? `Group ${count} Selected Tabs` : 'Group Selected Tabs' }, section: 'Tab Group', accelerator: 'CmdOrCtrl+G', keywords: ['tab group', 'group tabs', 'group selected', 'multi-select', 'selection'], refocusPage: true, enabled: () => getSelectedBrowserTabIds().length >= 2, run: () => groupSelectedBrowserTabs() },
    { id: 'group.new', title: 'Add Tab to New Group', section: 'Tab Group', keywords: ['tab group', 'group tabs', 'create group'], refocusPage: true, enabled: canGroup, run: () => { if (tab) createBrowserTabGroup([tab.id]) } },
    { id: 'group.remove', title: 'Remove Tab from Group', section: 'Tab Group', keywords: ['tab group', 'ungroup tab'], refocusPage: true, enabled: inGroup, run: () => { if (tab) removeBrowserTabsFromGroup([tab.id]) } },
    { id: 'group.rename', title: 'Rename Group…', section: 'Tab Group', keywords: ['tab group', 'name group'], enabled: inGroup, run: () => { if (groupId) renameBrowserTabGroup(groupId) } },
    { id: 'group.collapse', title: 'Collapse Group', section: 'Tab Group', keywords: ['tab group', 'fold', 'hide group'], enabled: inGroup, run: () => { if (groupId) toggleBrowserTabGroupCollapsed(groupId) } },
    { id: 'group.newTab', title: 'New Tab in Group', section: 'Tab Group', keywords: ['tab group'], enabled: inGroup, run: () => { if (groupId) newBrowserTabInGroup(groupId) } },
    { id: 'group.ungroup', title: 'Ungroup', section: 'Tab Group', keywords: ['tab group', 'dissolve group'], refocusPage: true, enabled: inGroup, run: () => { if (groupId) ungroupBrowserTabGroup(groupId) } },
    { id: 'group.close', title: 'Close Group…', section: 'Tab Group', keywords: ['tab group', 'close tabs'], enabled: inGroup, run: () => { if (groupId) return closeBrowserTabGroupWithConfirm(groupId) } },
    ...groups.map((group): BrowserCommand => ({
      id: `group.add:${group.id}`, title: `Add Tab to Group: ${group.label}`, section: 'Tab Group', keywords: ['tab group', 'move to group'], refocusPage: true,
      enabled: () => canGroup() && group.id !== groupId, run: () => { if (tab) addBrowserTabsToGroup([tab.id], group.id) }
    })),
    ...groups.filter((group) => group.collapsed).map((group): BrowserCommand => ({
      id: `group.expand:${group.id}`, title: `Expand Group: ${group.label}`, section: 'Tab Group', keywords: ['tab group', 'unfold', 'show group'], run: () => toggleBrowserTabGroupCollapsed(group.id)
    }))
  ]
}

/** Per mini window (only with two or more open; one is covered by the commands above): show, tuck/slide out, return. */
function miniWindowCommands(): BrowserCommand[] {
  const open = listMiniWindows()
  if (open.length < 2) return []
  const keywords = ['mini window', 'float', 'always on top']
  return open.flatMap((mini): BrowserCommand[] => [
    { id: `miniWindow.show:${mini.tabId}`, title: `Show Mini Window: ${mini.title}`, section: 'View', keywords: [...keywords, 'focus', 'switch to'], refocusPage: false, run: () => focusMiniWindow(mini.tabId) },
    // In the menu bar there is no edge to tuck to (its icon's menu has Move to Edge).
    ...(mini.menuBar ? [] : [{
      id: `miniWindow.tuck:${mini.tabId}`, title: `${isMiniWindowTucked(mini.tabId) ? 'Slide Out' : 'Tuck Away'} Mini Window: ${mini.title}`, section: 'View', keywords: [...keywords, 'tuck', 'edge', 'slide'], refocusPage: false,
      enabled: () => getMiniWindowSettings().tuckToEdge, run: () => tuckMiniWindow(mini.tabId)
    } satisfies BrowserCommand]),
    { id: `miniWindow.return:${mini.tabId}`, title: `Return Mini Window to Browser: ${mini.title}`, section: 'View', keywords: [...keywords, 'pop in', 'back to browser'], run: () => returnMiniWindowToBrowser({ tabId: mini.tabId }) }
  ])
}

/**
 * Grouping 'tabs': "Move Tab to Mini Window: …" for each floating collection (one entry per window,
 * named by the tab on screen), taking the current browser tab. With one collection Pop Out does it.
 */
function moveToMiniCommands(): BrowserCommand[] {
  if (getMiniWindowSettings().grouping !== 'tabs' || !canPopOutBrowserTab()) return []
  const collections = listMiniWindows().filter((mini) => !mini.menuBar && mini.active)
  if (collections.length < 2) return []
  return collections.map((mini): BrowserCommand => ({
    id: `miniWindow.moveInto:${mini.tabId}`, title: `Move Tab to Mini Window: ${mini.title}`, section: 'View',
    keywords: ['mini window', 'merge', 'join', 'add to', 'pop out', 'collection'], refocusPage: false,
    run: () => { const id = getBrowserActiveTabId(); return id ? moveTabToMiniWindow(id, mini.tabId) : false }
  }))
}

function allCommands(): BrowserCommand[] {
  const watchersEnabled = pageWatchersEnabled()
  return [...COMMANDS.filter((command) => !isCommandHiddenByWatchers(command.id, watchersEnabled)), ...tabGroupCommands(), ...spaceCommands(), ...miniWindowCommands(), ...moveToMiniCommands()]
}

function isEnabled(command: BrowserCommand): boolean {
  try {
    return command.enabled ? command.enabled() : true
  } catch {
    return false
  }
}

export function listCommands(): CommandDescriptor[] {
  return allCommands().map((command) => ({
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
  const command = COMMANDS_BY_ID.get(id) ?? (id.startsWith('space.') || id.startsWith('group.') || id.startsWith('miniWindow.') ? allCommands().find((candidate) => candidate.id === id) : undefined)
  if (!command || !isEnabled(command)) return false
  noteCommandUsed(id)
  if (command.refocusPage) focusActivePage()
  await command.run()
  return true
}
