import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type {
  BrambleExtensionState,
  BrowserChromeState,
  BrowserPreferencesSnapshot,
  BrowserSidebarMode,
  BrowserProxySettings,
  BrowserSiteSettings,
  BrowserState,
  BrowserTabSummary,
  BrowsingHistoryEntry,
  NewTabBackground,
  NewTabPreferences,
  NewTabPageId,
  NewTabWeatherSnapshot,
  PinnedSite,
  SearchEngineId,
  TabSleepMinutes,
  WorldClockPreference
} from '../../../shared/types'
import { DEFAULT_SEARCH_ENGINE, getSearchHomepage, SEARCH_ENGINES, SURFFISH_QUICK_LINKS_URL } from '../../../shared/navigation'
import { DEFAULT_NEW_TAB_PREFERENCES, DEFAULT_SIDEBAR_WIDTH, MAX_PINNED_SITES, MAX_SIDEBAR_WIDTH, MAX_WORLD_CLOCKS, MIN_SIDEBAR_WIDTH, normalizeSidebarWidth } from '../../../shared/persistence'
import { buildAddressSuggestions } from '../../../shared/autocomplete'
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
import DownloadsPanel from './DownloadsPanel'
import { FindBar } from './FindBar'
import { CommandPalette } from './CommandPalette'
import { useSearchKeywords } from './useSearchKeywords'
import { SearchKeywordsSettings } from './settings/SearchKeywordsSettings'
import { CommandPaletteSettings } from './settings/CommandPaletteSettings'
import { parseKeywordSearch } from '../../../shared/search-keywords'
import NetworkView, { useNetworkToolEnabled } from './NetworkView'
import { PinnedTabIcon, PrivateGlyph, TabAudioButton, TabFavicon } from './TabIndicators'
import DiagnosticsView, { useTabUsageHints, withTabUsageHint } from './DiagnosticsView'
import { SettingsGroup, SettingsRow, SettingsSlider } from './settings/SettingsControls'
import { DefaultBrowserSettings } from './settings/DefaultBrowserSettings'
import { SpellcheckSettings } from './settings/SpellcheckSettings'
import { ProxyKillSwitchSetting } from './settings/ProxyKillSwitchSetting'
import { PrivacySettings } from './settings/PrivacySettings'
import { PageWatchersSettings, useUnseenWatcherCount } from './settings/PageWatchersSettings'
import { SiteDataSettings } from './settings/SiteDataSettings'
import { TabInterstitial } from './TabInterstitial'
import { ProxyDownBanner } from './ProxyDownBanner'
import { NetworkOverridesBadge } from './NetworkOverridesPanel'
import { NetworkRulesSettings } from './settings/NetworkRulesSettings'
import { SiteRouteSettings } from './settings/SiteRouteSettings'
import { isInsecurePageUrl } from '../../../shared/https-only'
import { UpdateSettings } from './settings/UpdateSettings'
import { UpdateBadge } from './settings/UpdateBadge'
import { formatVisitedAt } from '../lib/format'
import { useTabDragSort } from './useTabDragSort'
import { SplitTabEntry } from './SplitTabEntry'
import { groupTabEntries } from '../../../shared/split-view'
import { dropTargetGroup, TAB_GROUP_COLOR_VALUES, withGroupHeaders } from '../../../shared/tab-groups'
import { TabGroupHeader } from './tab-groups/TabGroupHeader'
import TimeZonePicker from './TimeZonePicker'
import { BRAMBLE_TOOLBAR_ID, ExtensionToolbarButtons, useExtensionPins } from './ExtensionToolbarButtons'
import { ExtensionsSettings } from './ExtensionsSettings'
import { runExtensionAction, useWebStoreExtensions } from './useWebStoreExtensions'
import { isChromeWebStoreDetailUrl } from '../../../shared/chrome-web-store'
import { WORLD_CITIES } from '../../../shared/world-cities'
import { useBookmarks, bookmarkOrigin } from './bookmarks/useBookmarks'
import { BookmarkStarControl } from './bookmarks/BookmarkStarControl'
import { BookmarksSidebar } from './bookmarks/BookmarksSidebar'
import { ArchivedTabsSidebar } from './tab-archive/ArchivedTabsSidebar'
import { TabArchiveSettings } from './settings/TabArchiveSettings'
import { SpacesSettings } from './settings/SpacesSettings'
import { SpacesSwitcher, useSpaces } from './spaces/SpacesSwitcher'
import { SPACE_COLOR_VALUES } from '../../../shared/spaces'
import { BookmarksManager } from './bookmarks/BookmarksManager'
import { BookmarkImportPanel } from './bookmarks/BookmarkImportPanel'
import './Browser.css'
import './bookmarks/bookmarks.css'

const DEFAULT_PROXY: BrowserProxySettings = { enabled: true, host: '127.0.0.1', port: 1080 }
const BONJOURR_START_PAGE = 'https://online.bonjourr.fr/'
const COMMON_TIME_ZONES = [
  'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland', 'Asia/Kolkata', 'Asia/Tokyo', 'Asia/Singapore',
  'Europe/London', 'Europe/Paris', 'Europe/Bratislava', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'UTC'
]
const SYSTEM_TIME_ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
const TIME_ZONE_OPTIONS = Array.from(new Set([...COMMON_TIME_ZONES, ...SYSTEM_TIME_ZONES, 'UTC']))

function timeZoneCityName(timeZone: string): string {
  return timeZone.split('/').at(-1)?.replaceAll('_', ' ') || timeZone
}

function timeZoneOptionLabel(timeZone: string): string {
  return timeZone.replaceAll('_', ' ')
}

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
  interstitial: null
}
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
  return mode === 'settings' || mode === 'newtab' || mode === 'integrations' || mode === 'site' || mode === 'network' || mode === 'privacy' || mode === 'diagnostics' || mode === 'watchers'
}

type SettingsSectionMode = Extract<SidebarMode, 'settings' | 'newtab' | 'integrations' | 'site' | 'network' | 'privacy' | 'diagnostics' | 'watchers'>

