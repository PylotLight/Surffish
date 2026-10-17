import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type {
  BrambleExtensionState,
  BrowserChromeState,
  BrowserPreferencesSnapshot,
  BrowserSidebarMode,
  BrowserProxySettings,
  BrowserState,
  BrowserTabSummary,
  BrowsingHistoryEntry,
  NewTabBackground,
  NewTabPreferences,
  NewTabPageId,
  NewTabWeatherSnapshot,
  PinnedSite,
  SearchEngineId,
  TabSleepMinutes
} from '../../../shared/types'
import { DEFAULT_SEARCH_ENGINE, getSearchHomepage, SEARCH_ENGINES, SURFFISH_QUICK_LINKS_URL } from '../../../shared/navigation'
import { DEFAULT_NEW_TAB_PREFERENCES, DEFAULT_SIDEBAR_WIDTH, MAX_PINNED_SITES, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, normalizeSidebarWidth } from '../../../shared/persistence'
import { buildAddressSuggestions } from '../../../shared/autocomplete'
import { arrowSuggestion, escapeOmnibox, highlightMatches, omniboxQuery, suggestionUrlParts, type OmniboxPreview } from '../../../shared/omnibox-fill'
import { Debouncer, HOVER_DWELL_MS, TYPING_DEBOUNCE_MS, typedInputQualifies } from '../../../shared/preconnect'
import { addressDisplayValue } from '../../../shared/address-bar-sync'
import { describeTabSleep, isRestoredSleep } from '../../../shared/tab-sleep'
import { useAddressBarSync } from './useAddressBarSync'
import { FAVOURITES_FOLDER_ID } from '../../../shared/bookmarks'
import { formatZoomPercent, isDefaultZoom } from '../../../shared/zoom'
import { dispatchBrambleToolbarAction, resolveBrambleToolbarAction } from '../../../shared/bramble-toolbar'
import { buildFrequentSites, toQuickLinkSite, type QuickLinkSite } from '../../../shared/quick-links'
import {
  getQuickLinkBackgroundIndex,
  nextQuickLinkBackgroundIndex,
  QUICK_LINK_BACKGROUND_ROTATION_MS
} from '../../../shared/quick-links-backgrounds'
import { NEW_TAB_PHOTO_REFRESH_INTERVAL_MS } from '../../../shared/new-tab-photo-feed'
import forestLake from '../assets/quick-links-backgrounds/forest-lake.webp'
import mountainLake from '../assets/quick-links-backgrounds/tranquil-mountain-lake.webp'
import brambleExtensionIcon from '../assets/bramble-extension-icon.png'
import { FindBar } from './FindBar'
import { CommandPalette } from './CommandPalette'
import { useSearchKeywords } from './useSearchKeywords'
import { parseKeywordSearch } from '../../../shared/search-keywords'
import { PinnedTabIcon, PrivateGlyph, TabAudioButton, TabFavicon } from './TabIndicators'
import { NavHistoryButtons } from './NavHistoryButtons'
import { SettingsCategory, SettingsGroup, SettingsRow } from './settings/SettingsControls'
import { SettingsSearchField, SettingsSearchStatus, SettingsToc } from './settings/SettingsSearch'
import { useSettingsSearch } from './settings/useSettingsSearch'
import { TabInterstitial } from './TabInterstitial'
import { ProxyDownBanner } from './ProxyDownBanner'
import { NetworkOverridesBadge } from './NetworkOverridesPanel'
import { isInsecurePageUrl, pageTransportSecurity } from '../../../shared/https-only'
import { UpdateBadge } from './settings/UpdateBadge'
import { SiteSettingsQuick } from './sites/SiteSettingsQuick'
import { formatVisitedAt } from '../lib/format'
import { dismissPopovers, usePopoverDismiss } from '../lib/popover-dismiss'
import { useDismissOnTabSwitch, useHistoryPanelDismiss, useToolbarExtent } from './useToolbarPopovers'
import { BrandEasterEgg, useBrandTripleClick } from './easter-egg/BrandEasterEgg'
import { useTabDragSort } from './useTabDragSort'
import { SplitTabEntry } from './SplitTabEntry'
import { groupTabEntries } from '../../../shared/split-view'
import { dropTargetGroup, TAB_GROUP_COLOR_VALUES, withGroupHeaders } from '../../../shared/tab-groups'
import { useTabSelection } from './tab-groups/useTabSelection'
import { TabGroupHeader } from './tab-groups/TabGroupHeader'
import { useGroupReveal } from './tab-groups/useGroupReveal'
import { BRAMBLE_TOOLBAR_ID, ExtensionToolbarButtons, useExtensionPins } from './ExtensionToolbarButtons'
import { runExtensionAction, useWebStoreExtensions } from './useWebStoreExtensions'
import { isChromeWebStoreDetailUrl } from '../../../shared/chrome-web-store'
import { formatTemperature, weatherProviderLabel } from '../../../shared/weather'
import { conditionFromDescription, forecastDayCount, forecastDayLabel, formatTemperatureShort, largestWeatherFit, placeToday, visibleForecast } from '../../../shared/weather-forecast'
import WeatherGlyph, { RainChanceGlyph } from './new-tab/WeatherGlyph'
import { clockGreeting, clockShift, formatClockDate, formatClockTime, formatZoneDifference, relativeClockDay, zoneDifferenceMinutes } from '../../../shared/new-tab-clock'
import { useBookmarks, bookmarkOrigin } from './bookmarks/useBookmarks'
import { BookmarkStarControl } from './bookmarks/BookmarkStarControl'
import { BookmarksMenuButton } from './bookmarks/BookmarksMenu'
import { ReadingListButton } from './reading-list/ReadingListButton'
import { AdblockButton } from './adblock/AdblockButton'
import { BookmarksBar } from './bookmarks/BookmarksBar'
import { SpacesSwitcher, useSpaces } from './spaces/SpacesSwitcher'
import { SPACE_COLOR_VALUES } from '../../../shared/spaces'
import { BrowserNotice, LoadErrorNotice, LoadErrorPage } from './BrowserNotice'
import { describeLoadError, INVALID_ADDRESS_COPY } from '../../../shared/navigation-errors'
// Rarely opened views load on first use (lazy-views); the hooks the always-on UI needs stay eager.
import {
  AppearanceSettings, ArchivedTabsSidebar, BookmarkImportPanel, BookmarksManager, CommandPaletteSettings, DefaultBrowserSettings,
  DiagnosticsView, DownloadsPanel, ExtensionsSettings, NetworkRulesSettings, NetworkView, PageWatchersSettings, FeedsSettings, BrambleQuickUnlockSettings, PrivacySettings,
  MemorySaverSettings, PreloadPagesSettings, ProxyKillSwitchSetting, SearchKeywordsSettings, SpacesSettings, SpellcheckSettings,
  TabArchiveSettings, UpdateSettings, NewTabSettingsFields, NewTabCustomizePanel, preloadNewTabCustomizePanel, SitesSettings
} from './lazy-views'
import { PageWatchersToggle, CertificateViewer, GlanceSettings, LocalAISettings, MiniWindowSettings } from './lazy-views'
import { siteConnectionSummary, type SiteCertificateInfo } from '../../../shared/certificates'
import { useNetworkToolEnabled } from './useNetworkToolEnabled'
import { useTabUsageHints, withTabUsageHint } from './tabUsageHints'
import { usePageWatchersEnabled, useUnseenWatcherCount } from './settings/useWatchers'
import { sidebarModeForWatchers, visibleWatcherSections } from '../../../shared/page-watchers-feature'
import { useUnreadFeedCount } from './settings/useFeeds'
import './Browser.css'
import './bookmarks/bookmarks.css'
import './toolbar-popovers.css'
import './toolbar-icons.css'
import { SidebarBackdropLayer, sidebarBackdropClass, useSidebarBackdrop } from './SidebarBackdrop'
import './SidebarBackdrop.css'
import './motion.css'

const DEFAULT_PROXY: BrowserProxySettings = { enabled: true, host: '127.0.0.1', port: 1080, bypassLocalNetwork: true }
const BONJOURR_START_PAGE = 'https://online.bonjourr.fr/'
/** New Tab layout (Browser.css): the icon track's gap under the clocks and its inset above the photo credit. */
const NEW_TAB_ICON_GAP = 14
const NEW_TAB_CREDIT_SPACE = 58
/** New Tab settings edits are saved to main at most this often (a slider drag is many patches). */
const NEW_TAB_SAVE_COALESCE_MS = 150
/** Preference broadcasts arriving this soon after a local edit are our own older values: ignored. */
const NEW_TAB_ECHO_GUARD_MS = 700
const FALLBACK_NEW_TAB_BACKGROUNDS: NewTabBackground[] = [
  {
    id: 'fallback-forest-lake',
    src: forestLake,
    title: 'Forest lake',
    creator: 'Pixel.la Free Stock Photos',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Landscape-nature-forest-lake_(24300004076).jpg',
    licenseName: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'
  },
  {
    id: 'fallback-mountain-lake',
    src: mountainLake,
    title: 'Tranquil mountain lake',
    creator: 'Andrew Spencer',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tranquil_mountain_lake_(Unsplash).jpg',
    licenseName: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'
  }
]
function withOfflinePhotoFallbacks(photos: readonly NewTabBackground[]): NewTabBackground[] {
  const combined = [
    ...photos,
    ...FALLBACK_NEW_TAB_BACKGROUNDS.filter((fallback) => !photos.some((photo) => photo.id === fallback.id))
  ].slice(0, 2)
  return combined.length > 0 ? combined : [...FALLBACK_NEW_TAB_BACKGROUNDS]
}
const EMPTY_BROWSER: BrowserState = {
  url: BONJOURR_START_PAGE,
  title: 'Bonjourr',
  loading: true,
  canGoBack: false,
  canGoForward: false,
  error: null,
  private: false,
  zoomFactor: 1,
  pdf: null,
  reader: null,
  interstitial: null,
  loadError: null
}
/** navigationError value for address-bar input that can't be opened (shown with its own copy). */
const INVALID_ADDRESS_ERROR = `${INVALID_ADDRESS_COPY.title}. ${INVALID_ADDRESS_COPY.detail}`
const EMPTY_BRAMBLE_POC: BrambleExtensionState = {
  installed: false,
  loading: false,
  version: null,
  latestVersion: null,
  updateAvailable: false,
  popupOpen: false,
  error: null,
  notice: null,
  permissions: [],
  hostPermissions: [],
  iconDataUrl: null
}

type SidebarMode = BrowserSidebarMode
type BrowserSurface = 'content' | 'toolbar' | 'sidebar'

const DEFAULT_CHROME_STATE: BrowserChromeState = {
  sidebarMode: 'tabs',
  sidebarPinned: false,
  sidebarHovered: false,
  sidebarFocused: false,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarResizing: false
}

function isSettingsSection(mode: SidebarMode): boolean {
  return mode === 'settings' || mode === 'newtab' || mode === 'integrations' || mode === 'site' || mode === 'network' || mode === 'privacy' || mode === 'diagnostics' || mode === 'watchers' || mode === 'feeds'
}

type SettingsSectionMode = Extract<SidebarMode, 'settings' | 'newtab' | 'integrations' | 'site' | 'network' | 'privacy' | 'diagnostics' | 'watchers' | 'feeds'>

/** Settings → Integrations has sub-areas; each is its own sidebar mode so links can land on one directly. */
const INTEGRATIONS_TABS: ReadonlyArray<{ mode: Extract<SettingsSectionMode, 'integrations' | 'feeds'>; label: string }> = [
  { mode: 'integrations', label: 'Extensions' },
  { mode: 'feeds', label: 'Feeds' }
]

/** The top-level settings nav entry a mode belongs to (Feeds lives under Integrations). */
function settingsNavMode(mode: SidebarMode): SidebarMode {
  return mode === 'feeds' ? 'integrations' : mode
}

const SETTINGS_SECTIONS: ReadonlyArray<{ mode: SettingsSectionMode; label: string }> = [
  { mode: 'settings', label: 'General' },
  { mode: 'newtab', label: 'New Tab' },
  { mode: 'integrations', label: 'Integrations' },
  { mode: 'privacy', label: 'Privacy' },
  { mode: 'watchers', label: 'Watchers' },
  { mode: 'site', label: 'Sites' },
  { mode: 'network', label: 'Network' },
  { mode: 'diagnostics', label: 'Diagnostics' }
]

/** General is long: its groups sit in these categories (sticky headings + the jump list beside them). */
const GENERAL_CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'browsing', label: 'Browsing' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'tabs', label: 'Tabs & windows' },
  { id: 'mini-window', label: 'Mini window' },
  { id: 'features', label: 'Features' },
  { id: 'connection', label: 'Connection' },
  { id: 'advanced', label: 'Advanced' }
]

function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

function historyHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function NewTabSiteIcon({ site, faviconUrl, showLabel, iconSize, onOpen }: { site: QuickLinkSite; faviconUrl?: string | null; showLabel: boolean; iconSize: number; onOpen: () => void }): React.JSX.Element {
  const fallbackFaviconUrl = `${site.origin}/favicon.ico`
  const preferredFaviconUrl = faviconUrl ?? site.faviconUrl ?? fallbackFaviconUrl
  const [iconFailed, setIconFailed] = useState(false)
  const [iconSource, setIconSource] = useState(preferredFaviconUrl)
  useEffect(() => {
    setIconFailed(false)
    setIconSource(preferredFaviconUrl)
  }, [preferredFaviconUrl])
  const hostname = new URL(site.origin).hostname.replace(/^www\./i, '')
  return (
    <button className={`new-tab-icon-tile${showLabel ? ' has-label' : ''}`} style={{ width: iconSize, minHeight: iconSize }} type="button" onClick={onOpen} title={`Open ${site.title} · ${site.origin}`} aria-label={`Open ${site.title}, ${hostname}`}>
      <span className="new-tab-site-icon" aria-hidden="true">
        {!iconFailed && <img src={iconSource} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => {
          const nextSource = iconSource === faviconUrl ? site.faviconUrl ?? fallbackFaviconUrl : fallbackFaviconUrl
          if (nextSource && iconSource !== nextSource) setIconSource(nextSource)
          else setIconFailed(true)
        }} />}
        {iconFailed && <span>{site.title.trim().slice(0, 1).toUpperCase() || hostname.slice(0, 1).toUpperCase() || '↗'}</span>}
      </span>
      {showLabel && <span className="new-tab-link-label">{site.title}</span>}
    </button>
  )
}

function PinnedSiteIcon({ site, cachedFaviconUrl, onOpen, onUnpin }: { site: PinnedSite; cachedFaviconUrl?: string | null; onOpen: () => void; onUnpin: () => void }): React.JSX.Element {
  const quickLink = toQuickLinkSite(site)
  const fallbackFaviconUrl = quickLink ? `${quickLink.origin}/favicon.ico` : null
  const preferredFaviconUrl = quickLink ? cachedFaviconUrl ?? site.faviconUrl ?? fallbackFaviconUrl : null
  const [iconFailed, setIconFailed] = useState(false)
  const [iconSource, setIconSource] = useState(preferredFaviconUrl)
  useEffect(() => {
    setIconFailed(false)
    setIconSource(preferredFaviconUrl)
  }, [preferredFaviconUrl])
  const hostname = quickLink ? new URL(quickLink.origin).hostname.replace(/^www\./i, '') : historyHost(site.url)
  return (
    <button className="pinned-site-icon-button" type="button" title={`${site.title} · ${hostname} (right-click to remove bookmark)`} aria-label={`Open bookmark ${site.title}`} onClick={onOpen} onContextMenu={(event) => {
      event.preventDefault()
      onUnpin()
    }}>
      <span className="pinned-site-mark" aria-hidden="true">
        {quickLink && iconSource && !iconFailed && <img src={iconSource} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => {
          const nextSource = iconSource === cachedFaviconUrl ? site.faviconUrl ?? fallbackFaviconUrl : fallbackFaviconUrl
          if (nextSource && iconSource !== nextSource) setIconSource(nextSource)
          else setIconFailed(true)
        }} />}
        {(!quickLink || iconFailed) && <span>{site.title.trim().slice(0, 1).toUpperCase() || hostname.slice(0, 1).toUpperCase() || '↗'}</span>}
      </span>
    </button>
  )
}

/** Text with each occurrence of the typed query marked (suggestion titles). */
function HighlightedText({ text, query }: { text: string; query: string }): React.JSX.Element {
  return <>{highlightMatches(text, query).map((part, index) => part.match ? <mark key={index} className="suggestion-match">{part.text}</mark> : <span key={index}>{part.text}</span>)}</>
}