const SETTINGS_SECTIONS: ReadonlyArray<{ mode: SettingsSectionMode; label: string }> = [
  { mode: 'settings', label: 'General' },
  { mode: 'newtab', label: 'New Tab' },
  { mode: 'integrations', label: 'Extensions' },
  { mode: 'privacy', label: 'Privacy' },
  { mode: 'watchers', label: 'Watchers' },
  { mode: 'site', label: 'This site' },
  { mode: 'network', label: 'Network' },
  { mode: 'diagnostics', label: 'Diagnostics' }
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

function formatNewTabTime(date: Date, timeZone: string, preferences: NewTabPreferences): string {
  return new Intl.DateTimeFormat(undefined, {
    ...(timeZone === 'local' ? {} : { timeZone }),
    hour: '2-digit',
    minute: '2-digit',
    ...(preferences.showSeconds ? { second: '2-digit' as const } : {}),
    hour12: !preferences.use24HourTime
  }).format(date)
}

function formatNewTabDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    ...(timeZone === 'local' ? {} : { timeZone }),
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).format(date)
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
  })
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
  const [cachedSiteIcons, setCachedSiteIcons] = useState<Record<string, string>>({})
  const [chromeState, setChromeState] = useState<BrowserChromeState>(DEFAULT_CHROME_STATE)
  const { sidebarMode, sidebarPinned, sidebarHovered, sidebarFocused, sidebarWidth, sidebarResizing } = chromeState
  // Watchers with a change the user hasn't opened yet (badge on Settings → Watchers). Content surface only.
  const unseenWatchers = useUnseenWatcherCount(surface === 'content')
  const [historyQuery, setHistoryQuery] = useState('')
  const [address, setAddress] = useState(EMPTY_BROWSER.url)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
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
  const [tabSleepMinutes, setTabSleepMinutes] = useState<TabSleepMinutes>(30)
  const [searchEngineLoaded, setSearchEngineLoaded] = useState(false)
  const [downloadsPopupOpen, setDownloadsPopupOpen] = useState(false)
  const [siteActionsOpen, setSiteActionsOpen] = useState(false)
  const [extensionsMenuOpen, setExtensionsMenuOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const extensionPins = useExtensionPins()
  const [networkToolEnabled, setNetworkToolEnabled] = useNetworkToolEnabled()
  const [proxy, setProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [appliedProxy, setAppliedProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [siteSettings, setSiteSettings] = useState<BrowserSiteSettings | null>(null)
  const [siteSettingsLoading, setSiteSettingsLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [proxyMessage, setProxyMessage] = useState('')
  const [sessionMessage, setSessionMessage] = useState('')
  const [navigationError, setNavigationError] = useState('')
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

  function saveNewTabPreferences(next: NewTabPreferences): void {
    setNewTabPreferences(next)
    void window.api.browser.newTabPreferences.set(next).catch(() => undefined)
  }

  function patchNewTabPreferences(patch: Partial<NewTabPreferences>): void {
    saveNewTabPreferences({ ...newTabPreferences, ...patch })
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
  // Only build suggestions while the dropdown is open, and never in the sidebar surface (it has no
  // address bar). Otherwise every tab/history update re-ran the matcher in all three renderers.
  const suggestionsActive = suggestionsOpen && surface !== 'sidebar'
  const addressSuggestions = useMemo(
    // Favourites come first in tree order, so the old pinned-site ranking holds without a separate list.
    () => suggestionsActive ? buildAddressSuggestions(address, [], tabs, history, 7, bookmarkSuggestions) : [],
    [suggestionsActive, address, tabs, history, bookmarkSuggestions]
  )
  // "yt cats" / "cats !yt": show which engine the address bar will use.
  const searchKeywordEngines = useSearchKeywords(surface !== 'sidebar')
  const keywordMatch = useMemo(
    () => suggestionsActive ? parseKeywordSearch(address, searchKeywordEngines) : null,
    [suggestionsActive, address, searchKeywordEngines]
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
  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.api.browser.siteIcons.onChange(({ origin, faviconUrl }) => {
      setCachedSiteIcons((current) => ({ ...current, [origin]: faviconUrl }))
    })
    void window.api.browser.siteIcons.get(siteIconOrigins).then((icons) => {
      if (!cancelled) setCachedSiteIcons((current) => ({ ...icons, ...current }))
    }).catch(() => undefined)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [siteIconOrigins])
  const isLocalNewTab = browser.url === SURFFISH_QUICK_LINKS_URL
  const hasInterstitial = browser.interstitial !== null
  const newTabBackground = newTabBackgrounds[newTabBackgroundIndex] ?? newTabBackgrounds[0]!
  // The New Tab page (clock, photos) is only on screen in the content surface, on a New Tab,
  // with no settings/downloads panel over it. Nothing behind it needs to tick otherwise.
  const newTabOnScreen = surface === 'content' && isLocalNewTab && !isSettingsSection(sidebarMode) && sidebarMode !== 'downloads'
  // Whether this surface's own sidebar is actually painted: the sidebar overlay while it is
  // revealed, the content surface only when it is the visible layer (New Tab or a full panel).
  // Tooltip hints only arrive while Diagnostics samples; the toolbar has no tab list.
  const tabUsage = useTabUsageHints(surface !== 'toolbar')
  const sidebarOnScreen = sidebarVisible && (surface === 'sidebar' || (surface === 'content' && (isLocalNewTab || (sidebarMode !== 'tabs' && sidebarMode !== 'history'))))
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
    if (!newTabOnScreen || (!newTabPreferences.showClock && newTabPreferences.worldClocks.length === 0)) return
    // Tick on the next second/minute boundary: one wakeup per displayed change, never more.
    const step = newTabPreferences.showSeconds ? 1_000 : 60_000
    let timer = 0
    const tick = (): void => {
      const now = new Date()
      setClockNow(now)
      timer = window.setTimeout(tick, step - (now.getTime() % step) + 15)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [newTabOnScreen, newTabPreferences.showClock, newTabPreferences.showSeconds, newTabPreferences.worldClocks.length])

  useEffect(() => {
    if (surface !== 'content' || !isLocalNewTab || !newTabPreferences.weatherEnabled || !newTabPreferences.weatherLocation.trim()) {
      setNewTabWeather(null)
      setNewTabWeatherError('')
      setNewTabWeatherLoading(false)
      return
    }
    let mounted = true
    setNewTabWeather(null)
    setNewTabWeatherError('')
    const refresh = (): void => {
      setNewTabWeatherLoading(true)
      void window.api.browser.newTabWeather.get(newTabPreferences.weatherLocation).then((weather) => {
        if (mounted) {
          setNewTabWeather(weather)
          setNewTabWeatherError('')
        }
      }).catch((error: unknown) => {
        if (mounted) setNewTabWeatherError(error instanceof Error ? error.message : String(error))
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
  }, [surface, isLocalNewTab, newTabPreferences.weatherEnabled, newTabPreferences.weatherLocation])

  const activeOrigin = httpOrigin(browser.url)

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

  function selectSettingsSection(mode: SettingsSectionMode): void {
    setSidebarMode(mode)
  }

  function exitSettings(): void {
    setSidebarMode('tabs')
  }

  /** The sidebar gear is a toggle: open General, or close settings from whichever section is showing. */
  function toggleSettings(): void {
    if (isSettingsSection(sidebarMode)) exitSettings()
    else selectSettingsSection('settings')
  }

  async function updateSiteSetting(key: Exclude<keyof BrowserSiteSettings, 'origin'>, value: boolean): Promise<void> {
    if (!siteSettings || !activeOrigin) return
    try {
      const updated = await window.api.browser.siteSettings.set(activeOrigin, { ...siteSettings, [key]: value })
      if (updated) setSiteSettings(updated)
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : String(error))
    }
  }

  // Keep main told where the Bramble button sits, so popups Bramble opens itself (autofill
  // "Vault locked", passkey "Unlock & Use") attach to it like a toolbar click does.
  const brambleButtonMounted = !!brambleButtonRef.current
  useEffect(() => {
    const button = brambleButtonRef.current
    const setAnchor = window.api.browser.bramble.setAnchor
    if (!button || typeof setAnchor !== 'function') return
    let frame = 0
    const report = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const bounds = button.getBoundingClientRect()
        setAnchor(bounds.width > 0 && bounds.height > 0
          ? { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
          : null)
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
        setSidebarMode('integrations')
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
      setNewTabPreferences(preferences.newTabPreferences)
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
    if (sidebarMode !== 'site') return
    let cancelled = false
    if (!activeOrigin) {
      setSiteSettings(null)
      setSiteSettingsLoading(false)
      return
    }
    setSiteSettings(null)
    setSiteSettingsLoading(true)
    void window.api.browser.siteSettings.get(activeOrigin).then((settings) => {
      if (!cancelled) setSiteSettings(settings)
    }).catch(() => {
      if (!cancelled) setSiteSettings(null)
    }).finally(() => {
      if (!cancelled) setSiteSettingsLoading(false)
    })
    return () => { cancelled = true }
  }, [sidebarMode, activeOrigin])

  useEffect(() => {
    if (sidebarMode === 'network' && !networkToolEnabled) setSidebarMode('settings')
  }, [sidebarMode, networkToolEnabled])

  useEffect(() => {
    const unsubscribe = window.api.browser.bramble.onChange(setBramblePoc)
    void window.api.browser.bramble.get().then(setBramblePoc)
    return unsubscribe
  }, [])

  useEffect(() => {
    if (surface === 'content' && searchEngineLoaded) void window.api.browser.setSearchEngine(searchEngine)
  }, [searchEngine, searchEngineLoaded, surface])

  useEffect(() => {
    if (!downloadsPopupOpen) return
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (!downloadsControlRef.current?.contains(event.target as Node)) setDownloadsPopupOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setDownloadsPopupOpen(false)
        downloadsButtonRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', closeOnOutsideClick)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [downloadsPopupOpen])

  useEffect(() => {
    if (surface === 'sidebar' || (!isSettingsSection(sidebarMode) && sidebarMode !== 'downloads' && sidebarMode !== 'bookmarks')) return
    const exitOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || downloadsPopupOpen || siteActionsOpen || extensionsMenuOpen) return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'SELECT') return
      exitSettings()
    }
    window.addEventListener('keydown', exitOnEscape)
    return () => window.removeEventListener('keydown', exitOnEscape)
  }, [surface, sidebarMode, downloadsPopupOpen, siteActionsOpen, extensionsMenuOpen])

  useEffect(() => {
    if (!siteActionsOpen) return
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (!siteActionsControlRef.current?.contains(event.target as Node)) setSiteActionsOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSiteActionsOpen(false)
        siteActionsButtonRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', closeOnOutsideClick)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [siteActionsOpen])

  useEffect(() => {
    const element = browserChromeRef.current
    if (!element) return
    const updateChromeHeight = (): void => {
      const toolbarHeight = element.getBoundingClientRect().height
      if (surface !== 'toolbar') return
      const overlayBottom = Array.from(element.querySelectorAll<HTMLElement>('.address-suggestions, #downloads-popup, #site-actions-menu, #extensions-menu, #find-bar, #command-palette, #bookmark-popover'))
        .reduce((bottom, popup) => Math.max(bottom, popup.getBoundingClientRect().bottom), toolbarHeight)
      void window.api.browser.chrome.reportMetrics({ toolbarHeight, toolbarExtent: Math.max(toolbarHeight, overlayBottom) }).catch(() => undefined)
    }
    const observer = new ResizeObserver(updateChromeHeight)
    observer.observe(element)
    // Popups fill in after they mount (downloads load async); re-measure as they grow so the
    // toolbar view isn't left too short and clips them against the page view.
    element.querySelectorAll<HTMLElement>('.address-suggestions, #downloads-popup, #site-actions-menu, #extensions-menu, #find-bar, #command-palette, #bookmark-popover').forEach((popup) => observer.observe(popup))
    window.addEventListener('resize', updateChromeHeight)
    updateChromeHeight()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateChromeHeight)
    }
  }, [downloadsPopupOpen, suggestionsOpen, addressSuggestions.length, keywordMatch !== null, siteActionsOpen, extensionsMenuOpen, findOpen, paletteOpen, bookmarkPopoverOpen, surface])

  useEffect(() => () => {
    if (sidebarHideTimerRef.current) clearTimeout(sidebarHideTimerRef.current)
  }, [])

  useLayoutEffect(() => {
    if (surface !== 'content') return
    const element = viewportRef.current
    if (!element) return
    const updateBounds = (): void => {
      const rect = element.getBoundingClientRect()
      const canShow = !isSettingsSection(sidebarMode) && sidebarMode !== 'downloads' && sidebarMode !== 'bookmarks' && !isLocalNewTab && !hasInterstitial && rect.width > 0 && rect.height > 0
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
  }, [surface, sidebarMode, isLocalNewTab, hasInterstitial])

  useEffect(() => {
    if (document.activeElement !== addressRef.current) setAddress(isLocalNewTab ? '' : browser.url)
  }, [browser.url, isLocalNewTab])

  async function navigateTo(valueInput: string): Promise<void> {
    const value = valueInput.trim()
    if (!value) return
    setSuggestionsOpen(false)
    setActiveSuggestionIndex(-1)
    setSidebarMode('tabs')
    // "Switch to open tabs" (Settings → Tab archive): main switches instead of loading a duplicate.
    if (await window.api.browser.tabArchive.switchToOpenTab(value, searchEngine).catch(() => false)) {
      setNavigationError('')
      addressRef.current?.blur()
      return
    }
    const ok = await window.api.browser.navigate(value, searchEngine)
    if (!ok) {
      setNavigationError('That address could not be opened. Use an HTTP(S) address or search terms.')
    } else {
      setNavigationError('')
      setProxyMessage('')
      const current = await window.api.browser.state()
      setBrowser(current)
      setAddress(current.url)
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
      // Like Chrome: Esc drops the dropdown and any half-typed text, leaving the real URL selected.
      setSuggestionsOpen(false)
      setActiveSuggestionIndex(-1)
      setAddress(isLocalNewTab ? '' : browser.url)
      const input = event.currentTarget
      window.requestAnimationFrame(() => input.select())
      return
    }
    if (addressSuggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveSuggestionIndex((index) => (index + 1) % addressSuggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveSuggestionIndex((index) => (index <= 0 ? addressSuggestions.length - 1 : index - 1))
    } else if (event.key === 'Enter' && activeSuggestionIndex >= 0) {
      const suggestion = addressSuggestions[activeSuggestionIndex]
      if (suggestion) {
        event.preventDefault()
        void navigateTo(suggestion.url)
      }
    }
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
        className={`browser-sidebar${activeSpace ? ' has-spaces' : ''}`}
        style={activeSpace ? { '--active-space-color': SPACE_COLOR_VALUES[activeSpace.color] } as React.CSSProperties : undefined}
        data-space-id={activeSpace?.id}
        aria-label="Browser sidebar"
        onMouseEnter={handleSidebarPointerEnter}
        onMouseLeave={handleSidebarPointerLeave}
        onFocusCapture={keepSidebarVisibleForFocus}
        onBlurCapture={releaseSidebarFocus}
      >
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
                onMoveBy={(offset) => tabDrag.moveBy(entry.key, offset)}
                titleFor={(tab) => withTabUsageHint(tab.sleeping ? `${tab.title} — sleeping; select to reload` : tab.title, tabUsage[tab.id])}
                onActivate={(id) => {
                  void window.api.browser.tabs.activate(id)
                  if (isSettingsSection(sidebarMode) || sidebarMode === 'downloads' || sidebarMode === 'bookmarks') exitSettings()
                }}
              />
            ) : (({ tab }) => (
              <div
                className={`tab-item${tab.active ? ' is-active' : ''}${tab.private ? ' is-private' : ''}${tab.sleeping ? ' is-sleeping' : ''}${tabDrag.draggingId === tab.id ? ' is-dragging' : ''}${tab.group ? ' is-grouped' : ''}`}
                style={tab.group ? { '--group-color': TAB_GROUP_COLOR_VALUES[tab.group.color] } as React.CSSProperties : undefined}
                key={tab.id}
                data-browser-tab-id={tab.id}
                role="tab"
                aria-selected={tab.active}
                aria-grabbed={tabDrag.draggingId === tab.id ? true : undefined}
                tabIndex={0}
                title={withTabUsageHint(tab.sleeping ? `${tab.title} — sleeping; select to reload` : tab.title, tabUsage[tab.id])}
                onClick={() => {
                  void window.api.browser.tabs.activate(tab.id)
                  if (isSettingsSection(sidebarMode) || sidebarMode === 'downloads' || sidebarMode === 'bookmarks') exitSettings()
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
                {tab.sleeping && <span className="tab-sleep-indicator" title="Sleeping tab" aria-label="Sleeping tab">☾</span>}
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
        {sidebarMode === 'tabs' && <BookmarksSidebar bookmarks={bookmarks} cachedIcons={cachedSiteIcons} onOpened={() => setSidebarMode('tabs')} onShowManager={() => setSidebarMode('bookmarks')} />}
        {sidebarMode === 'tabs' && <ArchivedTabsSidebar cachedIcons={cachedSiteIcons} onOpened={() => setSidebarMode('tabs')} />}

        {sidebarMode === 'tabs' && spaces?.enabled && <SpacesSwitcher snapshot={spaces} />}
        <div className="sidebar-footer">
          {sidebarMode === 'tabs' && (
            <button className={`sidebar-footer-icon-button sidebar-pin-button${sidebarPinned ? ' is-current' : ''}`} type="button" aria-label={sidebarPinned ? 'Auto-hide sidebar' : 'Keep sidebar open'} aria-pressed={sidebarPinned} title={sidebarPinned ? 'Auto-hide sidebar' : 'Keep sidebar open'} onClick={() => setSidebarPinned((pinned) => !pinned)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="3" /><path d="M9 5v14" />{sidebarPinned ? <path d="m15.5 10-2 2 2 2" /> : <path d="m13.5 10 2 2-2 2" />}</svg>
            </button>
          )}
          <UpdateBadge />
          <button className={`sidebar-footer-icon-button${SETTINGS_SECTIONS.some((section) => section.mode === sidebarMode) ? ' is-current' : ''}`} type="button" aria-label="Settings" aria-current={SETTINGS_SECTIONS.some((section) => section.mode === sidebarMode) ? 'page' : undefined} aria-pressed={isSettingsSection(sidebarMode)} title={isSettingsSection(sidebarMode) ? 'Close settings (Esc)' : 'Settings'} onClick={toggleSettings}>
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
              <div className="browser-nav-buttons">
                <button className="toolbar-button" type="button" aria-label="Back" title="Back" disabled={!browser.canGoBack} onClick={() => void window.api.browser.back()}>
                  <span aria-hidden="true">‹</span>
                </button>
                <button className="toolbar-button" type="button" aria-label="Forward" title="Forward" disabled={!browser.canGoForward} onClick={() => void window.api.browser.forward()}>
                  <span aria-hidden="true">›</span>
                </button>
                <button
                  className={`toolbar-button reload-button${browser.loading ? ' is-loading' : ''}`}
                  type="button"
                  aria-label={browser.loading ? 'Stop loading' : 'Reload page'}
                  title={browser.loading ? 'Stop' : 'Reload'}
                  onClick={() => void (browser.loading ? window.api.browser.stop() : window.api.browser.reload())}
                >
                  <span aria-hidden="true">{browser.loading ? '×' : '↻'}</span>
                </button>
              </div>
              <div className="omnibox">
                {browser.private && <span className="omnibox-private-pill" title="Private tab: nothing from this tab is saved"><PrivateGlyph /><span>Private</span></span>}
                {!isLocalNewTab && isInsecurePageUrl(browser.url) && <span className="omnibox-insecure-pill" title="Not secure: this page uses plain HTTP, so it can be read or changed on the way"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg><span>Not secure</span></span>}
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
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M3.8 12h16.4M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5Z" /></svg>
                  </button>
                  {siteActionsOpen && <div id="site-actions-menu" className="site-actions-menu" role="menu" aria-label="Site actions">
                    <button type="button" role="menuitem" disabled={!activeOrigin} onClick={() => {
                      setSiteActionsOpen(false)
                      selectSettingsSection('site')
                    }}>
                      <span className="site-actions-menu-icon" aria-hidden="true">⛨</span>
                      <span>Site settings</span>
                    </button>
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
                    setAddress(event.target.value)
                    setNavigationError('')
                    setSuggestionsOpen(true)
                    setActiveSuggestionIndex(-1)
                  }}
                  onMouseDown={(event) => {
                    // First click selects the whole URL (select() in onFocus alone gets undone by
                    // the mouseup that follows); later clicks place the caret as normal.
                    if (event.button !== 0 || document.activeElement === event.currentTarget) return
                    event.preventDefault()
                    event.currentTarget.focus()
                  }}
                  onFocus={(event) => {
                    event.currentTarget.select()
                    setSuggestionsOpen(true)
                    if (historyStaleRef.current) void refreshHistory()
                  }}
                  onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)}
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
                  url={isLocalNewTab ? '' : browser.url}
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
                      <span className="suggestion-main"><strong>{suggestion.title || suggestion.url}</strong><small>{suggestion.url}</small></span>
                      <span className="suggestion-source">{suggestion.source}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="browser-toolbar-trailing">
              {surface === 'toolbar' && <NetworkOverridesBadge enabled={networkToolEnabled} onOpen={() => selectSettingsSection('network')} />}
              <div className="omnibox-actions" role="group" aria-label="Browser panels">
                <button className={`omnibox-action-button${sidebarMode === 'history' ? ' is-current' : ''}`} type="button" aria-label="Browsing history" aria-pressed={sidebarMode === 'history'} title="Browsing history" onClick={() => toggleToolbarPanel('history')}>
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
                    setSidebarMode('integrations')
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3.5v11" /><path d="m7.5 10 4.5 4.5 4.5-4.5" /><path d="M5 16.5v3h14v-3" /></svg>
                </button>
                {downloadsPopupOpen && <DownloadsPanel mode="popup" onShowAll={() => {
                  setDownloadsPopupOpen(false)
                  setSidebarMode('downloads')
                }} onClose={() => {
                  setDownloadsPopupOpen(false)
                  downloadsButtonRef.current?.focus()
                }} />}
              </div>
              <div className="toolbar-brand" aria-label="Surffish" title="Surffish">
                <img className="toolbar-brand-icon" src="./surffish-brand-icon.png" alt="" aria-hidden="true" draggable={false} />
                <strong>Surffish</strong>
              </div>
            </div>
          </form>
          {surface === 'toolbar' && <FindBar onOpenChange={setFindOpen} />}
          {surface !== 'sidebar' && <ProxyDownBanner />}
          {surface !== 'sidebar' && <CommandPalette tabs={tabs} pinnedSites={pinnedSites} searchEngine={searchEngine} searchEngineLabel={SEARCH_ENGINES.find((engine) => engine.id === searchEngine)?.label ?? 'the web'} onOpenChange={setPaletteOpen} />}
          {((browser.error && !hasInterstitial) || navigationError) && (
            <p className="browser-error" role="status">
              {browser.error && !hasInterstitial ? `Page load issue: ${browser.error}. Check the tunnel or turn the proxy off.` : navigationError}
            </p>
          )}
        </header>
        <div className="browser-viewport" ref={viewportRef} aria-label={sidebarMode === 'settings' || sidebarMode === 'newtab' || sidebarMode === 'integrations' ? 'Settings content' : sidebarMode === 'downloads' ? 'Downloads content' : sidebarMode === 'bookmarks' ? 'Bookmark manager' : sidebarMode === 'network' ? 'Network inspector' : sidebarMode === 'diagnostics' ? 'Diagnostics' : sidebarMode === 'site' ? 'Site settings' : 'Web page area'}>
          {sidebarMode === 'tabs' && !sidebarVisible && <div className="sidebar-reveal-edge" aria-hidden="true" onMouseEnter={revealSidebar} onMouseMove={revealSidebar} onMouseLeave={scheduleSidebarHide} />}
          {isLocalNewTab && !SETTINGS_SECTIONS.some((section) => section.mode === sidebarMode) && sidebarMode !== 'downloads' && sidebarMode !== 'bookmarks' && (
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
                {(newTabPreferences.showClock || newTabPreferences.worldClocks.length > 0 || newTabPreferences.weatherEnabled) && (
                  <div className="new-tab-widgets" aria-label="Time and weather">
                    {newTabPreferences.showClock && (
                      <div className="new-tab-clock">
                        <time className="new-tab-clock-time" dateTime={clockNow.toISOString()}>{formatNewTabTime(clockNow, newTabPreferences.timeZone, newTabPreferences)}</time>
                        <span className="new-tab-clock-label">{newTabPreferences.timeZone === 'local' ? 'Local time' : newTabPreferences.timeZone.replaceAll('_', ' ')}</span>
                        {newTabPreferences.showDate && <time className="new-tab-clock-date" dateTime={clockNow.toISOString()}>{formatNewTabDate(clockNow, newTabPreferences.timeZone)}</time>}
                      </div>
                    )}
                    {newTabPreferences.worldClocks.map((clock) => (
                      <div className="new-tab-clock" key={clock.id}>
                        <time className="new-tab-clock-time" dateTime={clockNow.toISOString()}>{formatNewTabTime(clockNow, clock.timeZone, newTabPreferences)}</time>
                        <span className="new-tab-clock-label">{clock.label}</span>
                        {newTabPreferences.showDate && <time className="new-tab-clock-date" dateTime={clockNow.toISOString()}>{formatNewTabDate(clockNow, clock.timeZone)}</time>}
                      </div>
                    ))}
                    {newTabPreferences.weatherEnabled && newTabPreferences.weatherLocation.trim() && (
                      <div className="new-tab-weather-widget" role="status" aria-live="polite">
                        {newTabWeatherLoading && !newTabWeather ? <span>Loading weather…</span>
                          : newTabWeatherError ? <span>{newTabWeatherError}</span>
                            : newTabWeather ? <><strong>{Math.round(newTabPreferences.temperatureUnit === 'fahrenheit' ? newTabWeather.temperatureCelsius * 9 / 5 + 32 : newTabWeather.temperatureCelsius)}°{newTabPreferences.temperatureUnit === 'fahrenheit' ? 'F' : 'C'} · {newTabWeather.description}</strong><small>Open-Meteo · {newTabWeather.location}</small></>
                              : <span>Weather unavailable</span>}
                      </div>
                    )}
                  </div>
                )}
                {(browser.private ? favoriteSites.length > 0 : newTabSites.length > 0) ? (
                  <div className="new-tab-link-groups" style={{
                    '--new-tab-icon-size': `${newTabPreferences.iconSize}px`,
                    '--new-tab-links-per-row': newTabPreferences.linksPerRow,
                    '--new-tab-icon-offset': `${newTabPreferences.iconVerticalOffset}px`
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
                  </div>
                </footer>
              </div>
            </section>
          )}
          {SETTINGS_SECTIONS.some((section) => section.mode === sidebarMode) && (
            <nav className="settings-subnav" aria-label="Browser settings sections">
              {SETTINGS_SECTIONS.filter((section) => section.mode !== 'network' || networkToolEnabled).map((section) => (
                <button key={section.mode} type="button" className={sidebarMode === section.mode ? 'is-current' : ''} aria-current={sidebarMode === section.mode ? 'page' : undefined} onClick={() => selectSettingsSection(section.mode)}>{section.label}{section.mode === 'watchers' && unseenWatchers > 0 && <span className="settings-subnav-badge" aria-label={`${unseenWatchers} changed`}>{unseenWatchers}</span>}</button>
              ))}
              <button
                className="settings-subnav-close"
                type="button"
                aria-label="Close settings and return to web content"
                title="Close settings (Esc)"
                onClick={exitSettings}
              >
                <span>Close</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </nav>
          )}
          {surface === 'content' && browser.interstitial && !isLocalNewTab && !isSettingsSection(sidebarMode) && sidebarMode !== 'downloads' && <TabInterstitial interstitial={browser.interstitial} canGoBack={browser.canGoBack} />}
          {sidebarMode === 'downloads' && <DownloadsPanel mode="page" onClose={() => setSidebarMode('tabs')} />}
          {sidebarMode === 'privacy' && <PrivacySettings />}
          {sidebarMode === 'watchers' && <PageWatchersSettings />}
          {sidebarMode === 'bookmarks' && surface === 'content' && <BookmarksManager bookmarks={bookmarks} cachedIcons={cachedSiteIcons} onClose={() => setSidebarMode('tabs')} onOpened={() => setSidebarMode('tabs')} />}
          {(sidebarMode === 'settings' || sidebarMode === 'newtab' || sidebarMode === 'integrations') && (
            <div className={`settings-view settings-view-${sidebarMode}`}>
              <header className="settings-page-header">
                <div className="settings-page-heading-copy">
                  <h1>{sidebarMode === 'integrations' ? 'Extensions' : sidebarMode === 'newtab' ? 'New Tab' : 'General'}</h1>
                  <p>{sidebarMode === 'integrations' ? 'Bramble and Chrome Web Store extensions.' : sidebarMode === 'newtab' ? 'Layout, clocks, weather and background for new tabs.' : 'Search, default browser, tabs, privacy and connection.'}</p>
                </div>
              </header>
              <div className="settings-content">
                {sidebarMode === 'settings' && <>
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
                <SettingsGroup title="Tabs">
                  <SettingsRow label="Hibernate inactive tabs" hint="Audible tabs stay awake. Hibernated tabs reload their last page; unsaved form state is lost.">
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
                  <SettingsRow label="Saved session" hint="Tabs restore on next launch. Tokens, codes and other credential-like URL parts are stripped before saving.">
                    <button className="settings-action secondary" type="button" aria-label="Clear saved session" onClick={() => void clearSavedSession()}>Clear</button>
                  </SettingsRow>
                  {sessionMessage && <p className="settings-message" role="status">{sessionMessage}</p>}
                </SettingsGroup>
                <TabArchiveSettings />
                <SpacesSettings />
                <SpellcheckSettings />
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
                  <ProxyKillSwitchSetting />
                  <div className="settings-actions">
                    <p className="settings-help">Start a tunnel first: <code>ssh -N -D 127.0.0.1:1080 user@host</code></p>
                    <button className="settings-action secondary" type="button" disabled={busy} onClick={() => void testProxy()}>Test port</button>
                    <button className="settings-action primary" type="button" disabled={busy} onClick={() => void saveProxy()}>{busy ? 'Working…' : 'Save'}</button>
                  </div>
                  {(proxyMessage || browser.error) && <p className={`settings-message${proxyMessageIsError || browser.error ? ' is-error' : ''}`} role="status">{browser.error ? `Page load issue: ${browser.error}. Check the tunnel or turn the proxy off.` : proxyMessage}</p>}
                </SettingsGroup>
                <NetworkRulesSettings />
                <SettingsGroup title="Developer">
                  <SettingsRow label="Network inspector" hint="Adds a Network tab that records requests from every tab. Off saves CPU and memory; turning it off also stops capture and clears recorded requests.">
                    <input type="checkbox" className="settings-switch" checked={networkToolEnabled} onChange={(event) => setNetworkToolEnabled(event.target.checked)} aria-label="Enable network inspector" />
                  </SettingsRow>
                </SettingsGroup>
                <UpdateSettings />
                <p className="settings-footnote">Browser data stays in this profile. Session-only sign-in cookies are saved with OS-backed encryption when available.</p>
                </>}
                {sidebarMode === 'newtab' && <>
                <SettingsGroup title="Page">
                  <SettingsRow label="New tab opens" hint="Applies to tabs opened from now on.">
                    <select className="settings-select" value={newTabPage} onChange={(event) => {
                      const page = event.target.value as NewTabPageId
                      void window.api.browser.newTabPage.set(page).then((saved) => { if (saved) setNewTabPage(saved) })
                    }} aria-label="Default new tab page">
                      <option value="quick-links">Surffish New Tab</option>
                      <option value="bonjourr">Bonjourr (online)</option>
                      <option value="search">Search engine</option>
                    </select>
                  </SettingsRow>
                  {newTabPage === 'quick-links' && <p className="settings-help">Favorites reuse pinned sites, frequent sites come from local history, and site icons and Wikimedia Commons photos are cached locally. No browsing data is sent.</p>}
                </SettingsGroup>
                <SettingsGroup title="Layout">
                  <SettingsRow label="Show site names"><input type="checkbox" className="settings-switch" checked={newTabPreferences.showLinkLabels} onChange={(event) => patchNewTabPreferences({ showLinkLabels: event.target.checked })} aria-label="Show site names under icons" /></SettingsRow>
                  <SettingsSlider label="Icon size" value={newTabPreferences.iconSize} unit="px" min={20} max={52} onChange={(iconSize) => patchNewTabPreferences({ iconSize })} />
                  <SettingsSlider label="Links per row" value={newTabPreferences.linksPerRow} min={3} max={12} onChange={(linksPerRow) => patchNewTabPreferences({ linksPerRow })} />
                  <SettingsSlider label="Vertical position" value={newTabPreferences.iconVerticalOffset} unit="px" min={0} max={480} step={10} onChange={(iconVerticalOffset) => patchNewTabPreferences({ iconVerticalOffset })} />
                </SettingsGroup>
                <SettingsGroup title="Background">
                  <SettingsSlider label="Dim" value={newTabPreferences.backgroundDim} unit="%" min={0} max={70} onChange={(backgroundDim) => patchNewTabPreferences({ backgroundDim })} />
                  <SettingsSlider label="Blur" value={newTabPreferences.backgroundBlur} unit="px" min={0} max={12} onChange={(backgroundBlur) => patchNewTabPreferences({ backgroundBlur })} />
                </SettingsGroup>
                <SettingsGroup title="Clock">
                  <SettingsRow label="Show clock"><input type="checkbox" className="settings-switch" checked={newTabPreferences.showClock} onChange={(event) => patchNewTabPreferences({ showClock: event.target.checked })} aria-label="Show local clock" /></SettingsRow>
                  <SettingsRow label="Show date"><input type="checkbox" className="settings-switch" checked={newTabPreferences.showDate} onChange={(event) => patchNewTabPreferences({ showDate: event.target.checked })} aria-label="Show date" /></SettingsRow>
                  <SettingsRow label="24-hour time"><input type="checkbox" className="settings-switch" checked={newTabPreferences.use24HourTime} onChange={(event) => patchNewTabPreferences({ use24HourTime: event.target.checked })} aria-label="Use 24-hour time" /></SettingsRow>
                  <SettingsRow label="Show seconds"><input type="checkbox" className="settings-switch" checked={newTabPreferences.showSeconds} onChange={(event) => patchNewTabPreferences({ showSeconds: event.target.checked })} aria-label="Show seconds" /></SettingsRow>
                  <SettingsRow label="Time zone">
                    <select className="settings-select" value={newTabPreferences.timeZone} onChange={(event) => patchNewTabPreferences({ timeZone: event.target.value })} aria-label="Primary New Tab time zone">
                      <option value="local">Automatic · device time</option>
                      {Array.from(new Set([...TIME_ZONE_OPTIONS, ...(newTabPreferences.timeZone === 'local' ? [] : [newTabPreferences.timeZone])])).map((zone) => <option key={zone} value={zone}>{timeZoneOptionLabel(zone)}</option>)}
                    </select>
                  </SettingsRow>
                </SettingsGroup>
                <SettingsGroup
                  title="World clocks"
                  status={`${newTabPreferences.worldClocks.length} of ${MAX_WORLD_CLOCKS}`}
                  aside={<button className="settings-action secondary" type="button" disabled={newTabPreferences.worldClocks.length >= MAX_WORLD_CLOCKS} onClick={() => {
                    const usedTimeZones = new Set([
                      Intl.DateTimeFormat().resolvedOptions().timeZone,
                      ...(newTabPreferences.timeZone === 'local' ? [] : [newTabPreferences.timeZone]),
                      ...newTabPreferences.worldClocks.map((item) => item.timeZone)
                    ])
                    const timeZone = TIME_ZONE_OPTIONS.find((zone) => !usedTimeZones.has(zone)) ?? 'UTC'
                    const clock: WorldClockPreference = { id: `${Date.now()}-${Math.floor(Math.random() * 10_000)}`, label: timeZoneCityName(timeZone), timeZone }
                    patchNewTabPreferences({ worldClocks: [...newTabPreferences.worldClocks, clock] })
                  }}>+ Add clock</button>}
                >
                  {newTabPreferences.worldClocks.length === 0 && <p className="settings-help">No world clocks yet.</p>}
                  {newTabPreferences.worldClocks.map((clock, index) => (
                    <div className="new-tab-world-clock-editor" key={clock.id}>
                      <input type="text" maxLength={40} value={clock.label} aria-label={`World clock ${index + 1} city name`} onChange={(event) => patchNewTabPreferences({ worldClocks: newTabPreferences.worldClocks.map((item) => item.id === clock.id ? { ...item, label: event.target.value } : item) })} />
                      <TimeZonePicker
                        value={clock.timeZone}
                        label={clock.label}
                        ariaLabel={`World clock ${index + 1} city or time zone`}
                        onSelect={(result) => patchNewTabPreferences({
                          worldClocks: newTabPreferences.worldClocks.map((item) => {
                            if (item.id !== clock.id) return item
                            const autoLabels = new Set([timeZoneCityName(item.timeZone), ...WORLD_CITIES.filter((city) => city.timeZone === item.timeZone).map((city) => city.city)])
                            const keepLabel = item.label.trim() !== '' && !autoLabels.has(item.label.trim())
                            return { ...item, timeZone: result.timeZone, label: keepLabel ? item.label : result.city.slice(0, 40) }
                          })
                        })}
                      />
                      <button className="settings-icon-action" type="button" aria-label={`Remove ${clock.label} world clock`} title="Remove" onClick={() => patchNewTabPreferences({ worldClocks: newTabPreferences.worldClocks.filter((item) => item.id !== clock.id) })}>×</button>
                    </div>
                  ))}
                </SettingsGroup>
                <SettingsGroup
                  title="Weather"
                  status="Only the city name is sent to Open-Meteo"
                  aside={<input type="checkbox" className="settings-switch" checked={newTabPreferences.weatherEnabled} onChange={(event) => patchNewTabPreferences({ weatherEnabled: event.target.checked })} aria-label="Show weather" />}
                >
                  <SettingsRow label="City or town"><input type="text" className="settings-input" maxLength={100} value={newTabPreferences.weatherLocation} placeholder="e.g. Melbourne" disabled={!newTabPreferences.weatherEnabled} onChange={(event) => patchNewTabPreferences({ weatherLocation: event.target.value })} aria-label="Weather city or town" /></SettingsRow>
                  <SettingsRow label="Units">
                    <div className="settings-segmented" role="radiogroup" aria-label="Weather temperature unit">
                      {(['celsius', 'fahrenheit'] as const).map((unit) => (
                        <button key={unit} type="button" role="radio" aria-checked={newTabPreferences.temperatureUnit === unit} className={newTabPreferences.temperatureUnit === unit ? 'is-selected' : ''} disabled={!newTabPreferences.weatherEnabled} onClick={() => patchNewTabPreferences({ temperatureUnit: unit })}>{unit === 'celsius' ? '°C' : '°F'}</button>
                      ))}
                    </div>
                  </SettingsRow>
                </SettingsGroup>
                </>}
                {sidebarMode === 'integrations' && <>
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
                <ExtensionsSettings state={webStoreExtensions} setState={setWebStoreExtensions} />
                </>}
              </div>
            </div>
          )}
          {sidebarMode === 'site' && (
            <div className="settings-view site-settings-view">
              <header className="settings-page-header">
                <h1>{activeOrigin ? new URL(activeOrigin).hostname : 'Site settings'}</h1>
                <p>{activeOrigin ? `Privacy and permissions for ${activeOrigin}` : 'Site controls are available on HTTP or HTTPS pages.'}</p>
              </header>
              <div className="settings-content">
                {siteSettingsLoading ? <section className="settings-section"><p className="settings-help">Loading this site’s controls…</p></section> : siteSettings ? (
                  <>
                    <section className="settings-section">
                      <div className="settings-section-heading"><div><strong>Privacy</strong><span className="settings-status is-on">Applies to this origin only</span></div></div>
                      <label className="site-setting-row">
                        <span><strong>Block ads and trackers</strong><small>Uses the browser’s network filter for future requests on this site.</small></span>
                        <input type="checkbox" className="settings-switch" checked={siteSettings.blockAds} onChange={(event) => void updateSiteSetting('blockAds', event.target.checked)} aria-label="Block ads and trackers on this site" />
                      </label>
                      <label className="site-setting-row">
                        <span><strong>Open pop-ups in tabs</strong><small>Routes pop-up windows from this site into a regular browser tab.</small></span>
                        <input type="checkbox" className="settings-switch" checked={siteSettings.openPopupsInTabs} onChange={(event) => void updateSiteSetting('openPopupsInTabs', event.target.checked)} aria-label="Open this site’s pop-ups in tabs" />
                      </label>
                    </section>
                    <section className="settings-section">
                      <div className="settings-section-heading"><div><strong>Permissions</strong><span className="settings-status">Denied unless allowed below</span></div></div>
                      <label className="site-setting-row">
                        <span><strong>Camera and microphone</strong><small>Allows media access requests for this origin; the operating system may still require approval.</small></span>
                        <input type="checkbox" className="settings-switch" checked={siteSettings.allowMedia} onChange={(event) => void updateSiteSetting('allowMedia', event.target.checked)} aria-label="Allow camera and microphone on this site" />
                      </label>
                      <label className="site-setting-row">
                        <span><strong>Location</strong><small>Allows location requests for this origin.</small></span>
                        <input type="checkbox" className="settings-switch" checked={siteSettings.allowGeolocation} onChange={(event) => void updateSiteSetting('allowGeolocation', event.target.checked)} aria-label="Allow location on this site" />
                      </label>
                      <label className="site-setting-row">
                        <span><strong>Notifications</strong><small>Allows notification requests for this origin.</small></span>
                        <input type="checkbox" className="settings-switch" checked={siteSettings.allowNotifications} onChange={(event) => void updateSiteSetting('allowNotifications', event.target.checked)} aria-label="Allow notifications on this site" />
                      </label>
                      <label className="site-setting-row">
                        <span><strong>Read clipboard</strong><small>Lets this site read what you’ve copied (paste buttons). Copying to the clipboard is always allowed.</small></span>
                        <input type="checkbox" className="settings-switch" checked={siteSettings.allowClipboardRead} onChange={(event) => void updateSiteSetting('allowClipboardRead', event.target.checked)} aria-label="Allow this site to read the clipboard" />
                      </label>
                      <p className="settings-help">Copying, fullscreen and pointer lock work everywhere, like Chrome. All other web permissions stay denied, and you'll see a short notice when a site is blocked. Turning a permission on does not bypass macOS or Windows privacy prompts.</p>
                    </section>
                    {activeOrigin && <SiteRouteSettings url={browser.url} />}
                    {activeOrigin && <SiteDataSettings origin={activeOrigin} onForgotten={() => {
                      void window.api.browser.siteSettings.get(activeOrigin).then(setSiteSettings).catch(() => undefined)
                    }} />}
                    <div className="settings-actions"><button className="settings-action primary" type="button" onClick={() => void window.api.browser.reload()}>Reload page to apply</button></div>
                  </>
                ) : <section className="settings-section"><p className="settings-help">Select an HTTP or HTTPS page to manage its privacy controls.</p></section>}
              </div>
            </div>
          )}
          {sidebarMode === 'network' && networkToolEnabled && <NetworkView tabs={tabs} live={surface === 'content'} />}
          {sidebarMode === 'diagnostics' && <DiagnosticsView live={surface === 'content'} />}
        </div>
      </div>
    </section>
  )
}