function SuggestionFavicon({ url, title, faviconUrl }: { url: string; title: string; faviconUrl?: string | null }): React.JSX.Element {
  const origin = httpOrigin(url)
  const candidates = useMemo(
    () => [...new Set([faviconUrl, origin ? `${origin}/favicon.ico` : null].filter((value): value is string => Boolean(value)))],
    [faviconUrl, origin]
  )
  const [candidateIndex, setCandidateIndex] = useState(0)
  useEffect(() => setCandidateIndex(0), [candidates])
  const source = candidates[candidateIndex]
  const host = origin ? new URL(origin).hostname.replace(/^www\./i, '') : ''
  const letter = title.trim().slice(0, 1).toUpperCase() || host.slice(0, 1).toUpperCase() || '↗'
  return source
    ? <img src={source} alt="" referrerPolicy="no-referrer" onError={() => setCandidateIndex((index) => index + 1)} />
    : <span>{letter}</span>
}

export default function Browser({ surface }: { surface: BrowserSurface }): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  // Settings search: filters whichever settings page is on screen (see useSettingsSearch).
  const [settingsQuery, setSettingsQuery] = useState('')
  const browserChromeRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarPointerInsideRef = useRef(false)
  const sidebarResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number; width: number } | null>(null)
  const sidebarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const brambleButtonRef = useRef<HTMLButtonElement>(null)
  const siteActionsControlRef = useRef<HTMLDivElement>(null)
  const siteActionsButtonRef = useRef<HTMLButtonElement>(null)
  const downloadsControlRef = useRef<HTMLDivElement>(null)
  const downloadsButtonRef = useRef<HTMLButtonElement>(null)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  // Triple-click the Surffish logo (top right of the toolbar).
  const brandEgg = useBrandTripleClick()
  const [browser, setBrowser] = useState<BrowserState>(EMPTY_BROWSER)
  const [tabs, setTabs] = useState<BrowserTabSummary[]>([])
  const spaces = useSpaces()
  const activeSpace = spaces?.enabled ? spaces.spaces.find((space) => space.id === spaces.activeSpaceId) : undefined
  // A split view is one sidebar entry (keyed by its first tab), so it sorts and drags as one.
  // Tab groups add a header entry (`group:<id>`) before each group's run and hide collapsed runs.
  const tabEntries = useMemo(() => withGroupHeaders(groupTabEntries(tabs.filter((tab) => !tab.pinned)), (entry) => (entry.kind === 'split' ? entry.tabs[0] : entry.tab)?.group), [tabs])
  const tabEntriesByKey = useMemo(() => new Map(tabEntries.map((entry) => [entry.key, entry])), [tabEntries])
  const unpinnedTabIds = useMemo(() => tabEntries.map((entry) => entry.key), [tabEntries])
  const tabDrag = useTabDragSort(unpinnedTabIds, moveSidebarEntry, (key) => {
    if (key.startsWith('group:')) void window.api.browser.tabGroups.dropOutside(key.slice('group:'.length))
    else void window.api.browser.tabs.dropOutside(key)
  }, (key) => {
    // Outside the window: a mini window under the pointer shows where the tab would join it.
    window.api.browser.tabs.dragOutside(key && !key.startsWith('group:') ? key : null)
  })
  // A mini window's tab dragged over this sidebar: a line where it would land (main says which row).
  useEffect(() => window.api.browser.tabs.onExternalDrop((hint) => {
    const list = tabDrag.listRef.current
    if (!list) return
    for (const el of list.querySelectorAll('[data-external-drop]')) el.removeAttribute('data-external-drop')
    list.toggleAttribute('data-external-drop-end', hint !== null && hint.beforeId === null)
    if (!hint?.beforeId) return
    list.querySelector(`[data-browser-tab-id="${CSS.escape(hint.beforeId)}"]`)?.setAttribute('data-external-drop', 'before')
  }), [tabDrag.listRef])
  /** A sidebar entry key as a tab id main understands: a group header stands for its first tab. */
  function entryTabId(key: string | null): string | null {
    if (!key?.startsWith('group:')) return key
    const groupId = key.slice('group:'.length)
    return tabs.find((tab) => tab.group?.id === groupId)?.id ?? null
  }
  /** Drop handler: a header moves its whole group; a tab (or split) lands in the group it was dropped into, or none. */
  function moveSidebarEntry(key: string, beforeKey: string | null): void {
    if (key.startsWith('group:')) {
      void window.api.browser.tabGroups.move(key.slice('group:'.length), entryTabId(beforeKey))
      return
    }
    const order = unpinnedTabIds.filter((candidate) => candidate !== key)
    const at = beforeKey ? order.indexOf(beforeKey) : -1
    order.splice(at < 0 ? order.length : at, 0, key)
    const groupOfKey = (candidate: string): string | null => tabs.find((tab) => tab.id === candidate)?.group?.id ?? null
    const target = dropTargetGroup(order, key, groupOfKey, (groupId) => tabs.some((tab) => tab.group?.id === groupId && tab.group.collapsed))
    void window.api.browser.tabGroups.moveTab(key, entryTabId(beforeKey), target)
  }
  const [bramblePoc, setBramblePoc] = useState<BrambleExtensionState>(EMPTY_BRAMBLE_POC)
  const [webStoreExtensions, setWebStoreExtensions] = useWebStoreExtensions()
  const [history, setHistory] = useState<BrowsingHistoryEntry[]>([])
  const historyStaleRef = useRef(true)
  const bookmarks = useBookmarks()
  // The strip and new tab favourites: the first bookmarks directly in Favourites.
  const pinnedSites = useMemo<PinnedSite[]>(() => (bookmarks.index.children.get(FAVOURITES_FOLDER_ID) ?? [])
    .filter((node) => node.type === 'bookmark' && node.url)
    .slice(0, MAX_PINNED_SITES)
    .map((node) => ({ title: node.title, url: node.url!, ...(node.faviconUrl ? { faviconUrl: node.faviconUrl } : {}) })), [bookmarks.index])
  const bookmarkSuggestions = useMemo(() => bookmarks.nodes.flatMap((node) => node.type === 'bookmark' && node.url ? [{ title: node.title, url: node.url }] : []), [bookmarks.nodes])
  const [bookmarkPopoverOpen, setBookmarkPopoverOpen] = useState(false)
  // Bookmarks dropdown (next to the address bar) and the optional bookmarks bar (⌘⇧B, off by default).
  const [bookmarksMenuOpen, setBookmarksMenuOpen] = useState(false)
  const [readingListOpen, setReadingListOpen] = useState(false)
  const [adblockOpen, setAdblockOpen] = useState(false)
  const [bookmarksBarMenuOpen, setBookmarksBarMenuOpen] = useState(false)
  const [bookmarksMenuLayout, setBookmarksMenuLayout] = useState(0)
  const bumpBookmarksMenuLayout = useCallback(() => setBookmarksMenuLayout((value) => value + 1), [])
  const [bookmarksBarVisible, setBookmarksBarVisible] = useState(false)
  useEffect(() => {
    if (surface === 'sidebar') return
    let mounted = true
    const unsubscribe = window.api.browser.bookmarks.bar.onChange((visible) => { if (mounted) setBookmarksBarVisible(visible) })
    void window.api.browser.bookmarks.bar.get().then((visible) => { if (mounted) setBookmarksBarVisible(visible) }).catch(() => undefined)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [surface])
  const [cachedSiteIcons, setCachedSiteIcons] = useState<Record<string, string>>({})
  const [chromeState, setChromeState] = useState<BrowserChromeState>(DEFAULT_CHROME_STATE)
  const { sidebarMode, sidebarPinned, sidebarHovered, sidebarFocused, sidebarWidth, sidebarResizing } = chromeState
  // The Settings tab (shared/settings-tab.ts): main says which page it shows; a section picked here
  // shows at once (until main's answer, with a newer revision, lands).
  const settingsTab = browser.settings ?? null
  const [settingsSectionPick, setSettingsSectionPick] = useState<{ section: SettingsSectionMode; revision: number } | null>(null)
  const settingsMode: SettingsSectionMode | null = settingsTab
    ? (settingsSectionPick && settingsSectionPick.revision === settingsTab.revision ? settingsSectionPick.section : settingsTab.section)
    : null
  // What the page area shows: a full panel (Downloads, Bookmarks) over anything, else Settings, else the sidebar mode.
  // Only the content surface draws Settings (the toolbar and sidebar views never load its chunk).
  const pageMode: SidebarMode = sidebarMode === 'downloads' || sidebarMode === 'bookmarks' ? sidebarMode : (surface === 'content' ? settingsMode : null) ?? sidebarMode
  const settingsOnScreen = surface === 'content' && settingsMode !== null && pageMode === settingsMode
  // Watchers with a change the user hasn't opened yet (badge on Settings → Watchers). Content surface only.
  // Settings → General → "Enable page watchers": off hides the Watchers section and its badge.
  const watchersEnabled = usePageWatchersEnabled()
  const unseenWatchers = useUnseenWatcherCount(surface === 'content' && watchersEnabled === true)
  // Only while Settings is open, so launch never loads the feeds module for a badge.
  const unreadFeeds = useUnreadFeedCount(settingsOnScreen)
  const settingsSearch = useSettingsSearch(viewportRef, settingsOnScreen ? settingsQuery : '', pageMode)
  const [historyQuery, setHistoryQuery] = useState('')
  const [address, setAddress] = useState(EMPTY_BROWSER.url)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  // Arrowing onto a suggestion fills the bar with its URL; this remembers what was typed (the
  // dropdown keeps matching it, Esc puts it back). null while the bar shows the user's own text.
  const [omniboxPreview, setOmniboxPreview] = useState<OmniboxPreview | null>(null)
  const activeSuggestionIndex = omniboxPreview ? omniboxPreview.index : -1
  const omniboxCaretToEndRef = useRef(false)
  const [searchEngine, setSearchEngine] = useState<SearchEngineId>(DEFAULT_SEARCH_ENGINE)
  const [newTabPage, setNewTabPage] = useState<NewTabPageId>('quick-links')
  const [newTabPreferences, setNewTabPreferences] = useState<NewTabPreferences>(() => ({ ...DEFAULT_NEW_TAB_PREFERENCES, worldClocks: [] }))
  const [newTabBackgrounds, setNewTabBackgrounds] = useState<NewTabBackground[]>(FALLBACK_NEW_TAB_BACKGROUNDS)
  const [newTabBackgroundIndex, setNewTabBackgroundIndex] = useState(
    () => getQuickLinkBackgroundIndex(Date.now(), FALLBACK_NEW_TAB_BACKGROUNDS.length)
  )
  const [photoRefreshBusy, setPhotoRefreshBusy] = useState(false)
  const [photoRefreshStatus, setPhotoRefreshStatus] = useState('')
  const [clockNow, setClockNow] = useState(() => new Date())
  const [newTabWeather, setNewTabWeather] = useState<NewTabWeatherSnapshot | null>(null)
  const [newTabWeatherError, setNewTabWeatherError] = useState('')
  const [newTabWeatherLoading, setNewTabWeatherLoading] = useState(false)
  const newTabPreferencesRef = useRef(newTabPreferences)
  const newTabLocalEditAtRef = useRef(-Infinity)
  const newTabSaveTimerRef = useRef(0)
  const [newTabCustomizeOpen, setNewTabCustomizeOpen] = useState(false)
  /** Bumped when a weather API key changes, so the reading reloads at once. */
  const [newTabWeatherKeyVersion, setNewTabWeatherKeyVersion] = useState(0)
  /** Provider + model + place of the reading on screen (see the weather effect). */
  const newTabWeatherIdentityRef = useRef('')
  /** The panel's chunk has been asked for (first hover / focus / open of the gear); then it stays mounted. */
  const [newTabCustomizeLoaded, setNewTabCustomizeLoaded] = useState(false)
  const newTabGearRef = useRef<HTMLButtonElement>(null)
  const [tabSleepMinutes, setTabSleepMinutes] = useState<TabSleepMinutes>(30)
  const [searchEngineLoaded, setSearchEngineLoaded] = useState(false)
  const [downloadsPopupOpen, setDownloadsPopupOpen] = useState(false)
  const [siteActionsOpen, setSiteActionsOpen] = useState(false)
  /** The site menu's certificate viewer: null = menu, 'loading' / info = viewer open. */
  const [certificateView, setCertificateView] = useState<SiteCertificateInfo | 'loading' | 'missing' | null>(null)
  const [extensionsMenuOpen, setExtensionsMenuOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const extensionPins = useExtensionPins()
  const [networkToolEnabled, setNetworkToolEnabled] = useNetworkToolEnabled()
  const [proxy, setProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [appliedProxy, setAppliedProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [busy, setBusy] = useState(false)
  const [proxyMessage, setProxyMessage] = useState('')
  const [sessionMessage, setSessionMessage] = useState('')
  const [navigationError, setNavigationError] = useState('')
  // Load-error notices the user closed, per tab + error (a new failure shows again).
  const [dismissedLoadErrors, setDismissedLoadErrors] = useState<string[]>([])
  const [proxyMessageIsError, setProxyMessageIsError] = useState(false)
  function updateChromeState(patch: Partial<BrowserChromeState>): void {
    setChromeState((current) => ({ ...current, ...patch }))
    void window.api.browser.chrome.set(patch).catch(() => undefined)
  }

  function persistSidebarWidth(value: number): void {
    const width = normalizeSidebarWidth(value)
    updateChromeState({ sidebarWidth: width, sidebarResizing: false })
    void window.api.browser.sidebarWidth.set(width).then((savedWidth) => {
      setChromeState((current) => ({ ...current, sidebarWidth: savedWidth, sidebarResizing: false }))
    }).catch(() => undefined)
  }

  function beginSidebarResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    event.preventDefault()
    sidebarResizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarWidth, width: sidebarWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
    updateChromeState({ sidebarResizing: true })
  }

  function moveSidebarResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const resize = sidebarResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    // The button went up somewhere this document never heard about (outside the view or window):
    // the drag is over, don't keep resizing (and holding the sidebar) on plain moves.
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) return finishSidebarResize(event)
    event.preventDefault()
    const width = normalizeSidebarWidth(resize.startWidth + event.clientX - resize.startX)
    if (width === resize.width) return
    resize.width = width
    updateChromeState({ sidebarWidth: width, sidebarResizing: true })
  }

  function finishSidebarResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const resize = sidebarResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    sidebarResizeRef.current = null
    persistSidebarWidth(resize.width)
    if (!sidebarPinned && event.clientX >= resize.width) scheduleSidebarHide()
  }

  function handleSidebarResizeKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    let nextWidth: number | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextWidth = sidebarWidth - 10
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextWidth = sidebarWidth + 10
    else if (event.key === 'Home') nextWidth = MIN_SIDEBAR_WIDTH
    else if (event.key === 'End') nextWidth = MAX_SIDEBAR_WIDTH
    if (nextWidth === null) return
    event.preventDefault()
    persistSidebarWidth(nextWidth)
  }

  // A slider drag patches many times a second: the page follows every step at once, the save to
  // main is coalesced, and main's broadcasts of our own (older) values are ignored while we edit, so
  // the icons never jump back mid-drag (NEW_TAB_ECHO_GUARD_MS).
  newTabPreferencesRef.current = newTabPreferences
  function saveNewTabPreferences(next: NewTabPreferences): void {
    newTabPreferencesRef.current = next
    newTabLocalEditAtRef.current = performance.now()
    setNewTabPreferences(next)
    window.clearTimeout(newTabSaveTimerRef.current)
    newTabSaveTimerRef.current = window.setTimeout(() => {
      void window.api.browser.newTabPreferences.set(newTabPreferencesRef.current).catch(() => undefined)
    }, NEW_TAB_SAVE_COALESCE_MS)
  }

  function patchNewTabPreferences(patch: Partial<NewTabPreferences>): void {
    saveNewTabPreferences({ ...newTabPreferencesRef.current, ...patch })
  }

  function setSidebarMode(next: SidebarMode | ((current: SidebarMode) => SidebarMode)): void {
    updateChromeState({ sidebarMode: typeof next === 'function' ? next(chromeState.sidebarMode) : next })
  }

  function setSidebarPinned(next: boolean | ((current: boolean) => boolean)): void {
    updateChromeState({ sidebarPinned: typeof next === 'function' ? next(chromeState.sidebarPinned) : next })
  }

  function setSidebarHovered(next: boolean): void {
    updateChromeState({ sidebarHovered: next })
  }

  function setSidebarFocused(next: boolean): void {
    updateChromeState({ sidebarFocused: next })
  }

  useEffect(() => {
    const unsubscribe = window.api.browser.chrome.onChange(setChromeState)
    void window.api.browser.chrome.get().then(setChromeState).catch(() => undefined)
    return unsubscribe
  }, [])

  const sidebarVisible = sidebarPinned || sidebarHovered || sidebarFocused || sidebarMode !== 'tabs'
  const sidebarBackdrop = useSidebarBackdrop(surface === 'sidebar', `${tabs.find((tab) => tab.active)?.id ?? ''}|${browser.url}|${browser.loading}`, sidebarVisible)
  // Only build suggestions while the dropdown is open, and never in the sidebar surface (it has no
  // address bar). Otherwise every tab/history update re-ran the matcher in all three renderers.
  const suggestionsActive = suggestionsOpen && surface !== 'sidebar'
  // While a suggestion is filled in, the dropdown keeps matching what the user typed.
  const addressQuery = omniboxQuery(address, omniboxPreview)
  const addressSuggestions = useMemo(
    // Favourites come first in tree order, so the old pinned-site ranking holds without a separate list.
    () => suggestionsActive ? buildAddressSuggestions(addressQuery, [], tabs, history, 7, bookmarkSuggestions) : [],
    [suggestionsActive, addressQuery, tabs, history, bookmarkSuggestions]
  )
  // "yt cats" / "cats !yt": show which engine the address bar will use.
  const searchKeywordEngines = useSearchKeywords(surface !== 'sidebar')
  const keywordMatch = useMemo(
    () => suggestionsActive ? parseKeywordSearch(addressQuery, searchKeywordEngines) : null,
    [suggestionsActive, addressQuery, searchKeywordEngines]
  )
  const favoriteSites = useMemo(() => pinnedSites.map(toQuickLinkSite).filter((site): site is QuickLinkSite => site !== null), [pinnedSites])
  const frequentlyVisitedSites = useMemo(() => buildFrequentSites(history, pinnedSites), [history, pinnedSites])
  const newTabSites = useMemo(() => [...favoriteSites, ...frequentlyVisitedSites], [favoriteSites, frequentlyVisitedSites])
  const siteIconOrigins = useMemo(
    () => [...new Set([
      // Suggestion rows first, so the dropdown's icons are always inside the cap.
      ...addressSuggestions.map((suggestion) => httpOrigin(suggestion.url)).filter((origin): origin is string => Boolean(origin)),
      ...newTabSites.map((site) => site.origin),
      ...bookmarkSuggestions.slice(0, 400).map((bookmark) => bookmarkOrigin(bookmark.url)).filter((origin): origin is string => Boolean(origin))
    ])].slice(0, 128),
    [addressSuggestions, newTabSites, bookmarkSuggestions]
  )
  // The origin list is rebuilt on every tab/history update (new array, same origins); key the fetch
  // on its content so a tab update doesn't re-ask main for every icon from all three surfaces.
  const siteIconOriginsKey = siteIconOrigins.join('\n')
  useEffect(() => window.api.browser.siteIcons.onChange(({ origin, faviconUrl }) => {
    setCachedSiteIcons((current) => current[origin] === faviconUrl ? current : { ...current, [origin]: faviconUrl })
  }), [])
  useEffect(() => {
    if (!siteIconOriginsKey) return
    let cancelled = false
    void window.api.browser.siteIcons.get(siteIconOriginsKey.split('\n')).then((icons) => {
      if (!cancelled) setCachedSiteIcons((current) => ({ ...icons, ...current }))
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [siteIconOriginsKey])
  const isLocalNewTab = browser.url === SURFFISH_QUICK_LINKS_URL
  // A tab the content renderer draws (no site, no page view): the New Tab or Settings.
  const isLocalPage = isLocalNewTab || settingsTab !== null
  const hasInterstitial = browser.interstitial !== null
  // A main-frame load failure leaves an empty error page: show the in-page error over it instead.
  const hasLoadErrorPage = !hasInterstitial && browser.loadError?.fullPage === true
  const coversPage = hasInterstitial || hasLoadErrorPage
  const activeTabId = tabs.find((tab) => tab.active)?.id ?? ''
  const loadErrorKey = browser.error && browser.loadError ? `${activeTabId}\n${browser.error}\n${browser.loadError.url}` : ''
  const showLoadErrorNotice = loadErrorKey !== '' && !coversPage && !dismissedLoadErrors.includes(loadErrorKey)
  const newTabBackground = newTabBackgrounds[newTabBackgroundIndex] ?? newTabBackgrounds[0]!
  // The New Tab page (clock, photos) is only on screen in the content surface, on a New Tab,
  // with no settings/downloads panel over it. Nothing behind it needs to tick otherwise.
  const newTabOnScreen = surface === 'content' && isLocalNewTab && sidebarMode !== 'downloads'
  // Leaving the New Tab (a site opened from it, a tab switch) closes the Customize panel. Opening it
  // from Settings while on a site sets it open before the New Tab arrives, so only a true → false
  // change of isLocalNewTab closes it.
  const wasLocalNewTabRef = useRef(isLocalNewTab)
  useEffect(() => {
    if (wasLocalNewTabRef.current && !isLocalNewTab) setNewTabCustomizeOpen(false)
    wasLocalNewTabRef.current = isLocalNewTab
  }, [isLocalNewTab])
  // Weather sits on its own line under the clocks (or in the top-right corner): one quiet row,
  // temperature first, so it never competes with the time on the clock line.
  const newTabWeatherPlacement = newTabPreferences.weatherEnabled && (newTabPreferences.weatherPlace || newTabPreferences.weatherLocation.trim()) ? newTabPreferences.weatherPosition : null
  // Forecast view (Settings → New Tab → Weather): today's high/low or 3/5/7 daily columns under the
  // reading, as far as the provider goes. Private tabs keep the single-line reading.
  const newTabForecastView = browser.private ? 'current' : newTabPreferences.weatherForecast
  const newTabWantsDaily = forecastDayCount(newTabForecastView) > 0
  const newTabPlaceToday = newTabWeather && newTabWantsDaily ? placeToday(newTabWeather.place.timeZone, clockNow.getTime()) : undefined
  const newTabForecast = newTabWeather && newTabWantsDaily ? visibleForecast(newTabForecastView, newTabWeather.provider, newTabWeather.daily, newTabPlaceToday) : null
  const newTabForecastToday = newTabForecast?.days[0]
  const newTabWeatherHasRows = newTabForecastView !== 'today' && Boolean(newTabForecast?.days.length)
  const newTabWeatherCornerRef = useRef<HTMLDivElement>(null)
  const weatherUnit = newTabPreferences.temperatureUnit
  const newTabWeatherWidget = newTabWeatherPlacement && (
    <div
      className={`new-tab-weather-widget is-${newTabWeatherPlacement}${newTabWeatherPlacement === 'corner' && newTabCustomizeOpen ? ' is-beside-panel' : ''}${newTabWeatherHasRows ? ' has-forecast' : ''}`}
      style={{ '--new-tab-weather-size': (newTabPreferences.weatherScale / 100).toFixed(2) } as React.CSSProperties}
      ref={newTabWeatherPlacement === 'corner' ? newTabWeatherCornerRef : undefined}
      role="status"
      aria-live="polite"
    >
      {newTabWeatherLoading && !newTabWeather ? <span>Loading weather…</span>
        : newTabWeatherError ? <span>{newTabWeatherError}</span>
          : newTabWeather ? <>
            <strong>{newTabWantsDaily && <WeatherGlyph condition={newTabWeather.condition ?? conditionFromDescription(newTabWeather.description)} />}{formatTemperature(newTabWeather.temperatureCelsius, weatherUnit)} · {newTabWeather.description}</strong>
            <small title={newTabWeather.location}>{weatherProviderLabel(newTabWeather.provider)} · {newTabWeather.location.split(',')[0]}{newTabForecast?.capped ? ` · ${newTabForecast.limit}-day max` : ''}</small>
            {newTabWeather.notice && <small className="new-tab-weather-notice">{newTabWeather.notice}</small>}
            {newTabForecastView === 'today' && newTabForecastToday && (
              <small className="new-tab-weather-today" aria-label="Today's high and low">
                <span>↑{formatTemperatureShort(newTabForecastToday.highCelsius, weatherUnit)}</span><span>↓{formatTemperatureShort(newTabForecastToday.lowCelsius, weatherUnit)}</span>
                {newTabForecastToday.precipitationChance !== null && <span className="new-tab-weather-pop"><RainChanceGlyph />{newTabForecastToday.precipitationChance}%</span>}
              </small>
            )}
            {newTabWeatherHasRows && newTabForecast && (
              <ol className="new-tab-weather-days" aria-label="Forecast">
                {newTabForecast.days.map((day, index) => (
                  <li key={day.date}>
                    <span className="new-tab-weather-day">{forecastDayLabel(day.date, newTabPlaceToday, index)}</span>
                    <WeatherGlyph condition={day.condition} label={day.description} />
                    <span className="new-tab-weather-hi">{formatTemperatureShort(day.highCelsius, weatherUnit)}</span>
                    <span className="new-tab-weather-lo">{formatTemperatureShort(day.lowCelsius, weatherUnit)}</span>
                    <span className="new-tab-weather-pop">{day.precipitationChance !== null && <><RainChanceGlyph />{day.precipitationChance}%</>}</span>
                  </li>
                ))}
              </ol>
            )}
          </>
            : <span>Weather unavailable</span>}
    </div>
  )
  // The icons' free space starts under the clocks / weather: their bottom edge as a CSS variable,
  // written straight to the style (ResizeObserver runs before paint, so no re-render or jump).
  // Clock position: the clocks move down by a share of the space left above the icons' own height
  // (page height − top spot − clocks − icons − photo credit), so at 100 % they sit just above the
  // icons and never push them off the page. Private tabs keep the hero layout (no shift).
  const newTabWidgetsRef = useRef<HTMLDivElement>(null)
  const newTabWidgetsLayoutRef = useRef<(() => void) | null>(null)
  const clockVerticalPositionRef = useRef(newTabPreferences.clockVerticalPosition)
  clockVerticalPositionRef.current = newTabPreferences.clockVerticalPosition
  const hasNewTabWidgets = newTabOnScreen && (newTabPreferences.showClock || newTabPreferences.worldClocks.length > 0 || newTabWeatherPlacement === 'below' || newTabPreferences.showGreeting)
  // A corner forecast is several rows tall: the clocks and icons make room for it (below).
  const hasCornerForecast = newTabOnScreen && newTabWeatherPlacement === 'corner' && newTabWantsDaily
  useLayoutEffect(() => {
    const widgets = newTabWidgetsRef.current
    const corner = newTabWeatherCornerRef.current
    const page = (widgets ?? corner)?.closest<HTMLElement>('.new-tab-page')
    if ((!widgets && !corner) || !page) return
    let observedIcons: HTMLElement | null = null
    const write = (): void => {
      const track = page.querySelector<HTMLElement>('.new-tab-icon-track')
      const icons = track?.firstElementChild instanceof HTMLElement ? track.firstElementChild : null
      if (icons !== observedIcons) {
        if (observedIcons) observer.unobserve(observedIcons)
        if (icons) observer.observe(icons)
        observedIcons = icons
      }
      const pageTop = page.getBoundingClientRect().top
      // Space the clocks, weather and icons share above the photo credit.
      const room = icons ? page.clientHeight - NEW_TAB_CREDIT_SPACE - NEW_TAB_ICON_GAP - icons.offsetHeight : Infinity
      const baseTop = widgets ? parseFloat(getComputedStyle(widgets).top) || 0 : 0
      // Only a reading with forecast rows makes room or shrinks to fit (a one-line reading never did).
      const cornerForecast = corner?.classList.contains('has-forecast') ? corner : null
      const belowWeather = widgets?.querySelector<HTMLElement>('.new-tab-weather-widget') ?? null
      const belowForecast = belowWeather?.classList.contains('has-forecast') ? belowWeather : null
      for (const element of [corner, belowWeather]) if (element && element !== cornerForecast && element !== belowForecast) element.style.removeProperty('--new-tab-weather-fit')
      // A window too short for the forecast at its size shrinks it (down to half) instead of
      // pushing the icons off the page; it grows back as the window does. Measured, not estimated
      // (the columns re-wrap as they shrink), and only while a forecast shows; the result depends
      // on the page size alone, so the resize it causes settles on the same value.
      const fitTo = (element: HTMLElement, available: number): void => {
        const fit = largestWeatherFit((candidate) => {
          element.style.setProperty('--new-tab-weather-fit', String(candidate))
          return element.offsetHeight <= available
        })
        if (fit === 1) element.style.removeProperty('--new-tab-weather-fit')
        else element.style.setProperty('--new-tab-weather-fit', String(fit))
      }
      const besideBox = (box: DOMRect, other: DOMRect | undefined): boolean => Boolean(other && other.right > box.left - 8 && other.left < box.right + 8)
      if (cornerForecast && Number.isFinite(room)) {
        const box = cornerForecast.getBoundingClientRect()
        const clocksBelow = widgets && besideBox(box, widgets.getBoundingClientRect()) ? widgets.offsetHeight + 8 : 0
        if (clocksBelow || besideBox(box, icons?.getBoundingClientRect())) fitTo(cornerForecast, room - clocksBelow - (box.top - pageTop) - 8)
      }
      const cornerBox = cornerForecast ? cornerForecast.getBoundingClientRect() : null
      const cornerBottom = cornerBox ? cornerBox.bottom - pageTop + 8 : 0
      const besideCorner = (box: DOMRect | undefined): boolean => Boolean(cornerBox && besideBox(cornerBox, box))
      const iconsClearCorner = besideCorner(icons?.getBoundingClientRect()) ? cornerBottom : 0
      if (!widgets) {
        if (iconsClearCorner) page.style.setProperty('--new-tab-widgets-bottom', `${Math.ceil(iconsClearCorner)}px`)
        else page.style.removeProperty('--new-tab-widgets-bottom')
        return
      }
      // Clocks that would run into a corner forecast start under it instead.
      const push = besideCorner(widgets.getBoundingClientRect()) ? Math.max(0, Math.ceil(cornerBottom - baseTop)) : 0
      if (belowForecast && Number.isFinite(room)) fitTo(belowForecast, room - baseTop - push - (widgets.offsetHeight - belowForecast.offsetHeight))
      const free = icons ? room - baseTop - push - widgets.offsetHeight : 0
      const shift = push + clockShift(clockVerticalPositionRef.current, free)
      page.style.setProperty('--new-tab-clock-shift', `${shift}px`)
      page.style.setProperty('--new-tab-widgets-bottom', `${Math.ceil(Math.max(baseTop + shift + widgets.offsetHeight, iconsClearCorner))}px`)
    }
    const observer = new ResizeObserver(write)
    if (widgets) observer.observe(widgets)
    if (corner) observer.observe(corner)
    observer.observe(page)
    write()
    newTabWidgetsLayoutRef.current = write
    return () => {
      observer.disconnect()
      newTabWidgetsLayoutRef.current = null
      page.style.removeProperty('--new-tab-widgets-bottom')
      page.style.removeProperty('--new-tab-clock-shift')
    }
  }, [hasNewTabWidgets, hasCornerForecast])
  // A position drag moves the clocks before paint, step by step (the page follows every patch).
  useLayoutEffect(() => { newTabWidgetsLayoutRef.current?.() }, [newTabPreferences.clockVerticalPosition])
  // Whether this surface's own sidebar is actually painted: the sidebar overlay while it is
  // revealed, the content surface only when it is the visible layer (New Tab or a full panel).
  // Tooltip hints only arrive while Diagnostics samples; the toolbar has no tab list.
  const tabUsage = useTabUsageHints(surface !== 'toolbar')
  const sidebarOnScreen = sidebarVisible && (surface === 'sidebar' || (surface === 'content' && (isLocalPage || (sidebarMode !== 'tabs' && sidebarMode !== 'history'))))
  // Cmd/Ctrl-click and Shift-click multi-select (a split entry stands for all its panes);
  // only the surface showing the tab list mirrors its selection to main.
  const activeEntryKey = useMemo(() => tabEntries.find((entry) => entry.kind === 'split' ? entry.tabs.some((tab) => tab.active) : entry.kind === 'tab' && entry.tab.active)?.key ?? null, [tabEntries])
  const revealingGroups = useGroupReveal(tabs)
  const tabSelection = useTabSelection(unpinnedTabIds, (key) => {
    const entry = tabEntriesByKey.get(key)
    return entry?.kind === 'split' ? entry.tabs.map((tab) => tab.id) : entry?.kind === 'tab' ? [entry.tab.id] : []
  }, activeEntryKey, sidebarOnScreen)
  useEffect(() => {
    if (surface !== 'content' || !isLocalNewTab) return
    const rotationTimer = window.setInterval(() => {
      setNewTabBackgroundIndex((index) => nextQuickLinkBackgroundIndex(index, FALLBACK_NEW_TAB_BACKGROUNDS.length))
    }, QUICK_LINK_BACKGROUND_ROTATION_MS)
    return () => window.clearInterval(rotationTimer)
  }, [surface, isLocalNewTab])
  useEffect(() => {
    if (surface !== 'content' || !isLocalNewTab) return
    let mounted = true
    const applyRemotePhotos = (photos: NewTabBackground[]): void => {
      if (!mounted || photos.length === 0) return
      setNewTabBackgrounds(withOfflinePhotoFallbacks(photos))
      setNewTabBackgroundIndex(0)
    }
    const refreshCache = (): void => {
      void window.api.browser.newTabBackgrounds.get().then(applyRemotePhotos).catch(() => undefined)
    }
    const unsubscribe = window.api.browser.newTabBackgrounds.onChange(applyRemotePhotos)
    refreshCache()
    const refreshTimer = window.setInterval(refreshCache, NEW_TAB_PHOTO_REFRESH_INTERVAL_MS)
    return () => {
      mounted = false
      unsubscribe()
      window.clearInterval(refreshTimer)
    }
  }, [surface, isLocalNewTab])
  useEffect(() => {
    const showsTime = newTabPreferences.showClock || newTabPreferences.worldClocks.length > 0
    if (!newTabOnScreen || (!showsTime && !newTabPreferences.showGreeting)) return
    // Tick on the next second/minute boundary: one wakeup per displayed change, never more (per
    // second only while a clock shows seconds; the greeting alone needs minutes).
    const step = newTabPreferences.showSeconds && showsTime ? 1_000 : 60_000
    let timer = 0
    const tick = (): void => {
      const now = new Date()
      setClockNow(now)
      timer = window.setTimeout(tick, step - (now.getTime() % step) + 15)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [newTabOnScreen, newTabPreferences.showClock, newTabPreferences.showSeconds, newTabPreferences.worldClocks.length, newTabPreferences.showGreeting])

  useEffect(() => {
    const place = newTabPreferences.weatherPlace
    // Settings saved before city search hold free text only: main looks it up once, we save the place.
    const legacyLocation = place ? '' : newTabPreferences.weatherLocation.trim()
    if (surface !== 'content' || !isLocalNewTab || !newTabPreferences.weatherEnabled || (!place && !legacyLocation)) {
      setNewTabWeather(null)
      setNewTabWeatherError('')
      setNewTabWeatherLoading(false)
      newTabWeatherIdentityRef.current = ''
      return
    }
    let mounted = true
    const provider = newTabPreferences.weatherProvider
    const model = newTabPreferences.openMeteoModel
    // Switching the forecast view keeps the reading on screen while daily rows load; a new place,
    // provider, model or key clears it so a stale reading never shows under the wrong name.
    const identity = `${provider}|${model}|${place ? `${place.latitude},${place.longitude}` : legacyLocation}|${newTabWeatherKeyVersion}`
    if (newTabWeatherIdentityRef.current !== identity) {
      setNewTabWeather(null)
      setNewTabWeatherError('')
    }
    newTabWeatherIdentityRef.current = identity
    const daily = newTabWantsDaily
    const refresh = (): void => {
      setNewTabWeatherLoading(true)
      void window.api.browser.newTabWeather.get({ provider, model, place, location: legacyLocation, daily }).then((reply) => {
        if (!mounted) return
        if (!reply.ok) { setNewTabWeatherError(reply.error); return }
        const weather = reply.value
        setNewTabWeather(weather)
        setNewTabWeatherError('')
        const current = newTabPreferencesRef.current
        if (!current.weatherPlace && current.weatherLocation.trim() === legacyLocation) {
          patchNewTabPreferences({ weatherPlace: weather.place, weatherLocation: weather.location.slice(0, 100) })
        }
      }).catch((error: unknown) => {
        if (mounted) setNewTabWeatherError((error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''))
      }).finally(() => {
        if (mounted) setNewTabWeatherLoading(false)
      })
    }
    const initialTimer = window.setTimeout(refresh, 450)
    const refreshTimer = window.setInterval(refresh, 15 * 60 * 1_000)
    return () => {
      mounted = false
      window.clearTimeout(initialTimer)
      window.clearInterval(refreshTimer)
    }
    // The place is compared by its coordinates: a re-sent identical place doesn't refetch.
  }, [surface, isLocalNewTab, newTabWeatherKeyVersion, newTabWantsDaily, newTabPreferences.weatherEnabled, newTabPreferences.weatherProvider, newTabPreferences.openMeteoModel, newTabPreferences.weatherPlace?.latitude, newTabPreferences.weatherPlace?.longitude, newTabPreferences.weatherPlace ? '' : newTabPreferences.weatherLocation])

  const activeOrigin = httpOrigin(browser.url)
  const certificateLoadError = browser.loadError && browser.error && describeLoadError(browser.loadError).kind === 'certificate' ? browser.loadError.name ?? 'ERR_CERT_INVALID' : null
  // A full-page error (DNS, refused, TLS handshake…) means nothing loaded: no lock, no Not secure pill.
  const pageLoadError = !certificateLoadError && browser.error && browser.loadError?.fullPage ? browser.loadError.name ?? (browser.loadError.code !== null ? `Error ${browser.loadError.code}` : 'ERR_FAILED') : null
  const siteConnection = isLocalPage ? null : siteConnectionSummary((certificateLoadError || pageLoadError) && browser.loadError ? browser.loadError.url : browser.url, browser.security, certificateLoadError, pageLoadError)
  const pageTransport = pageTransportSecurity(browser.url)
  const certificateBypassed = !isLocalPage && browser.security?.level === 'bypassed'

  function revealSidebar(): void {
    if (sidebarHideTimerRef.current) clearTimeout(sidebarHideTimerRef.current)
    sidebarHideTimerRef.current = null
    setSidebarHovered(true)
  }

  function pointerIsOverSidebar(clientX: number, clientY: number): boolean {
    const rect = sidebarRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return false
    return clientX >= rect.left && clientX < rect.right && clientY >= rect.top && clientY < rect.bottom
  }

  function handleSidebarPointerEnter(): void {
    sidebarPointerInsideRef.current = true
    revealSidebar()
  }

  function handleSidebarPointerLeave(event: React.MouseEvent<HTMLElement>): void {
    // Chromium fires a synthetic mouseleave when this surface's view is hidden or restacked
    // (opening/closing a tab swaps the New Tab renderer in and out). The pointer hasn't moved,
    // so it's still over the sidebar: don't treat that as the user leaving.
    if (pointerIsOverSidebar(event.clientX, event.clientY)) return
    sidebarPointerInsideRef.current = false
    scheduleSidebarHide()
  }

  function scheduleSidebarHide(): void {
    if (sidebarResizeRef.current) return
    if (sidebarHideTimerRef.current) clearTimeout(sidebarHideTimerRef.current)
    sidebarHideTimerRef.current = setTimeout(() => {
      sidebarHideTimerRef.current = null
      setSidebarHovered(false)
    }, 180)
  }

  function keepSidebarVisibleForFocus(): void {
    if (sidebarHideTimerRef.current) clearTimeout(sidebarHideTimerRef.current)
    sidebarHideTimerRef.current = null
    setSidebarFocused(true)
  }

  function releaseSidebarFocus(event: React.FocusEvent<HTMLElement>): void {
    const nextTarget = event.relatedTarget as Node | null
    if (nextTarget && sidebarRef.current?.contains(nextTarget)) return
    setSidebarFocused(false)
    // Closing or opening a tab moves focus to the page / address bar. That's not a reason to
    // collapse while the pointer is still sitting on the sidebar; mouseleave handles the real exit.
    if (sidebarPointerInsideRef.current) return
    scheduleSidebarHide()
  }

  async function refreshHistory(): Promise<void> {
    historyStaleRef.current = false
    setHistory(await window.api.browser.history.get())
  }

  /** Surfaces that show history right now; the rest refetch lazily (address focus) instead of on every visit. */
  const historyVisible = sidebarMode === 'history' ? surface !== 'toolbar' : surface === 'content' && isLocalNewTab
  const historyVisibleRef = useRef(historyVisible)
  historyVisibleRef.current = historyVisible
  useEffect(() => {
    if (historyVisible && historyStaleRef.current) void refreshHistory()
  }, [historyVisible])

  async function refreshNaturePhotos(): Promise<void> {
    if (photoRefreshBusy) return
    setPhotoRefreshBusy(true)
    setPhotoRefreshStatus('Checking for new licensed nature photos.')
    try {
      const result = await window.api.browser.newTabBackgrounds.refresh()
      if (result.backgrounds.length > 0) {
        setNewTabBackgrounds(withOfflinePhotoFallbacks(result.backgrounds))
        setNewTabBackgroundIndex(0)
      }
      setPhotoRefreshStatus(result.updated ? 'New nature photos are ready.' : result.error ?? 'Your current backgrounds are still in use.')
    } catch {
      setPhotoRefreshStatus('Could not refresh nature photos. Your saved or offline backgrounds are still in use.')
    } finally {
      setPhotoRefreshBusy(false)
    }
  }

  function createNewTab(): void {
    setSidebarMode('tabs')
    setSuggestionsOpen(false)
    void window.api.browser.tabs.create(undefined, searchEngine)
  }

  function toggleToolbarPanel(mode: 'tabs' | 'history'): void {
    if (mode === 'history') {
      setSidebarMode((current) => current === 'history' ? 'tabs' : 'history')
      if (sidebarMode !== 'history') void refreshHistory()
      return
    }
    if (sidebarMode === 'tabs' && sidebarPinned) {
      setSidebarPinned(false)
      return
    }
    setSidebarMode('tabs')
    setSidebarPinned(true)
  }

  async function savePinnedSites(next: PinnedSite[]): Promise<void> {
    try {
      await window.api.browser.pinnedSites.set(next)
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : String(error))
    }
  }

  async function openPinnedSite(site: PinnedSite): Promise<void> {
    setSidebarMode('tabs')
    setSuggestionsOpen(false)
    await window.api.browser.navigate(site.url, searchEngine)
  }

  /**
   * Show a settings page: in the Settings tab when it is the one on screen, else main focuses the
   * window's Settings tab (or opens one next to this tab). `host` deep-links Sites to that site.
   */
  function selectSettingsSection(mode: SettingsSectionMode, host?: string | null): void {
    if (settingsTab && !host) setSettingsSectionPick({ section: mode, revision: settingsTab.revision })
    if (sidebarMode === 'downloads' || sidebarMode === 'bookmarks') setSidebarMode('tabs')
    void window.api.browser.settings.open({ section: mode, ...(host ? { host } : {}) }).catch(() => undefined)
  }

  const closeNewTabCustomize = useCallback(() => setNewTabCustomizeOpen(false), [])
  function warmNewTabCustomize(): void {
    void preloadNewTabCustomizePanel()
  }
  /** Settings → New Tab "Customize on New Tab": show the New Tab (this tab's, or a new one) with the panel open. */
  function customizeOnNewTab(): void {
    setNewTabCustomizeLoaded(true)
    setNewTabCustomizeOpen(true)
    setSettingsQuery('')
    if (!isLocalNewTab) void window.api.browser.tabs.create(SURFFISH_QUICK_LINKS_URL)
  }
  const newTabFieldsProps = {
    preferences: newTabPreferences,
    onPatch: patchNewTabPreferences,
    newTabPage,
    onNewTabPageChange: (page: NewTabPageId) => {
      void window.api.browser.newTabPage.set(page).then((saved) => { if (saved) setNewTabPage(saved) })
    },
    weather: { snapshot: newTabWeather, error: newTabWeatherError, loading: newTabWeatherLoading },
    onWeatherKeyChange: () => setNewTabWeatherKeyVersion((version) => version + 1)
  }

  // A deep link to a General category (e.g. Mini Window Settings… from the menu bar icon) scrolls to it
  // once the lazy settings chunk has drawn it.
  const settingsFocus = settingsOnScreen && settingsMode === 'settings' ? settingsTab?.focus ?? null : null
  useEffect(() => {
    if (!settingsFocus) return
    let tries = 0
    let frame = 0
    const scroll = (): void => {
      const element = document.getElementById(`settings-category-${settingsFocus}`)
      if (element) element.scrollIntoView({ block: 'start' })
      else if (tries++ < 60) frame = requestAnimationFrame(scroll)
    }
    scroll()
    return () => cancelAnimationFrame(frame)
  }, [settingsFocus, settingsTab?.revision])

  /** Leave a full-page panel (Downloads, Bookmarks) for the tab under it. */
  function exitPanel(): void {
    if (sidebarMode !== 'tabs') setSidebarMode('tabs')
  }

  /** The sidebar gear opens (or focuses) the Settings tab; it closes like any tab. */
  function openSettings(): void {
    if (settingsOnScreen) return
    selectSettingsSection(settingsMode ?? 'settings')
  }

  // Keep main told where the Bramble button sits, so popups Bramble opens itself (autofill
  // "Vault locked", passkey "Unlock & Use") attach to it like a toolbar click does.
  const brambleButtonMounted = !!brambleButtonRef.current
  useEffect(() => {
    const button = brambleButtonRef.current
    const setAnchor = window.api.browser.bramble.setAnchor
    if (!button || typeof setAnchor !== 'function') return
    let frame = 0
    let lastKey = ''
    const report = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const bounds = button.getBoundingClientRect()
        const anchor = bounds.width > 0 && bounds.height > 0
          ? { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
          : null
        // The observers fire on every toolbar resize (popups, suggestions); the button rarely moves.
        const key = anchor ? `${anchor.x},${anchor.y},${anchor.width},${anchor.height}` : 'none'
        if (key === lastKey) return
        lastKey = key
        setAnchor(anchor)
      })
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(button)
    observer.observe(document.documentElement)
    if (button.parentElement) observer.observe(button.parentElement)
    window.addEventListener('resize', report)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', report)
      setAnchor(null)
    }
  }, [brambleButtonMounted, bramblePoc.installed])

  async function openBramblePoc(): Promise<void> {
    try {
      const bounds = brambleButtonRef.current?.getBoundingClientRect()
      const anchor = bounds
        ? { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
        : undefined
      setBramblePoc(await window.api.browser.bramble.open(anchor))
    } catch (error) {
      setBramblePoc((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  async function handleBrambleToolbarClick(): Promise<void> {
    await dispatchBrambleToolbarAction(bramblePoc, {
      open: () => openBramblePoc(),
      install: async () => {
        selectSettingsSection('integrations')
        try {
          setBramblePoc(await window.api.browser.bramble.installLatest())
        } catch (error) {
          setBramblePoc((current) => ({
            ...current,
            error: error instanceof Error ? error.message : String(error)
          }))
        }
      }
    })
  }

  async function openBrambleSetupPage(): Promise<void> {
    try {
      setBramblePoc(await window.api.browser.bramble.setup())
    } catch (error) {
      setBramblePoc((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  useEffect(() => {
    const unsubscribeState = window.api.browser.onState(setBrowser)
    const unsubscribeTabs = window.api.browser.tabs.onChange(setTabs)
    let historyTimer: number | undefined
    const unsubscribeHistory = window.api.browser.history.onChange(() => {
      historyStaleRef.current = true
      if (!historyVisibleRef.current) return
      window.clearTimeout(historyTimer)
      historyTimer = window.setTimeout(() => { void refreshHistory() }, 250)
    })
    const applyPreferences = (preferences: BrowserPreferencesSnapshot): void => {
      setSearchEngine(preferences.searchEngine)
      setSearchEngineLoaded(true)
      setNewTabPage(preferences.newTabPage)
      // Skip echoes of our own edits (a broadcast per save) while a drag or typing is in flight.
      if (performance.now() - newTabLocalEditAtRef.current > NEW_TAB_ECHO_GUARD_MS) setNewTabPreferences(preferences.newTabPreferences)
      setTabSleepMinutes(preferences.tabSleepMinutes)
      setChromeState((current) => ({ ...current, sidebarWidth: preferences.sidebarWidth }))
      void window.api.browser.chrome.set({ sidebarWidth: preferences.sidebarWidth }).catch(() => undefined)
    }
    const unsubscribePreferences = window.api.browser.preferences.onChange(applyPreferences)
    const unsubscribeFocusAddress = surface === 'sidebar' ? () => {} : window.api.browser.onFocusAddress(() => {
      addressRef.current?.focus()
      addressRef.current?.select()
    })
    void Promise.all([window.api.browser.state(), window.api.browser.preferences.get()]).then(([current, preferences]) => {
      setBrowser(current)
      setAddress(current.url)
      applyPreferences(preferences)
      if (surface === 'content') void window.api.browser.setSearchEngine(preferences.searchEngine)
      if (surface === 'content' && preferences.searchEngine !== DEFAULT_SEARCH_ENGINE && current.url === getSearchHomepage(DEFAULT_SEARCH_ENGINE)) {
        void window.api.browser.navigate(getSearchHomepage(preferences.searchEngine), preferences.searchEngine)
      }
    })
    void window.api.browser.tabs.get().then(setTabs)
    void window.api.browser.proxy.get().then((settings) => {
      setProxy(settings)
      setAppliedProxy(settings)
    })
    return () => {
      unsubscribeState()
      unsubscribeTabs()
      unsubscribeHistory()
      window.clearTimeout(historyTimer)
      unsubscribePreferences()
      unsubscribeFocusAddress()
    }
  }, [surface])

  useEffect(() => {
    if (settingsMode === 'network' && !networkToolEnabled) selectSettingsSection('settings')
  }, [settingsMode, networkToolEnabled])

  useEffect(() => {
    if (surface === 'content' && watchersEnabled === false && settingsMode && sidebarModeForWatchers(settingsMode, false) !== settingsMode) selectSettingsSection('settings')
  }, [surface, settingsMode, watchersEnabled])

  useEffect(() => {
    const unsubscribe = window.api.browser.bramble.onChange(setBramblePoc)
    void window.api.browser.bramble.get().then(setBramblePoc)
    return unsubscribe
  }, [])

  useEffect(() => {
    if (surface === 'content' && searchEngineLoaded) void window.api.browser.setSearchEngine(searchEngine)
  }, [searchEngine, searchEngineLoaded, surface])

  usePopoverDismiss(downloadsPopupOpen, downloadsControlRef, () => setDownloadsPopupOpen(false), { returnFocusRef: downloadsButtonRef })

  // Esc leaves the Downloads / Bookmarks panels. Settings is a tab now: it closes like one (⌘W, ×),
  // so Esc there only clears the settings search (SettingsSearchField).
  useEffect(() => {
    if (surface === 'sidebar' || (sidebarMode !== 'downloads' && sidebarMode !== 'bookmarks')) return
    const exitOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || downloadsPopupOpen || siteActionsOpen || extensionsMenuOpen) return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'SELECT') return
      exitPanel()
    }
    window.addEventListener('keydown', exitOnEscape)
    return () => window.removeEventListener('keydown', exitOnEscape)
  }, [surface, sidebarMode, downloadsPopupOpen, siteActionsOpen, extensionsMenuOpen])

  // Closes on any press outside it, the page view included (see usePopoverDismiss), not only the globe.
  usePopoverDismiss(siteActionsOpen, siteActionsControlRef, () => setSiteActionsOpen(false), { returnFocusRef: siteActionsButtonRef })
  useEffect(() => {
    if (!siteActionsOpen) setCertificateView(null)
  }, [siteActionsOpen])

  // Main saw a press on the page view (a separate WebContentsView this document never hears).
  useEffect(() => window.api.browser.onDismissPopovers(dismissPopovers), [])

  // Toolbar view sized to the toolbar + open popovers (useToolbarPopovers.ts).
  // Speculative preconnect while typing (shared/preconnect.ts): ~150 ms after the last keystroke,
  // main opens one socket to the top suggestion's (or the typed URL's / search engine's) origin.
  const preconnectTypingRef = useRef<Debouncer<{ input: string; top: string | null }> | null>(null)
  useEffect(() => {
    if (surface === 'sidebar') return
    const debouncer = new Debouncer<{ input: string; top: string | null }>(TYPING_DEBOUNCE_MS, ({ input, top }) => window.api.browser.preconnect.typed(input, top))
    preconnectTypingRef.current = debouncer
    return () => {
      debouncer.cancel()
      preconnectTypingRef.current = null
    }
  }, [surface])
  // Resting on a sleeping tab in the sidebar warms the origin it will wake to (main checks it sleeps).
  const sleepingTabHoverRef = useRef<Debouncer<string> | null>(null)
  useEffect(() => {
    const debouncer = new Debouncer<string>(HOVER_DWELL_MS, (id) => window.api.browser.preconnect.hoverSleepingTab(id))
    sleepingTabHoverRef.current = debouncer
    return () => {
      debouncer.cancel()
      sleepingTabHoverRef.current = null
    }
  }, [])
  const topSuggestionUrl = addressSuggestions[0]?.url ?? null
  useEffect(() => {
    const debouncer = preconnectTypingRef.current
    if (!debouncer) return
    if (!suggestionsActive || !typedInputQualifies(address) || address === addressDisplayValue(browser.url, isLocalNewTab)) {
      debouncer.cancel()
      return
    }
    debouncer.push({ input: address, top: topSuggestionUrl })
  }, [suggestionsActive, address, topSuggestionUrl, browser.url, isLocalNewTab])
  // The centered address bar shrinks to keep clear of the right-aligned icons, whose width varies
  // (extension icons, badges, the ad-blocker count): Browser.css reads --toolbar-trailing-width.
  useEffect(() => {
    const chrome = browserChromeRef.current
    const trailing = chrome?.querySelector<HTMLElement>('.browser-toolbar-trailing')
    if (!chrome || !trailing) return
    const update = (): void => chrome.style.setProperty('--toolbar-trailing-width', `${Math.ceil(trailing.getBoundingClientRect().width)}px`)
    const observer = new ResizeObserver(update)
    observer.observe(trailing)
    update()
    return () => observer.disconnect()
  }, [surface])
  useToolbarExtent(browserChromeRef, surface === 'toolbar', brandEgg.open, [downloadsPopupOpen, suggestionsOpen, addressSuggestions.length, keywordMatch !== null, siteActionsOpen, extensionsMenuOpen, findOpen, paletteOpen, bookmarkPopoverOpen, bookmarksMenuOpen, readingListOpen, adblockOpen, bookmarksBarMenuOpen, bookmarksMenuLayout, bookmarksBarVisible, surface, navigationError !== '' || showLoadErrorNotice])

  // The History panel closes like a popover (the toolbar's clock button toggles it; it lives in the sidebar view).
  const closeHistoryPanel = (): void => setSidebarMode((current) => current === 'history' ? 'tabs' : current)
  useHistoryPanelDismiss(sidebarMode === 'history' && surface === 'toolbar', historyButtonRef, closeHistoryPanel)
  useHistoryPanelDismiss(sidebarMode === 'history' && surface === 'sidebar', sidebarRef, closeHistoryPanel)
  useDismissOnTabSwitch(surface === 'sidebar' ? '' : activeTabId, browser.activeTabSince)

  useEffect(() => () => {
    if (sidebarHideTimerRef.current) clearTimeout(sidebarHideTimerRef.current)
  }, [])

  useLayoutEffect(() => {
    if (surface !== 'content') return
    const element = viewportRef.current
    if (!element) return
    const updateBounds = (): void => {
      const rect = element.getBoundingClientRect()
      const canShow = sidebarMode !== 'downloads' && sidebarMode !== 'bookmarks' && !isLocalPage && !coversPage && rect.width > 0 && rect.height > 0
      void window.api.browser.setBounds(canShow
        ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
        : { x: 0, y: 0, width: 0, height: 0 })
    }
    const observer = new ResizeObserver(updateBounds)
    observer.observe(element)
    window.addEventListener('resize', updateBounds)
    updateBounds()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateBounds)
      void window.api.browser.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    }
  }, [surface, sidebarMode, isLocalPage, coversPage])

  // Address-bar notices belong to the tab they were raised on.
  useEffect(() => {
    setNavigationError('')
  }, [activeTabId])

  // The tab URL wins unless the user is really typing (activeElement alone sticks when focus moves to another view).
  const addressSync = useAddressBarSync({ inputRef: addressRef, address, setAddress, displayUrl: addressDisplayValue(browser.url, isLocalNewTab), tabKey: activeTabId })
  // After arrowing (or Esc back to the typed text), caret at the end with nothing selected, so the
  // next keystroke edits the text instead of replacing it.
  useLayoutEffect(() => {
    if (!omniboxCaretToEndRef.current) return
    omniboxCaretToEndRef.current = false
    const input = addressRef.current
    if (!input || document.activeElement !== input) return
    input.setSelectionRange(input.value.length, input.value.length)
    // A new value doesn't scroll the field; show the end, where the caret is.
    input.scrollLeft = input.scrollWidth
  }, [address, omniboxPreview])

  async function navigateTo(valueInput: string): Promise<void> {
    const value = valueInput.trim()
    if (!value) return
    setSuggestionsOpen(false)
    setOmniboxPreview(null)
    setSidebarMode('tabs')
    // "Switch to open tabs" (Settings → Tab archive): main switches instead of loading a duplicate.
    if (await window.api.browser.tabArchive.switchToOpenTab(value, searchEngine).catch(() => false)) {
      setNavigationError('')
      addressRef.current?.blur()
      return
    }
    const result = await window.api.browser.navigate(value, searchEngine)
    if (!result.ok) {
      // Load failures surface through the tab's error state (notice or in-page error).
      setNavigationError(result.reason === 'invalid' ? INVALID_ADDRESS_ERROR : '')
    } else {
      setNavigationError('')
      setProxyMessage('')
      const current = await window.api.browser.state()
      setBrowser(current)
      setAddress(current.url)
      addressSync.markSynced(current.url)
      addressRef.current?.blur()
    }
  }

  async function navigate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await navigateTo(address)
  }

  async function openPictureInPicture(): Promise<void> {
    try {
      const started = await window.api.browser.pictureInPicture()
      if (!started) setNavigationError('No active video can open in Picture in Picture on this page.')
      else setNavigationError('')
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : 'Picture in Picture could not be opened.')
    }
  }

  function handleAddressKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      const escape = escapeOmnibox(omniboxPreview)
      if (escape.kind === 'restore') {
        // First Esc after arrowing: put back what the user typed, dropdown stays open.
        event.preventDefault()
        setOmniboxPreview(null)
        omniboxCaretToEndRef.current = true
        setAddress(escape.text)
        return
      }
      // Like Chrome: Esc drops the dropdown and any half-typed text, leaving the real URL selected.
      setSuggestionsOpen(false)
      setOmniboxPreview(null)
      setAddress(addressDisplayValue(browser.url, isLocalNewTab))
      addressSync.markSynced(addressDisplayValue(browser.url, isLocalNewTab))
      const input = event.currentTarget
      window.requestAnimationFrame(() => input.select())
      return
    }
    if (!suggestionsOpen || addressSuggestions.length === 0 || event.altKey || event.ctrlKey || event.metaKey) return
    // Up/Down (and Tab/Shift+Tab, as in Chrome and Firefox) fill the bar with the row's URL, caret at
    // the end, so it can be edited into a similar address. Enter then submits whatever the bar shows.
    const direction = event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)
      ? 'down'
      : event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? 'up' : null
    if (!direction || (event.key !== 'Tab' && event.shiftKey)) return
    event.preventDefault()
    const next = arrowSuggestion(address, omniboxPreview, addressSuggestions, direction)
    setOmniboxPreview(next.preview)
    omniboxCaretToEndRef.current = true
    setAddress(next.text)
  }

  async function saveProxy(): Promise<void> {
    setBusy(true)
    setProxyMessage('Applying proxy to the browser…')
    setProxyMessageIsError(false)
    try {
      const saved = await window.api.browser.proxy.set(proxy)
      setProxy(saved)
      setAppliedProxy(saved)
      await window.api.browser.reload()
      setProxyMessage(saved.enabled
        ? `SOCKS5 is on for this browser via ${saved.host}:${saved.port}.`
        : 'Proxy is off; this browser will connect directly.')
    } catch (error) {
      setProxyMessage(error instanceof Error ? error.message : String(error))
      setProxyMessageIsError(true)
    } finally {
      setBusy(false)
    }
  }

  async function clearSavedSession(): Promise<void> {
    if (!window.confirm('Clear saved tabs for the next launch? Current tabs will remain open, but will not be saved again until Surffish restarts.')) return
    try {
      const cleared = await window.api.browser.session.clear()
      if (!cleared) throw new Error('Could not clear the saved session file. Check profile permissions and try again.')
      setSessionMessage('Saved tabs cleared. Current tabs remain open; session saving resumes after the next restart.')
    } catch (error) {
      setSessionMessage(error instanceof Error ? error.message : 'Could not clear saved tabs.')
    }
  }
  async function testProxy(): Promise<void> {
    setBusy(true)
    setProxyMessage('Checking the local SOCKS5 port…')
    setProxyMessageIsError(false)
    try {
      const result = await window.api.browser.proxy.test(proxy)
      setProxyMessage(result.message)
      setProxyMessageIsError(!result.reachable)
    } catch (error) {
      setProxyMessage(error instanceof Error ? error.message : String(error))
      setProxyMessageIsError(true)
    } finally {
      setBusy(false)
    }
  }

  async function clearHistory(): Promise<void> {
    if (!window.confirm('Clear all browsing history saved by Surffish? Open tabs will stay open.')) return
    await window.api.browser.history.clear()
    setHistory([])
  }

  async function openHistoryEntry(entry: BrowsingHistoryEntry): Promise<void> {
    setSidebarMode('tabs')
    setHistoryQuery('')
    await window.api.browser.navigate(entry.url)
  }

  function selectTabOnKeyboard(event: KeyboardEvent<HTMLDivElement>, id: string): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    void window.api.browser.tabs.activate(id)
  }

  const filteredHistory = history.filter((entry) => {
    const query = historyQuery.trim().toLowerCase()
    return !query || entry.title.toLowerCase().includes(query) || entry.url.toLowerCase().includes(query)
  })
  const brambleInstallLabel = bramblePoc.loading
    ? 'Working…'
    : !bramblePoc.installed
      ? `Install${bramblePoc.latestVersion ? ` ${bramblePoc.latestVersion}` : ' latest'}`
      : bramblePoc.updateAvailable && bramblePoc.latestVersion
        ? `Update to ${bramblePoc.latestVersion}`
        : bramblePoc.latestVersion ? 'Up to date' : 'Install / update'
  const brambleToolbarAction = resolveBrambleToolbarAction(bramblePoc)

  return (
    <section className={`browser-layout${sidebarVisible ? ' is-sidebar-visible' : ''}${sidebarOnScreen ? '' : ' is-sidebar-motion-paused'}${sidebarResizing ? ' is-sidebar-resizing' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties} aria-label="Surffish browser" onMouseMove={(event) => {
      if (!sidebarVisible && event.clientX <= 18) revealSidebar()
    }} onMouseLeave={surface === 'sidebar' ? handleSidebarPointerLeave : undefined}>
      <aside
        ref={sidebarRef}
        className={`browser-sidebar${activeSpace ? ' has-spaces' : ''}${sidebarBackdropClass(surface, sidebarBackdrop)}${browser.private ? ' is-private-window' : ''}`}
        style={activeSpace ? { '--active-space-color': SPACE_COLOR_VALUES[activeSpace.color] } as React.CSSProperties : undefined}
        data-space-id={activeSpace?.id}
        aria-label="Browser sidebar"
        onMouseEnter={handleSidebarPointerEnter}
        onMouseLeave={handleSidebarPointerLeave}
        onFocusCapture={keepSidebarVisibleForFocus}
        onBlurCapture={releaseSidebarFocus}
      >
        {surface === 'sidebar' && <SidebarBackdropLayer state={sidebarBackdrop} cardRef={sidebarRef} />}
        {window.api.platform === 'darwin' && (
          <div className="sidebar-window-controls" aria-label="Window controls">
            <button className="sidebar-window-control is-close" type="button" aria-label="Close window" title="Close window" onClick={() => void window.api.browser.windowControl('close')} />
            <button className="sidebar-window-control is-minimize" type="button" aria-label="Minimize window" title="Minimize window" onClick={() => void window.api.browser.windowControl('minimize')} />
            <button className="sidebar-window-control is-zoom" type="button" aria-label="Toggle window zoom" title="Toggle window zoom" onClick={() => void window.api.browser.windowControl('toggle-zoom')} />
          </div>
        )}
        {sidebarMode !== 'tabs' && !isSettingsSection(sidebarMode) && <div className="sidebar-heading">
          <strong>{sidebarMode === 'history' ? 'History' : sidebarMode === 'downloads' ? 'Downloads' : sidebarMode === 'bookmarks' ? 'Bookmarks' : sidebarMode === 'network' ? 'Network' : 'This site'}</strong>
          {sidebarMode === 'history' && (
            <button className="sidebar-icon-button" type="button" aria-label="Clear browsing history" title="Clear history" disabled={history.length === 0} onClick={() => void clearHistory()}>
              <span aria-hidden="true">⌫</span>
            </button>
          )}
        </div>}

        {sidebarMode === 'tabs' && (
          <section className="sidebar-pinned-sites" aria-label="Pinned tabs and bookmarks">
            <div className="sidebar-pinned-list">
              {tabs.filter((tab) => tab.pinned).map((tab) => <PinnedTabIcon key={`tab:${tab.id}`} tab={tab} />)}
              {pinnedSites.map((site) => <PinnedSiteIcon key={`bookmark:${site.url}`} site={site} cachedFaviconUrl={cachedSiteIcons[httpOrigin(site.url) ?? '']} onOpen={() => void openPinnedSite(site)} onUnpin={() => void savePinnedSites(pinnedSites.filter((pinned) => pinned.url !== site.url))} />)}
            </div>
          </section>
        )}

        {sidebarMode === 'history' ? (
          <div className="history-sidebar">
            <label className="history-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="Search history"
                aria-label="Search browsing history"
              />
            </label>
            <div className="history-list" aria-label="Recent browsing history">
              {filteredHistory.slice(0, historyQuery ? 400 : 250).map((entry) => (
                <button className="history-item" key={entry.id} type="button" onClick={() => void openHistoryEntry(entry)} title={entry.url}>
                  <strong>{entry.title}</strong>
                  <span className="history-host">{historyHost(entry.url)}</span>
                  <time dateTime={new Date(entry.visitedAt).toISOString()}>{formatVisitedAt(entry.visitedAt)}</time>
                </button>
              ))}
              {filteredHistory.length === 0 && <p className="sidebar-empty">{historyQuery ? 'No matching history' : 'No browsing history yet'}</p>}
            </div>
          </div>
        ) : (
          <div ref={tabDrag.listRef} className={`tab-list${tabDrag.draggingId ? ' is-drag-sorting' : ''}`} role="tablist" aria-label="Open tabs" onClickCapture={tabDrag.onClickCapture}>
            {tabSelection.count >= 2 && (
              <div className="tab-selection-bar" role="toolbar" aria-label="Selected tabs">
                <span className="tab-selection-count">{tabSelection.count} tabs selected</span>
                <button type="button" title={`Group the selected tabs (${window.api.platform === 'darwin' ? '⌘G' : 'Ctrl+G'})`} onClick={tabSelection.group}>Group</button>
                <button className="tab-selection-clear" type="button" aria-label="Clear selection" title="Clear selection (Esc)" onClick={tabSelection.clear}>×</button>
              </div>
            )}
            {tabDrag.orderedIds.map((id) => tabEntriesByKey.get(id)).filter((entry) => entry !== undefined).map((entry) => entry.kind === 'group' ? (
              <TabGroupHeader key={entry.key} entryKey={entry.key} group={entry.group} dragging={tabDrag.draggingId === entry.key} handlers={tabDrag.itemHandlers(entry.key)} />
            ) : entry.kind === 'split' ? (
              <SplitTabEntry
                groupColor={entry.tabs[0]?.group ? TAB_GROUP_COLOR_VALUES[entry.tabs[0].group.color] : undefined}
                key={entry.key}
                entryId={entry.key}
                tabs={entry.tabs}
                dragging={tabDrag.draggingId === entry.key}
                animate={sidebarOnScreen}
                handlers={tabDrag.itemHandlers(entry.key)}
                selected={tabSelection.selectedKeys.has(entry.key)}
                onSelectClick={(event) => tabSelection.handleClick(event, entry.key)}
                onMoveBy={(offset) => tabDrag.moveBy(entry.key, offset)}
                titleFor={(tab) => withTabUsageHint(tab.sleeping ? `${tab.title} — ${describeTabSleep(tab.sleep).toLowerCase()}; select to reload` : tab.title, tabUsage[tab.id])}
                onActivate={(id) => {
                  void window.api.browser.tabs.activate(id)
                  if (sidebarMode === 'downloads' || sidebarMode === 'bookmarks') exitPanel()
                }}
              />
            ) : (({ tab }) => (
              <div
                className={`tab-item${tab.active ? ' is-active' : ''}${tab.private ? ' is-private' : ''}${tab.sleeping ? ' is-sleeping' : ''}${tabDrag.draggingId === tab.id ? ' is-dragging' : ''}${tab.group ? ' is-grouped' : ''}${tab.group && revealingGroups.has(tab.group.id) ? ' is-group-revealing' : ''}${tabSelection.selectedKeys.has(tab.id) ? ' is-multi-selected' : ''}`}
                style={tab.group ? { '--group-color': TAB_GROUP_COLOR_VALUES[tab.group.color] } as React.CSSProperties : undefined}
                key={tab.id}
                data-browser-tab-id={tab.id}
                role="tab"
                aria-selected={tab.active}
                aria-grabbed={tabDrag.draggingId === tab.id ? true : undefined}
                tabIndex={0}
                title={withTabUsageHint(tab.sleeping ? `${tab.title} — ${describeTabSleep(tab.sleep).toLowerCase()}; select to reload` : tab.title, tabUsage[tab.id])}
                onMouseEnter={tab.sleeping ? () => sleepingTabHoverRef.current?.push(tab.id) : undefined}
                onMouseLeave={tab.sleeping ? () => sleepingTabHoverRef.current?.cancel() : undefined}
                onClick={(event) => {
                  if (tabSelection.handleClick(event, tab.id)) return
                  void window.api.browser.tabs.activate(tab.id)
                  if (sidebarMode === 'downloads' || sidebarMode === 'bookmarks') exitPanel()
                }}
                // Middle-click closes the tab; swallow the press so Chromium doesn't start autoscroll.
                onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
                onAuxClick={(event) => {
                  if (event.button !== 1) return
                  event.preventDefault()
                  event.stopPropagation()
                  void window.api.browser.tabs.close(tab.id)
                }}
                onKeyDown={(event) => {
                  if (event.altKey && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                    event.preventDefault()
                    tabDrag.moveBy(tab.id, event.key === 'ArrowUp' ? -1 : 1)
                    return
                  }
                  selectTabOnKeyboard(event, tab.id)
                }}
                {...tabDrag.itemHandlers(tab.id)}
              >
                <TabFavicon tab={tab} animate={sidebarOnScreen} />
                <span className="tab-title">{tab.title}</span>
                {tab.private && <span className="tab-private-badge" title="Private tab" aria-label="Private tab"><PrivateGlyph /></span>}
                {tab.crashed && <span className="tab-crashed-badge" title="This tab crashed · it reloads when you open it" aria-label="Crashed tab"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg></span>}
                <TabAudioButton tab={tab} />
                {tab.sleeping && <span className={`tab-sleep-indicator${isRestoredSleep(tab.sleep) ? ' is-restored' : ''}`} title={describeTabSleep(tab.sleep)} aria-label={`Sleeping tab: ${describeTabSleep(tab.sleep)}`}>☾</span>}
                <button
                  className="tab-close"
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  title="Close tab"
                  onClick={(event) => { event.stopPropagation(); void window.api.browser.tabs.close(tab.id) }}
                >×</button>
              </div>
            ))(entry))}
            {tabs.length === 0 && <p className="sidebar-empty">No open tabs</p>}
            <div className="sidebar-new-tab-actions">
              <button className="sidebar-new-tab-row" type="button" aria-label="New tab" title="New tab (Ctrl/⌘+T)" onClick={createNewTab}>
                <span className="sidebar-new-tab-row-icon" aria-hidden="true">＋</span>
                <span className="sidebar-new-tab-row-label">New Tab</span>
              </button>
              <button className="sidebar-new-private-tab" type="button" aria-label="New private tab" title="New private tab (Ctrl/⌘+Alt+N)" onClick={() => void window.api.browser.tabs.createPrivate()}>
                <PrivateGlyph />
              </button>
            </div>
          </div>
        )}
        {sidebarMode === 'tabs' && <ArchivedTabsSidebar cachedIcons={cachedSiteIcons} onOpened={() => setSidebarMode('tabs')} />}

        {sidebarMode === 'tabs' && spaces?.enabled && <SpacesSwitcher snapshot={spaces} />}
        <div className="sidebar-footer">
          {sidebarMode === 'tabs' && (
            <button className={`sidebar-footer-icon-button sidebar-pin-button${sidebarPinned ? ' is-current' : ''}`} type="button" aria-label={sidebarPinned ? 'Auto-hide sidebar' : 'Keep sidebar open'} aria-pressed={sidebarPinned} title={sidebarPinned ? 'Auto-hide sidebar' : 'Keep sidebar open'} onClick={() => setSidebarPinned((pinned) => !pinned)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="3" /><path d="M9 5v14" />{sidebarPinned ? <path d="m15.5 10-2 2 2 2" /> : <path d="m13.5 10 2 2-2 2" />}</svg>
            </button>
          )}
          <UpdateBadge />
          <button className={`sidebar-footer-icon-button${settingsTab ? ' is-current' : ''}`} type="button" aria-label="Settings" aria-current={settingsTab ? 'page' : undefined} title={`Settings (${window.api.platform === 'darwin' ? '⌘,' : 'Ctrl+,'})`} onClick={openSettings}>
            <span aria-hidden="true">⚙</span>
          </button>
          <button className="sidebar-footer-icon-button sidebar-quit-button" type="button" aria-label="Quit Surffish" title="Quit Surffish" onClick={() => void window.api.browser.quit()}>
            <span aria-hidden="true">⏻</span>
          </button>
        </div>
        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={beginSidebarResize}
          onPointerMove={moveSidebarResize}
          onPointerUp={finishSidebarResize}
          onPointerCancel={finishSidebarResize}
          onLostPointerCapture={finishSidebarResize}
          onKeyDown={handleSidebarResizeKeyDown}
        />
      </aside>

      <div className="browser-main">
        <header className="browser-chrome" ref={browserChromeRef}>
          <form className={`browser-toolbar${browser.private ? ' is-private' : ''}`} onSubmit={(event) => void navigate(event)}>
            <div className="browser-toolbar-leading" aria-hidden="true" />
            <div className="omnibox-wrap">
              <NavHistoryButtons canGoBack={browser.canGoBack} canGoForward={browser.canGoForward} currentUrl={`${activeTabId}\n${browser.url}`} onShowFullHistory={() => { if (sidebarMode !== 'history') toggleToolbarPanel('history') }}>
                <button
                  className={`toolbar-button reload-button${browser.loading ? ' is-loading' : ''}`}
                  type="button"
                  aria-label={browser.loading ? 'Stop loading' : 'Reload page'}
                  title={browser.loading ? 'Stop' : 'Reload'}
                  onClick={() => void (browser.loading ? window.api.browser.stop() : window.api.browser.reload())}
                >
                  <span aria-hidden="true">{browser.loading ? '×' : '↻'}</span>
                </button>
              </NavHistoryButtons>
              <div className="omnibox">
                {browser.private && <span className="omnibox-private-pill" title="Private tab: nothing from this tab is saved"><PrivateGlyph /><span>Private</span></span>}
                {certificateBypassed && <span className="omnibox-insecure-pill is-cert-bypassed" title={`Not secure: ${browser.security?.host ?? 'this site'}’s certificate isn’t valid${browser.security?.error ? ` (${browser.security.error})` : ''} and you chose to proceed`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /><path d="M3 21 21 3" /></svg><span>Not secure</span></span>}
                {!isLocalNewTab && !pageLoadError && isInsecurePageUrl(browser.url) && <span className={`omnibox-insecure-pill${pageTransport === 'http-local-network' ? ' is-local-network' : ''}`} title={pageTransport === 'http-local-network' ? 'Not secure: this device on your local network uses plain HTTP, so anyone on the same network can read or change it' : 'Not secure: this page uses plain HTTP, so it can be read or changed on the way'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg><span>Not secure</span></span>}
                <div className="site-actions-control" ref={siteActionsControlRef}>
                  <button
                    className={`omnibox-action-button site-actions-button${siteActionsOpen ? ' is-current' : ''}`}
                    ref={siteActionsButtonRef}
                    type="button"
                    aria-label={activeOrigin ? `Site actions for ${activeOrigin}` : 'Site actions'}
                    aria-haspopup="menu"
                    aria-expanded={siteActionsOpen}
                    aria-controls="site-actions-menu"
                    title={activeOrigin ? `Site actions for ${activeOrigin}` : 'Site actions'}
                    onClick={() => setSiteActionsOpen((open) => !open)}
                  >
                    {siteConnection?.kind === 'secure'
                      ? <svg className="site-actions-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>
                      : siteConnection?.kind === 'not-secure' && browser.url.startsWith('https:')
                        ? <svg className="site-actions-lock is-broken" viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /><path d="M4 21 20 4" /></svg>
                        : <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M3.8 12h16.4M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5Z" /></svg>}
                  </button>
                  {siteActionsOpen && certificateView !== null && <div id="site-actions-menu" className="site-actions-menu is-certificate" role="dialog" aria-label="Certificate viewer">
                    {certificateView === 'loading'
                      ? <p className="site-connection-detail">Loading certificate…</p>
                      : certificateView === 'missing'
                        ? <div className="site-connection-missing"><button type="button" className="site-connection-back" onClick={() => setCertificateView(null)}>‹ Back</button><p className="site-connection-detail">No certificate details were captured for this page yet. Reload the page, then open this again.</p></div>
                        : <CertificateViewer info={certificateView} onBack={() => setCertificateView(null)} />}
                  </div>}
                  {siteActionsOpen && certificateView === null && <div id="site-actions-menu" className="site-actions-menu" role="menu" aria-label="Site actions">
                    {siteConnection && <div className={`site-connection is-${siteConnection.kind}`}>
                      <div className="site-connection-head">
                        <strong>{siteConnection.title}</strong>
                        <span className="site-connection-detail">{siteConnection.detail}</span>
                      </div>
                      {siteConnection.certificateRow && <button type="button" role="menuitem" className="site-connection-cert" onClick={() => {
                        setCertificateView('loading')
                        void window.api.browser.certificate.info().then((info) => setCertificateView(info ?? 'missing')).catch(() => setCertificateView('missing'))
                      }}>
                        <span className="site-actions-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="12" rx="2" /><path d="M8 9h8M8 12.5h5" /><path d="m15 15.5 1.5 4 1.2-1.6 1.8.4-1.5-3.6" /></svg></span>
                        <span>{siteConnection.certificateRow}</span>
                        <span className="site-connection-chevron" aria-hidden="true">›</span>
                      </button>}
                    </div>}
                    {activeOrigin && <SiteSettingsQuick origin={activeOrigin} onAllSiteSettings={() => {
                      setSiteActionsOpen(false)
                      selectSettingsSection('site', activeOrigin)
                    }} />}
                    <button type="button" role="menuitem" disabled={!activeOrigin} onClick={() => {
                      setSiteActionsOpen(false)
                      void openPictureInPicture()
                    }}>
                      <span className="site-actions-menu-icon" aria-hidden="true">▣</span>
                      <span>Picture in Picture</span>
                    </button>
                  </div>}
                </div>
                <input
                  ref={addressRef}
                  type="text"
                  value={address}
                  onChange={(event) => {
                    // Typing (including editing a filled-in suggestion) makes this the new query.
                    setAddress(event.target.value)
                    setNavigationError('')
                    setSuggestionsOpen(true)
                    setOmniboxPreview(null)
                  }}
                  onMouseDown={(event) => {
                    // First click selects the whole URL (select() in onFocus alone gets undone by
                    // the mouseup that follows); later clicks place the caret as normal.
                    if (event.button !== 0 || document.activeElement === event.currentTarget) return
                    event.preventDefault()
                    event.currentTarget.focus()
                  }}
                  onFocus={(event) => {
                    setOmniboxPreview(null)
                    event.currentTarget.select()
                    setSuggestionsOpen(true)
                    if (historyStaleRef.current) void refreshHistory()
                  }}
                  onBlur={() => {
                    addressSync.onBlur()
                    window.setTimeout(() => setSuggestionsOpen(false), 120)
                  }}
                  onKeyDown={handleAddressKeyDown}
                  aria-label="Search or enter address"
                  aria-expanded={suggestionsOpen && addressSuggestions.length > 0}
                  aria-controls="address-suggestions"
                  role="combobox"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  placeholder="Search or enter address"
                />
                {activeOrigin && !isDefaultZoom(browser.zoomFactor) && (
                  <button
                    className="omnibox-zoom-pill"
                    type="button"
                    aria-label={`Page zoom ${formatZoomPercent(browser.zoomFactor)}. Reset to 100%`}
                    title="Reset zoom to 100% (Ctrl/⌘+0)"
                    onClick={() => void window.api.browser.zoom('reset')}
                  >{formatZoomPercent(browser.zoomFactor)}</button>
                )}
                {browser.reader && !browser.pdf && <button
                  className={`omnibox-action-button pdf-edit-button reader-mode-button${browser.reader === 'active' ? ' is-current' : ''}`}
                  type="button"
                  aria-label={browser.reader === 'active' ? 'Back to page' : 'Reader view'}
                  aria-pressed={browser.reader === 'active'}
                  title={browser.reader === 'active' ? 'Back to page (⌥⌘R)' : 'Reader view: just the article, in your font, size and theme (⌥⌘R)'}
                  onClick={() => void window.api.browser.toggleReader()}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h6.5A2.5 2.5 0 0 1 13 8v11a2 2 0 0 0-2-2H4Z" /><path d="M20 5.5h-6.5A2.5 2.5 0 0 0 11 8v11a2 2 0 0 1 2-2h7Z" /></svg>
                  <span>Reader</span>
                </button>}
                {browser.pdf && <button
                  className={`omnibox-action-button pdf-edit-button${browser.pdf === 'editor' ? ' is-current' : ''}`}
                  type="button"
                  aria-label={browser.pdf === 'editor' ? 'Back to PDF viewer' : 'Edit PDF'}
                  title={browser.pdf === 'editor' ? 'Back to viewer (⇧⌘E)' : 'Edit PDF: annotate, sign, fill forms, rotate or remove pages (⇧⌘E)'}
                  onClick={() => void window.api.browser.togglePdfEditor()}
                >
                  {browser.pdf === 'editor'
                    ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6" /></svg>
                    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10v4Z" /><path d="m13 7 4 4" /></svg>}
                  <span>{browser.pdf === 'editor' ? 'Viewer' : 'Edit'}</span>
                </button>}
                <BookmarkStarControl
                  bookmarks={bookmarks}
                  url={isLocalPage ? '' : browser.url}
                  title={browser.title}
                  faviconUrl={tabs.find((tab) => tab.active)?.faviconUrl ?? null}
                  isPrivate={browser.private}
                  onOpenChange={setBookmarkPopoverOpen}
                  onShowManager={() => setSidebarMode('bookmarks')}
                />
              </div>
              {suggestionsOpen && (addressSuggestions.length > 0 || keywordMatch) && (
                <div id="address-suggestions" className="address-suggestions" role="listbox" aria-label="Local address suggestions">
                  {keywordMatch && (
                    <button
                      className="address-suggestion keyword-suggestion"
                      type="button"
                      role="option"
                      aria-selected={activeSuggestionIndex < 0}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void navigateTo(address)}
                    >
                      <span className="suggestion-mark" aria-hidden="true">⌕</span>
                      <span className="suggestion-main"><strong>{keywordMatch.query ? `Search ${keywordMatch.engine.name} for “${keywordMatch.query}”` : `Open ${keywordMatch.engine.name}`}</strong><small>Press Enter</small></span>
                      <span className="keyword-suggestion-chip">{keywordMatch.via === 'bang' ? `!${keywordMatch.engine.keyword}` : keywordMatch.engine.keyword}</span>
                    </button>
                  )}
                  {addressSuggestions.map((suggestion, index) => (
                    <button
                      className={`address-suggestion${index === activeSuggestionIndex ? ' is-selected' : ''}`}
                      key={`${suggestion.source}-${suggestion.url}`}
                      type="button"
                      role="option"
                      aria-selected={index === activeSuggestionIndex}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void navigateTo(suggestion.url)}
                    >
                      <span className="suggestion-mark" aria-hidden="true"><SuggestionFavicon url={suggestion.url} title={suggestion.title} faviconUrl={(suggestion.source === 'Open tab' ? tabs.find((tab) => tab.url === suggestion.url)?.faviconUrl : null) ?? cachedSiteIcons[httpOrigin(suggestion.url) ?? '']} /></span>
                      <span className="suggestion-main">
                        <strong><HighlightedText text={suggestion.title || suggestion.url} query={addressQuery} /></strong>
                        <small className="suggestion-url" title={suggestion.url}>
                          {suggestionUrlParts(suggestion.url, addressQuery).map((part, partIndex) => (
                            <span key={partIndex} className={`suggestion-url-${part.role}${part.match ? ' is-match' : ''}`}>{part.text}</span>
                          ))}
                        </small>
                      </span>
                      <span className="suggestion-source">{suggestion.source}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="browser-toolbar-trailing">
              {surface === 'toolbar' && <NetworkOverridesBadge enabled={networkToolEnabled} onOpen={() => selectSettingsSection('network')} />}
              <div className="omnibox-actions" role="group" aria-label="Browser panels">
                {surface !== 'sidebar' && <BookmarksMenuButton
                  bookmarks={bookmarks}
                  cachedIcons={cachedSiteIcons}
                  barVisible={bookmarksBarVisible}
                  onToggleBar={() => void window.api.browser.bookmarks.bar.set(!bookmarksBarVisible).then(setBookmarksBarVisible).catch(() => undefined)}
                  onShowManager={() => setSidebarMode('bookmarks')}
                  onOpenChange={setBookmarksMenuOpen}
                  onLayout={bumpBookmarksMenuLayout}
                />}
                {surface !== 'sidebar' && <ReadingListButton
                  url={isLocalPage ? '' : browser.url}
                  title={browser.title}
                  isPrivate={browser.private}
                  onOpenChange={setReadingListOpen}
                />}
                {surface !== 'sidebar' && <AdblockButton
                  tabId={activeTabId}
                  url={isLocalPage ? '' : browser.url}
                  onOpenChange={setAdblockOpen}
                  onOpenSettings={() => { if (activeOrigin) selectSettingsSection('site', activeOrigin) }}
                />}
                <button ref={historyButtonRef} className={`omnibox-action-button${sidebarMode === 'history' ? ' is-current' : ''}`} type="button" aria-label="Browsing history" aria-pressed={sidebarMode === 'history'} title="Browsing history" onClick={() => toggleToolbarPanel('history')}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 8.5A8 8 0 1 1 4 12" /><path d="M4.5 4.5v4h4M12 7.5v5l3 1.8" /></svg>
                </button>
              </div>
              {isChromeWebStoreDetailUrl(browser.url) && (
                <button
                  className="store-add-button"
                  type="button"
                  disabled={webStoreExtensions.busy}
                  title="Install this Chrome Web Store extension in Surffish"
                  onClick={() => {
                    selectSettingsSection('integrations')
                    void runExtensionAction(() => window.api.browser.extensions.install(browser.url), setWebStoreExtensions, webStoreExtensions)
                  }}
                >
                  {webStoreExtensions.busy ? 'Installing…' : 'Add to Surffish'}
                </button>
              )}
              {extensionPins.isPinned(BRAMBLE_TOOLBAR_ID, true) && (
              <button
                className={`toolbar-button bramble-toolbar-button${bramblePoc.installed ? ' is-installed' : ''}`}
                ref={brambleButtonRef}
                type="button"
                aria-label={brambleToolbarAction === 'install' ? 'Install Bramble' : 'Open Bramble'}
                aria-haspopup={brambleToolbarAction === 'open' ? 'dialog' : undefined}
                aria-expanded={bramblePoc.popupOpen}
                aria-busy={bramblePoc.loading}
                title={brambleToolbarAction === 'install' ? 'Install Bramble in this Surffish profile · verified release and permission confirmation' : bramblePoc.version ? `Open Bramble ${bramblePoc.version}` : 'Open Bramble'}
                disabled={brambleToolbarAction === 'busy'}
                onClick={() => { void handleBrambleToolbarClick() }}
              >
                <img className="bramble-toolbar-icon" src={brambleExtensionIcon} alt="" />
              </button>
              )}
              <ExtensionToolbarButtons
                state={webStoreExtensions}
                setState={setWebStoreExtensions}
                pins={extensionPins}
                onManage={() => selectSettingsSection('integrations')}
                onMenuOpenChange={setExtensionsMenuOpen}
                bramble={{
                  label: brambleToolbarAction === 'install' ? 'Install Bramble' : 'Bramble',
                  iconSrc: brambleExtensionIcon,
                  disabled: brambleToolbarAction === 'busy',
                  onOpen: () => { void handleBrambleToolbarClick() }
                }}
              />
              <div className="downloads-toolbar-control" ref={downloadsControlRef}>
                <button
                  className={`toolbar-button downloads-toolbar-button${downloadsPopupOpen ? ' is-open' : ''}`}
                  ref={downloadsButtonRef}
                  type="button"
                  aria-label="Downloads"
                  aria-haspopup="dialog"
                  aria-expanded={downloadsPopupOpen}
                  aria-controls="downloads-popup"
                  title="Downloads"
                  onClick={() => setDownloadsPopupOpen((open) => !open)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v12" /><path d="m7 10.5 5 5 5-5" /><path d="M4.5 16v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" /></svg>
                </button>
                {downloadsPopupOpen && <DownloadsPanel mode="popup" onShowAll={() => {
                  setDownloadsPopupOpen(false)
                  setSidebarMode('downloads')
                }} onClose={() => {
                  setDownloadsPopupOpen(false)
                  downloadsButtonRef.current?.focus()
                }} />}
              </div>
              <div className="toolbar-brand" aria-label="Surffish" title="Surffish" onClick={brandEgg.onClick}>
                <img className="toolbar-brand-icon" src="./surffish-brand-icon.png" alt="" aria-hidden="true" draggable={false} />
                <strong>Surffish</strong>
              </div>
            </div>
          </form>
          {surface !== 'sidebar' && bookmarksBarVisible && <BookmarksBar bookmarks={bookmarks} cachedIcons={cachedSiteIcons} onShowManager={() => setSidebarMode('bookmarks')} onOpenChange={setBookmarksBarMenuOpen} onLayout={bumpBookmarksMenuLayout} />}
          {surface === 'toolbar' && <FindBar onOpenChange={setFindOpen} />}
          {surface !== 'sidebar' && <ProxyDownBanner />}
          {surface !== 'sidebar' && <CommandPalette tabs={tabs} pinnedSites={pinnedSites} searchEngine={searchEngine} searchEngineLabel={SEARCH_ENGINES.find((engine) => engine.id === searchEngine)?.label ?? 'the web'} onOpenChange={setPaletteOpen} />}
          {surface !== 'sidebar' && navigationError && (
            <BrowserNotice
              tone="error"
              title={navigationError === INVALID_ADDRESS_ERROR ? INVALID_ADDRESS_COPY.title : navigationError}
              detail={navigationError === INVALID_ADDRESS_ERROR ? INVALID_ADDRESS_COPY.detail : undefined}
              onDismiss={() => setNavigationError('')}
            />
          )}
          {surface !== 'sidebar' && !navigationError && showLoadErrorNotice && browser.loadError && (
            <LoadErrorNotice loadError={browser.loadError} onDismiss={() => setDismissedLoadErrors((keys) => [...keys.slice(-19), loadErrorKey])} />
          )}
          {surface !== 'sidebar' && brandEgg.open && <BrandEasterEgg onClose={brandEgg.close} />}
        </header>
        <div className="browser-viewport" ref={viewportRef} aria-label={pageMode === 'settings' || pageMode === 'newtab' || pageMode === 'integrations' ? 'Settings content' : pageMode === 'downloads' ? 'Downloads content' : pageMode === 'bookmarks' ? 'Bookmark manager' : pageMode === 'network' ? 'Network inspector' : pageMode === 'diagnostics' ? 'Diagnostics' : pageMode === 'site' ? 'Site settings' : 'Web page area'}>
          {sidebarMode === 'tabs' && !sidebarVisible && <div className="sidebar-reveal-edge" aria-hidden="true" onMouseEnter={revealSidebar} onMouseMove={revealSidebar} onMouseLeave={scheduleSidebarHide} />}
          {isLocalNewTab && !SETTINGS_SECTIONS.some((section) => section.mode === pageMode) && pageMode !== 'downloads' && pageMode !== 'bookmarks' && (
            <section className={`new-tab-page${browser.private ? ' is-private' : ''}`} aria-label={browser.private ? 'New private tab' : 'New Tab'} style={{
              '--new-tab-dim': (newTabPreferences.backgroundDim / 100).toFixed(2),
              '--new-tab-dim-soft': (newTabPreferences.backgroundDim / 350).toFixed(2),
              '--new-tab-dim-mid': (newTabPreferences.backgroundDim / 165).toFixed(2),
              '--new-tab-background-blur': `${newTabPreferences.backgroundBlur}px`
            } as React.CSSProperties}>
              <div
                key={newTabBackground.title}
                className="new-tab-backdrop"
                aria-hidden="true"
                style={{ backgroundImage: `url("${newTabBackground.src}")` }}
              />
              <div className="new-tab-content">
                <h1 className="new-tab-sr-only">{browser.private ? 'New private tab' : 'New Tab'}</h1>
                {browser.private && (
                  <div className="new-tab-private-hero">
                    <span className="new-tab-private-icon" aria-hidden="true"><PrivateGlyph /></span>
                    <strong>Private tab</strong>
                    <p>Nothing here is saved to history, tabs or downloads, and cookies and site data are wiped when you close the last private tab. You're signed out of everything, so searches aren't personalised. Extensions are off; your proxy and ad blocking still apply.</p>
                  </div>
                )}
                {(newTabPreferences.showClock || newTabPreferences.worldClocks.length > 0 || newTabWeatherPlacement === 'below' || newTabPreferences.showGreeting) && (
                  <div className={`new-tab-widgets new-tab-clock-weight-${newTabPreferences.clockWeight}${newTabPreferences.clockTabularDigits ? '' : ' new-tab-clock-proportional'}`} style={{ '--new-tab-clock-scale': (newTabPreferences.clockScale / 100).toFixed(2) } as React.CSSProperties} aria-label="Time and weather" ref={newTabWidgetsRef}>
                    {newTabPreferences.showGreeting && <p className="new-tab-greeting">{clockGreeting(clockNow, newTabPreferences.timeZone)}</p>}
                    {newTabPreferences.showClock && (
                      <div className="new-tab-clock">
                        <time className="new-tab-clock-time" dateTime={clockNow.toISOString()}>{formatClockTime(clockNow, newTabPreferences)}</time>
                        <span className="new-tab-clock-label">{newTabPreferences.timeZone === 'local' ? 'Local time' : newTabPreferences.timeZone.replaceAll('_', ' ')}</span>
                        {newTabPreferences.showDate && <time className="new-tab-clock-date" dateTime={clockNow.toISOString()}>{formatClockDate(clockNow, newTabPreferences.timeZone, newTabPreferences.dateFormat)}</time>}
                      </div>
                    )}
                    {newTabPreferences.worldClocks.map((clock) => {
                      const difference = newTabPreferences.worldClockShowDifference ? formatZoneDifference(zoneDifferenceMinutes(clockNow, clock.timeZone, newTabPreferences.timeZone)) : null
                      const relativeDay = newTabPreferences.worldClockShowDay ? relativeClockDay(clockNow, clock.timeZone, newTabPreferences.timeZone) : null
                      return (
                        <div className="new-tab-clock" key={clock.id}>
                          <time className="new-tab-clock-time" dateTime={clockNow.toISOString()}>{formatClockTime(clockNow, { ...newTabPreferences, timeZone: clock.timeZone })}</time>
                          <span className="new-tab-clock-label">{clock.label}</span>
                          {(difference || relativeDay) && <span className="new-tab-clock-diff">{[relativeDay, difference].filter(Boolean).join(' · ')}</span>}
                          {newTabPreferences.showDate && <time className="new-tab-clock-date" dateTime={clockNow.toISOString()}>{formatClockDate(clockNow, clock.timeZone, newTabPreferences.dateFormat)}</time>}
                        </div>
                      )
                    })}
                    {newTabWeatherPlacement === 'below' && newTabWeatherWidget}
                  </div>
                )}
                {newTabWeatherPlacement === 'corner' && newTabWeatherWidget}
                {/* Vertical position: the icons sit at a fraction of the free space between the clocks and the photo credit (never off-screen; scrolls if a tiny window can't fit them). Private tabs keep the hero layout. */}
                <div className={browser.private ? 'new-tab-icon-flow' : 'new-tab-icon-track'} style={{ '--new-tab-icon-position': (newTabPreferences.iconVerticalPosition / 100).toFixed(3) } as React.CSSProperties}>
                  {(browser.private ? favoriteSites.length > 0 : newTabSites.length > 0) ? (
                    <div className="new-tab-link-groups" style={{
                      '--new-tab-icon-size': `${newTabPreferences.iconSize}px`,
                      '--new-tab-links-per-row': newTabPreferences.linksPerRow
                    } as React.CSSProperties}>
                      {!browser.private && frequentlyVisitedSites.length > 0 && <section className="new-tab-link-group" aria-label="Most visited sites">
                        <div className="new-tab-icon-grid" role="group" aria-label="Most visited sites">
                          {frequentlyVisitedSites.map((site) => <NewTabSiteIcon key={site.origin} site={site} faviconUrl={cachedSiteIcons[site.origin] ?? tabs.find((tab) => httpOrigin(tab.url) === site.origin)?.faviconUrl} showLabel={newTabPreferences.showLinkLabels} iconSize={newTabPreferences.iconSize} onOpen={() => void navigateTo(site.url)} />)}
                        </div>
                        <span className="new-tab-group-label">Most visited</span>
                      </section>}
                      {favoriteSites.length > 0 && <section className="new-tab-link-group" aria-label="Favourite sites">
                        <div className="new-tab-icon-grid" role="group" aria-label="Favourite sites">
                          {favoriteSites.map((site) => <NewTabSiteIcon key={site.origin} site={site} faviconUrl={cachedSiteIcons[site.origin] ?? tabs.find((tab) => httpOrigin(tab.url) === site.origin)?.faviconUrl} showLabel={newTabPreferences.showLinkLabels} iconSize={newTabPreferences.iconSize} onOpen={() => void navigateTo(site.url)} />)}
                        </div>
                        <span className="new-tab-group-label">Favourites</span>
                      </section>}
                    </div>
                  ) : !browser.private && <p className="new-tab-empty">Pin a site from the address bar to add its icon here.</p>}
                </div>
                <span className="new-tab-sr-only" role="status" aria-live="polite">{photoRefreshStatus}</span>
                <footer className="new-tab-photo-footer">
                  <p className="new-tab-photo-credit">
                    Photo: <a href={newTabBackground.sourceUrl} target="_blank" rel="noreferrer">{newTabBackground.title}</a>
                    {' · '}{newTabBackground.creator}{' · '}
                    <a href={newTabBackground.licenseUrl} target="_blank" rel="noreferrer">{newTabBackground.licenseName}</a>
                  </p>
                  <div className="new-tab-background-controls">
                    <button
                      className="new-tab-background-action"
                      type="button"
                      title="Next background"
                      aria-label="Show next background"
                      onClick={() => setNewTabBackgroundIndex((index) => nextQuickLinkBackgroundIndex(index, newTabBackgrounds.length))}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 7v5h-5" />
                        <path d="M19 12a7 7 0 1 0 2 4.9" />
                      </svg>
                    </button>
                    <button
                      className={`new-tab-background-action${photoRefreshBusy ? ' is-refreshing' : ''}`}
                      type="button"
                      title={photoRefreshBusy ? 'Refreshing nature photos…' : 'Refresh nature photos'}
                      aria-label="Refresh nature photos from Wikimedia Commons"
                      disabled={photoRefreshBusy}
                      onClick={() => void refreshNaturePhotos()}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 7v5h-5" />
                        <path d="M19 12a7 7 0 0 0-13-4M5 17v-5h5" />
                        <path d="M5 12a7 7 0 0 0 13 4" />
                      </svg>
                    </button>
                    {surface === 'content' && (
                      <button
                        ref={newTabGearRef}
                        className={`new-tab-background-action new-tab-customize-gear${newTabCustomizeOpen ? ' is-active' : ''}`}
                        type="button"
                        title="Customize New Tab"
                        aria-label="Customize New Tab"
                        aria-expanded={newTabCustomizeOpen}
                        aria-controls="new-tab-customize-panel"
                        onPointerEnter={warmNewTabCustomize}
                        onFocus={warmNewTabCustomize}
                        onClick={() => { setNewTabCustomizeLoaded(true); setNewTabCustomizeOpen((open) => !open) }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
                          <circle cx="16" cy="7" r="2" />
                          <circle cx="10" cy="17" r="2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </footer>
              </div>
              {surface === 'content' && newTabCustomizeLoaded && (
                <NewTabCustomizePanel
                  {...newTabFieldsProps}
                  open={newTabCustomizeOpen}
                  onClose={closeNewTabCustomize}
                  onOpenSettings={() => { setNewTabCustomizeOpen(false); selectSettingsSection('newtab') }}
                  gearRef={newTabGearRef}
                />
              )}
            </section>
          )}
          {SETTINGS_SECTIONS.some((section) => section.mode === settingsNavMode(pageMode)) && (
            <nav className="settings-subnav" aria-label="Browser settings sections">
              {visibleWatcherSections(SETTINGS_SECTIONS, watchersEnabled !== false).filter((section) => section.mode !== 'network' || networkToolEnabled).map((section) => (
                <button key={section.mode} type="button" className={settingsNavMode(pageMode) === section.mode ? 'is-current' : ''} aria-current={settingsNavMode(pageMode) === section.mode ? 'page' : undefined} onClick={() => selectSettingsSection(section.mode)}>{section.label}{section.mode === 'watchers' && unseenWatchers > 0 && <span className="settings-subnav-badge" aria-label={`${unseenWatchers} changed`}>{unseenWatchers}</span>}{section.mode === 'integrations' && unreadFeeds > 0 && <span className="settings-subnav-badge" aria-label={`${unreadFeeds} unread feed items`}>{unreadFeeds > 99 ? '99+' : unreadFeeds}</span>}</button>
              ))}
              <SettingsSearchField value={settingsQuery} onChange={setSettingsQuery} />
            </nav>
          )}
          {surface === 'content' && settingsQuery.trim() !== '' && SETTINGS_SECTIONS.some((section) => section.mode === settingsNavMode(pageMode)) && (
            <SettingsSearchStatus
              query={settingsQuery}
              matches={settingsSearch.matches}
              mode={pageMode as SettingsSectionMode}
              available={(mode) => (mode !== 'network' || networkToolEnabled) && (mode !== 'watchers' || watchersEnabled !== false)}
              labelFor={(mode) => mode === 'feeds' ? 'Integrations → Feeds' : SETTINGS_SECTIONS.find((section) => section.mode === mode)?.label ?? mode}
              onOpen={(mode) => selectSettingsSection(mode as SettingsSectionMode)}
              onClear={() => setSettingsQuery('')}
            />
          )}
          {surface === 'content' && browser.interstitial && !isLocalNewTab && !isSettingsSection(pageMode) && pageMode !== 'downloads' && <TabInterstitial interstitial={browser.interstitial} canGoBack={browser.canGoBack} />}
          {surface === 'content' && hasLoadErrorPage && browser.loadError && !isLocalNewTab && !isSettingsSection(pageMode) && pageMode !== 'downloads' && pageMode !== 'bookmarks' && <LoadErrorPage loadError={browser.loadError} canGoBack={browser.canGoBack} />}
          {pageMode === 'downloads' && <DownloadsPanel mode="page" onClose={() => setSidebarMode('tabs')} />}
          {pageMode === 'privacy' && <PrivacySettings />}
          {pageMode === 'watchers' && watchersEnabled !== false && <PageWatchersSettings />}
          {pageMode === 'bookmarks' && surface === 'content' && <BookmarksManager bookmarks={bookmarks} cachedIcons={cachedSiteIcons} onClose={() => setSidebarMode('tabs')} onOpened={() => setSidebarMode('tabs')} />}
          {(pageMode === 'settings' || pageMode === 'newtab' || pageMode === 'integrations' || pageMode === 'feeds') && (
            <div className={`settings-view settings-view-${pageMode}`}>
              <header className="settings-page-header">
                <div className="settings-page-heading-copy">
                  <h1>{pageMode === 'integrations' || pageMode === 'feeds' ? 'Integrations' : pageMode === 'newtab' ? 'New Tab' : 'General'}</h1>
                  <p>{pageMode === 'integrations' || pageMode === 'feeds' ? 'Extensions and feeds.' : pageMode === 'newtab' ? 'Layout, clocks, weather and background for new tabs.' : 'Search, default browser, tabs, privacy and connection.'}</p>
                </div>
                {(pageMode === 'integrations' || pageMode === 'feeds') && (
                  <div className="settings-segmented integrations-tabs" role="tablist" aria-label="Integrations">
                    {INTEGRATIONS_TABS.map((tab) => (
                      <button key={tab.mode} type="button" role="tab" aria-selected={pageMode === tab.mode} className={pageMode === tab.mode ? 'is-selected' : ''} onClick={() => selectSettingsSection(tab.mode)}>
                        {tab.label}{tab.mode === 'feeds' && unreadFeeds > 0 && <span className="settings-subnav-badge" aria-label={`${unreadFeeds} unread`}>{unreadFeeds > 99 ? '99+' : unreadFeeds}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </header>
              <div className={`settings-content${pageMode === 'settings' ? ' has-toc' : ''}`} key={pageMode}>
                {pageMode === 'settings' && <SettingsToc categories={GENERAL_CATEGORIES} counts={settingsQuery.trim() ? settingsSearch.categories : null} rootRef={viewportRef} />}
                {pageMode === 'settings' && <div className="settings-categories">
                <SettingsCategory id="browsing" title="Browsing">
                <SettingsGroup title="Search">
                  <SettingsRow label="Search engine" hint="Used for searches typed into the address bar.">
                    <select className="settings-select" value={searchEngine} disabled={!searchEngineLoaded} onChange={(event) => setSearchEngine(event.target.value as SearchEngineId)} aria-label="Default search engine">
                      {SEARCH_ENGINES.map((engine) => <option key={engine.id} value={engine.id}>{engine.label}</option>)}
                    </select>
                  </SettingsRow>
                </SettingsGroup>
                <SearchKeywordsSettings />
                <CommandPaletteSettings />
                <DefaultBrowserSettings />
                <SettingsGroup title="Import">
                  <BookmarkImportPanel />
                </SettingsGroup>
                </SettingsCategory>
                <SettingsCategory id="appearance" title="Appearance" single>
                <AppearanceSettings />
                </SettingsCategory>
                <SettingsCategory id="tabs" title="Tabs & windows">
                <SettingsGroup title="Tabs">
                  <SettingsRow label="Hibernate inactive tabs" hint="Audible tabs stay awake." info="Hibernated tabs reload their last page; unsaved form state is lost.">
                    <select
                      className="settings-select"
                      value={tabSleepMinutes}
                      onChange={(event) => {
                        const minutes = Number(event.target.value) as TabSleepMinutes
                        void window.api.browser.setTabSleepMinutes(minutes).then((saved) => {
                          if (saved !== null) setTabSleepMinutes(saved)
                        })
                      }}
                      aria-label="Hibernate inactive tabs after"
                    >
                      <option value={0}>Never</option>
                      <option value={5}>After 5 minutes</option>
                      <option value={15}>After 15 minutes</option>
                      <option value={30}>After 30 minutes</option>
                      <option value={60}>After 1 hour</option>
                    </select>
                  </SettingsRow>
                  <MemorySaverSettings />
                  <PreloadPagesSettings />
                  <SettingsRow label="Saved session" hint="Tabs restore on next launch; credential-like URL parts are stripped." info="Tokens, codes and other credential-like URL parts are removed before the session is saved.">
                    <button className="settings-action secondary" type="button" aria-label="Clear saved session" onClick={() => void clearSavedSession()}>Clear</button>
                  </SettingsRow>
                  {sessionMessage && <p className="settings-message" role="status">{sessionMessage}</p>}
                </SettingsGroup>
                <GlanceSettings />
                <TabArchiveSettings />
                <SpacesSettings />
                </SettingsCategory>
                <SettingsCategory id="mini-window" title="Mini window" single>
                <MiniWindowSettings />
                </SettingsCategory>
                <SettingsCategory id="features" title="Features">
                <LocalAISettings />
                <PageWatchersToggle />
                <SpellcheckSettings />
                </SettingsCategory>
                <SettingsCategory id="connection" title="Connection">
                <SettingsGroup
                  title="SOCKS5 proxy"
                  status={appliedProxy.enabled ? `${appliedProxy.host}:${appliedProxy.port}` : 'Direct connection'}
                  statusOn={appliedProxy.enabled}
                  className="settings-connection"
                  aside={<input type="checkbox" className="settings-switch" checked={proxy.enabled} onChange={(event) => setProxy((current) => ({ ...current, enabled: event.target.checked }))} aria-label="Use local SOCKS5 proxy" />}
                >
                  <div className="settings-inline-fields">
                    <label className="settings-field settings-field-grow">
                      <span>Host</span>
                      <input type="text" value={proxy.host} spellCheck={false} onChange={(event) => setProxy((current) => ({ ...current, host: event.target.value }))} aria-label="Local SOCKS5 host" />
                    </label>
                    <label className="settings-field settings-field-port">
                      <span>Port</span>
                      <input type="number" value={proxy.port} min={1} max={65535} onChange={(event) => setProxy((current) => ({ ...current, port: Number(event.target.value) }))} aria-label="Local SOCKS5 port" />
                    </label>
                  </div>
                  <SettingsRow label="Local network goes direct" hint="Your router, NAS, printer and .local names skip the proxy." info="Private addresses (192.168.x.x, 10.x.x.x, 172.16–31.x.x, link-local) and .local names skip the proxy, so your router, NAS or printer opens like in other browsers. Turn off to send them through the tunnel too. Applies when you Save.">
                    <input type="checkbox" className="settings-switch" checked={proxy.bypassLocalNetwork !== false} onChange={(event) => setProxy((current) => ({ ...current, bypassLocalNetwork: event.target.checked }))} aria-label="Connect to local network addresses directly" />
                  </SettingsRow>
                  <ProxyKillSwitchSetting />
                  <div className="settings-actions">
                    <p className="settings-help">Start a tunnel first: <code>ssh -N -D 127.0.0.1:1080 user@host</code></p>
                    <button className="settings-action secondary" type="button" disabled={busy} onClick={() => void testProxy()}>Test port</button>
                    <button className="settings-action primary" type="button" disabled={busy} onClick={() => void saveProxy()}>{busy ? 'Working…' : 'Save'}</button>
                  </div>
                  {(proxyMessage || browser.error) && <p className={`settings-message${proxyMessageIsError || browser.error ? ' is-error' : ''}`} role="status">{browser.error ? (() => { const copy = describeLoadError({ ...browser.loadError, message: browser.error }); return `${copy.title}. ${copy.detail}` })() : proxyMessage}</p>}
                </SettingsGroup>
                <NetworkRulesSettings />
                </SettingsCategory>
                <SettingsCategory id="advanced" title="Advanced">
                <SettingsGroup title="Developer">
                  <SettingsRow label="Network inspector" hint="Adds a Network tab that records requests from every tab. Off saves CPU and memory; turning it off also stops capture and clears recorded requests.">
                    <input type="checkbox" className="settings-switch" checked={networkToolEnabled} onChange={(event) => setNetworkToolEnabled(event.target.checked)} aria-label="Enable network inspector" />
                  </SettingsRow>
                </SettingsGroup>
                <UpdateSettings />
                </SettingsCategory>
                <p className="settings-footnote">Browser data stays in this profile. Session-only sign-in cookies are saved with OS-backed encryption when available.</p>
                </div>}
                {pageMode === 'newtab' && <NewTabSettingsFields {...newTabFieldsProps} variant="page" onCustomizeOnNewTab={customizeOnNewTab} />}
                {pageMode === 'integrations' && <>
                <SettingsGroup
                  title="Bramble password manager"
                  status={bramblePoc.loading ? 'Working…' : bramblePoc.installed ? `Installed · ${bramblePoc.version ?? 'version unknown'}${bramblePoc.updateAvailable ? ' · update available' : ''}` : 'Not installed'}
                  statusOn={bramblePoc.installed}
                  icon={bramblePoc.iconDataUrl ?? brambleExtensionIcon}
                  className="bramble-settings-section"
                >
                  <p className="settings-help">Verified Firefox release, scoped to this Surffish profile. Google Drive backup is unavailable (Firefox-only OAuth).</p>
                  <div className="settings-actions bramble-settings-actions">
                    <button className="settings-action secondary" type="button" disabled={bramblePoc.loading} onClick={() => void window.api.browser.bramble.checkForUpdates()}>{bramblePoc.loading ? 'Checking…' : 'Check for updates'}</button>
                    <button className="settings-action secondary" type="button" disabled={!bramblePoc.installed || bramblePoc.loading} onClick={() => void openBrambleSetupPage()}>Setup</button>
                    <button className="settings-action primary" type="button" disabled={bramblePoc.loading || (bramblePoc.installed && bramblePoc.latestVersion !== null && !bramblePoc.updateAvailable)} onClick={() => void window.api.browser.bramble.installLatest()}>
                      {brambleInstallLabel}
                    </button>
                  </div>
                  {(bramblePoc.permissions.length > 0 || bramblePoc.hostPermissions.length > 0) && (
                    <details className="extension-gaps">
                      <summary>Permissions and verification</summary>
                      {bramblePoc.latestVersion && <p className="settings-help">Latest Firefox release: <strong>{bramblePoc.latestVersion}</strong></p>}
                      {bramblePoc.permissions.length > 0 && <p className="settings-help"><strong>Extension permissions:</strong> {bramblePoc.permissions.join(', ')}</p>}
                      {bramblePoc.hostPermissions.length > 0 && <p className="settings-help"><strong>Site access:</strong> {bramblePoc.hostPermissions.join(', ')}</p>}
                      <p className="settings-help">Releases are checked against Bramble’s SHA256SUMS and the GitHub asset digest. Installs and updates are always manual and show requested access first.</p>
                    </details>
                  )}
                  {bramblePoc.notice && <p className="settings-message" role="status">{bramblePoc.notice}</p>}
                  {bramblePoc.error && <p className="settings-message is-error" role="alert">{bramblePoc.error}</p>}
                </SettingsGroup>
                {bramblePoc.installed && <BrambleQuickUnlockSettings />}
                <ExtensionsSettings state={webStoreExtensions} setState={setWebStoreExtensions} />
                </>}
                {/* Lazy chunk: Integrations opening on Extensions never loads the Feeds view. */}
                {pageMode === 'feeds' && <FeedsSettings />}
              </div>
            </div>
          )}
          {pageMode === 'site' && <SitesSettings focusHost={settingsTab?.host} revision={settingsTab?.revision} />}
          {pageMode === 'network' && networkToolEnabled && <NetworkView tabs={tabs} live={surface === 'content'} />}
          {pageMode === 'diagnostics' && <DiagnosticsView live={surface === 'content'} />}
        </div>
      </div>
    </section>
  )
}
