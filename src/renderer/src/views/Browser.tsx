import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
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
  NetworkRequestDetails,
  NetworkRequestSummary,
  NetworkResponseBody,
  PinnedSite,
  SearchEngineId,
  TabSleepMinutes,
  WorldClockPreference
} from '../../../shared/types'
import { DEFAULT_SEARCH_ENGINE, getSearchHomepage, SEARCH_ENGINES, SURFFISH_QUICK_LINKS_URL } from '../../../shared/navigation'
import { DEFAULT_NEW_TAB_PREFERENCES, DEFAULT_SIDEBAR_WIDTH, MAX_PINNED_SITES, MAX_SIDEBAR_WIDTH, MAX_WORLD_CLOCKS, MIN_SIDEBAR_WIDTH, normalizeSidebarWidth } from '../../../shared/persistence'
import { buildAddressSuggestions } from '../../../shared/autocomplete'
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
import { useTabDragSort } from './useTabDragSort'
import TimeZonePicker from './TimeZonePicker'
import { WORLD_CITIES } from '../../../shared/world-cities'
import './Browser.css'

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
  error: null
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
type NetworkDetailsTab = 'headers' | 'payload' | 'response' | 'timing'
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
  return mode === 'settings' || mode === 'integrations' || mode === 'site' || mode === 'network'
}

const SETTINGS_SECTIONS: ReadonlyArray<{ mode: Extract<SidebarMode, 'settings' | 'integrations' | 'site' | 'network'>; label: string }> = [
  { mode: 'settings', label: 'General' },
  { mode: 'integrations', label: 'Integrations' },
  { mode: 'site', label: 'This site' },
  { mode: 'network', label: 'Network' }
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

function formatVisitedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
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

function formatNetworkTime(durationMs: number | null): string {
  if (durationMs === null) return '—'
  if (durationMs < 1) return '<1 ms'
  return `${Math.round(durationMs)} ms`
}

function formatNetworkSize(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function networkRequestName(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

function networkStatusLabel(request: NetworkRequestSummary): string {
  if (request.state === 'pending') return 'Pending'
  if (request.status !== null) return `${request.status}${request.statusText ? ` ${request.statusText}` : ''}`
  return request.state === 'failed' ? 'Failed' : '—'
}

function networkTimingLabel(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').replace(/^./, (first) => first.toUpperCase())
}

function networkTimingValue(value: number): string {
  return value < 0 ? '—' : `${value.toFixed(2)} ms`
}

function responseBodyText(body: NetworkResponseBody): string {
  if (!body.base64Encoded) return body.text
  try {
    const binary = atob(body.text)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return body.text
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

function TabFavicon({ tab }: { tab: BrowserTabSummary }): React.JSX.Element {
  const [iconFailed, setIconFailed] = useState(false)
  useEffect(() => setIconFailed(false), [tab.faviconUrl])
  return (
    <span className={`tab-favicon${tab.loading ? ' is-loading' : ''}`} aria-hidden="true">
      {tab.loading ? '' : tab.faviconUrl && !iconFailed
        ? <img src={tab.faviconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setIconFailed(true)} />
        : tab.title.slice(0, 1).toUpperCase()}
    </span>
  )
}

function PinnedTabIcon({ tab }: { tab: BrowserTabSummary }): React.JSX.Element {
  return (
    <button
      className={`pinned-tab-icon-button${tab.active ? ' is-active' : ''}`}
      type="button"
      data-browser-tab-id={tab.id}
      aria-label={`Open pinned tab ${tab.title}`}
      title={`${tab.title}${tab.sleeping ? ' · sleeping' : ''}`}
      onClick={() => { void window.api.browser.tabs.activate(tab.id) }}
    >
      <TabFavicon tab={tab} />
      {tab.sleeping && <span className="pinned-tab-sleep-indicator" aria-hidden="true">☾</span>}
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

export default function Browser({ surface }: { surface: BrowserSurface }): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const browserChromeRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
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
  const unpinnedTabIds = useMemo(() => tabs.filter((tab) => !tab.pinned).map((tab) => tab.id), [tabs])
  const tabDrag = useTabDragSort(unpinnedTabIds, (id, beforeId) => { void window.api.browser.tabs.move(id, beforeId) })
  const tabsById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs])
  const [bramblePoc, setBramblePoc] = useState<BrambleExtensionState>(EMPTY_BRAMBLE_POC)
  const [history, setHistory] = useState<BrowsingHistoryEntry[]>([])
  const [pinnedSites, setPinnedSites] = useState<PinnedSite[]>([])
  const [cachedSiteIcons, setCachedSiteIcons] = useState<Record<string, string>>({})
  const [chromeState, setChromeState] = useState<BrowserChromeState>(DEFAULT_CHROME_STATE)
  const { sidebarMode, sidebarPinned, sidebarHovered, sidebarFocused, sidebarWidth, sidebarResizing } = chromeState
  const [browserChromeHeight, setBrowserChromeHeight] = useState(window.api.platform === 'darwin' ? 50 : 45)
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
  const [proxy, setProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [appliedProxy, setAppliedProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [siteSettings, setSiteSettings] = useState<BrowserSiteSettings | null>(null)
  const [siteSettingsLoading, setSiteSettingsLoading] = useState(false)
  const [networkRequests, setNetworkRequests] = useState<NetworkRequestSummary[]>([])
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(null)
  const [networkDetails, setNetworkDetails] = useState<NetworkRequestDetails | null>(null)
  const [networkDetailsTab, setNetworkDetailsTab] = useState<NetworkDetailsTab>('headers')
  const [networkQuery, setNetworkQuery] = useState('')
  const [networkTypeFilter, setNetworkTypeFilter] = useState('all')
  const [networkScope, setNetworkScope] = useState<'all' | 'active'>('all')
  const [networkResponseBody, setNetworkResponseBody] = useState<NetworkResponseBody | null>(null)
  const [networkResponseError, setNetworkResponseError] = useState('')
  const [networkBodyLoading, setNetworkBodyLoading] = useState(false)
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

  useEffect(() => {
    if (surface !== 'content') return
    const rotationTimer = window.setInterval(() => {
      setNewTabBackgroundIndex((index) => nextQuickLinkBackgroundIndex(index, FALLBACK_NEW_TAB_BACKGROUNDS.length))
    }, QUICK_LINK_BACKGROUND_ROTATION_MS)
    return () => window.clearInterval(rotationTimer)
  }, [surface])
  const sidebarVisible = sidebarPinned || sidebarHovered || sidebarFocused || sidebarMode !== 'tabs'
  const addressSuggestions = useMemo(
    () => buildAddressSuggestions(address, pinnedSites, tabs, history),
    [address, pinnedSites, tabs, history]
  )
  const favoriteSites = useMemo(() => pinnedSites.map(toQuickLinkSite).filter((site): site is QuickLinkSite => site !== null), [pinnedSites])
  const frequentlyVisitedSites = useMemo(() => buildFrequentSites(history, pinnedSites), [history, pinnedSites])
  const newTabSites = useMemo(() => [...favoriteSites, ...frequentlyVisitedSites], [favoriteSites, frequentlyVisitedSites])
  const siteIconOrigins = useMemo(
    () => [...new Set(newTabSites.map((site) => site.origin))].slice(0, 128),
    [newTabSites]
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
  const newTabBackground = newTabBackgrounds[newTabBackgroundIndex] ?? newTabBackgrounds[0]!
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
    if (surface !== 'content' || !isLocalNewTab || (!newTabPreferences.showClock && newTabPreferences.worldClocks.length === 0)) return
    setClockNow(new Date())
    const timer = window.setInterval(() => setClockNow(new Date()), newTabPreferences.showSeconds ? 1_000 : 30_000)
    return () => window.clearInterval(timer)
  }, [surface, isLocalNewTab, newTabPreferences.showClock, newTabPreferences.showSeconds, newTabPreferences.worldClocks.length])

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
  const currentOriginIsBookmarked = Boolean(activeOrigin && pinnedSites.some((site) => httpOrigin(site.url) === activeOrigin))

  function revealSidebar(): void {
    if (sidebarHideTimerRef.current) clearTimeout(sidebarHideTimerRef.current)
    sidebarHideTimerRef.current = null
    setSidebarHovered(true)
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
    scheduleSidebarHide()
  }

  async function refreshHistory(): Promise<void> {
    setHistory(await window.api.browser.history.get())
  }

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
      setPinnedSites(await window.api.browser.pinnedSites.set(next))
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : String(error))
    }
  }

  async function toggleCurrentSiteBookmark(): Promise<void> {
    if (!activeOrigin) return
    const bookmarked = pinnedSites.some((site) => httpOrigin(site.url) === activeOrigin)
    if (!bookmarked && pinnedSites.length >= MAX_PINNED_SITES) {
      setNavigationError(`You can save up to ${MAX_PINNED_SITES} favorite sites. Remove one from the sidebar first.`)
      return
    }
    const title = browser.title.trim().slice(0, 80) || new URL(activeOrigin).hostname
    const faviconUrl = tabs.find((tab) => httpOrigin(tab.url) === activeOrigin)?.faviconUrl
    const next = bookmarked
      ? pinnedSites.filter((site) => httpOrigin(site.url) !== activeOrigin)
      : [...pinnedSites, { title, url: activeOrigin, ...(faviconUrl ? { faviconUrl } : {}) }]
    await savePinnedSites(next)
  }

  async function openPinnedSite(site: PinnedSite): Promise<void> {
    setSidebarMode('tabs')
    setSuggestionsOpen(false)
    await window.api.browser.navigate(site.url, searchEngine)
  }

  function selectSettingsSection(mode: Extract<SidebarMode, 'settings' | 'integrations' | 'site' | 'network'>): void {
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
    const unsubscribeHistory = window.api.browser.history.onChange(() => { void refreshHistory() })
    const applyPreferences = (preferences: BrowserPreferencesSnapshot): void => {
      setSearchEngine(preferences.searchEngine)
      setSearchEngineLoaded(true)
      setNewTabPage(preferences.newTabPage)
      setNewTabPreferences(preferences.newTabPreferences)
      setPinnedSites(preferences.pinnedSites)
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
    void refreshHistory()
    void window.api.browser.proxy.get().then((settings) => {
      setProxy(settings)
      setAppliedProxy(settings)
    })
    return () => {
      unsubscribeState()
      unsubscribeTabs()
      unsubscribeHistory()
      unsubscribePreferences()
      unsubscribeFocusAddress()
    }
  }, [surface])

  useEffect(() => {
    if (sidebarMode !== 'site' && sidebarMode !== 'integrations') return
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
    const unsubscribeNetwork = window.api.browser.network.onChange(setNetworkRequests)
    void window.api.browser.network.get().then(setNetworkRequests)
    return unsubscribeNetwork
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.browser.bramble.onChange(setBramblePoc)
    void window.api.browser.bramble.get().then(setBramblePoc)
    return unsubscribe
  }, [])

  const selectedNetworkSummary = networkRequests.find((request) => request.id === selectedNetworkId) ?? null

  useEffect(() => {
    if (!selectedNetworkId) {
      setNetworkDetails(null)
      return
    }
    let cancelled = false
    void window.api.browser.network.details(selectedNetworkId).then((details) => {
      if (!cancelled) setNetworkDetails(details)
    }).catch(() => {
      if (!cancelled) setNetworkDetails(null)
    })
    return () => { cancelled = true }
  }, [selectedNetworkId, selectedNetworkSummary?.state, selectedNetworkSummary?.status])

  useEffect(() => {
    if (networkDetailsTab !== 'response' || !selectedNetworkId) {
      setNetworkBodyLoading(false)
      return
    }
    if (!selectedNetworkSummary?.responseBodyAvailable) {
      setNetworkBodyLoading(false)
      setNetworkResponseBody(null)
      setNetworkResponseError(selectedNetworkSummary?.state === 'pending' ? 'The response is not available until this request completes.' : 'No response body is available for this request.')
      return
    }
    let cancelled = false
    setNetworkBodyLoading(true)
    setNetworkResponseError('')
    void window.api.browser.network.responseBody(selectedNetworkId).then((result) => {
      if (cancelled) return
      setNetworkResponseBody(result.body)
      setNetworkResponseError(result.error ?? '')
    }).catch((error: unknown) => {
      if (!cancelled) setNetworkResponseError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (!cancelled) setNetworkBodyLoading(false)
    })
    return () => { cancelled = true }
  }, [networkDetailsTab, selectedNetworkId, selectedNetworkSummary?.responseBodyAvailable, selectedNetworkSummary?.state])

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
    if (surface === 'sidebar' || !isSettingsSection(sidebarMode)) return
    const exitOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || downloadsPopupOpen || siteActionsOpen) return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'SELECT') return
      exitSettings()
    }
    window.addEventListener('keydown', exitOnEscape)
    return () => window.removeEventListener('keydown', exitOnEscape)
  }, [surface, sidebarMode, downloadsPopupOpen, siteActionsOpen])

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
      setBrowserChromeHeight(toolbarHeight)
      if (surface !== 'toolbar') return
      const overlayBottom = Array.from(element.querySelectorAll<HTMLElement>('.address-suggestions, #downloads-popup, #site-actions-menu'))
        .reduce((bottom, popup) => Math.max(bottom, popup.getBoundingClientRect().bottom), toolbarHeight)
      void window.api.browser.chrome.reportMetrics({ toolbarHeight, toolbarExtent: Math.max(toolbarHeight, overlayBottom) }).catch(() => undefined)
    }
    const observer = new ResizeObserver(updateChromeHeight)
    observer.observe(element)
    window.addEventListener('resize', updateChromeHeight)
    updateChromeHeight()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateChromeHeight)
    }
  }, [downloadsPopupOpen, suggestionsOpen, addressSuggestions.length, siteActionsOpen, surface])

  useEffect(() => () => {
    if (sidebarHideTimerRef.current) clearTimeout(sidebarHideTimerRef.current)
  }, [])

  useLayoutEffect(() => {
    if (surface !== 'content') return
    const element = viewportRef.current
    if (!element) return
    const updateBounds = (): void => {
      const rect = element.getBoundingClientRect()
      const canShow = sidebarMode !== 'settings' && sidebarMode !== 'network' && sidebarMode !== 'site' && sidebarMode !== 'downloads' && !isLocalNewTab && rect.width > 0 && rect.height > 0
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
  }, [surface, sidebarMode, isLocalNewTab])

  useEffect(() => {
    if (document.activeElement !== addressRef.current) setAddress(isLocalNewTab ? '' : browser.url)
  }, [browser.url, isLocalNewTab])

  async function navigateTo(valueInput: string): Promise<void> {
    const value = valueInput.trim()
    if (!value) return
    setSuggestionsOpen(false)
    setActiveSuggestionIndex(-1)
    setSidebarMode('tabs')
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
      setSuggestionsOpen(false)
      setActiveSuggestionIndex(-1)
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
    <section className={`browser-layout${sidebarVisible ? ' is-sidebar-visible' : ''}${sidebarResizing ? ' is-sidebar-resizing' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties} aria-label="Surffish browser" onMouseMove={(event) => {
      if (!sidebarVisible && event.clientX <= 18) revealSidebar()
    }} onMouseLeave={surface === 'sidebar' ? scheduleSidebarHide : undefined}>
      <aside
        ref={sidebarRef}
        className="browser-sidebar"
        aria-label="Browser sidebar"
        onMouseEnter={revealSidebar}
        onMouseLeave={scheduleSidebarHide}
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
          <strong>{sidebarMode === 'history' ? 'History' : sidebarMode === 'downloads' ? 'Downloads' : sidebarMode === 'network' ? 'Network' : 'This site'}</strong>
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
              {filteredHistory.map((entry) => (
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
            {tabDrag.orderedIds.map((id) => tabsById.get(id)).filter((tab): tab is BrowserTabSummary => Boolean(tab)).map((tab) => (
              <div
                className={`tab-item${tab.active ? ' is-active' : ''}${tab.sleeping ? ' is-sleeping' : ''}${tabDrag.draggingId === tab.id ? ' is-dragging' : ''}`}
                key={tab.id}
                data-browser-tab-id={tab.id}
                role="tab"
                aria-selected={tab.active}
                aria-grabbed={tabDrag.draggingId === tab.id ? true : undefined}
                tabIndex={0}
                title={tab.sleeping ? `${tab.title} — sleeping; select to reload` : tab.title}
                onClick={() => {
                  void window.api.browser.tabs.activate(tab.id)
                  if (isSettingsSection(sidebarMode)) exitSettings()
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
                <TabFavicon tab={tab} />
                <span className="tab-title">{tab.title}</span>
                {tab.sleeping && <span className="tab-sleep-indicator" title="Sleeping tab" aria-label="Sleeping tab">☾</span>}
                <button
                  className="tab-close"
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  title="Close tab"
                  onClick={(event) => { event.stopPropagation(); void window.api.browser.tabs.close(tab.id) }}
                >×</button>
              </div>
            ))}
            {tabs.length === 0 && <p className="sidebar-empty">No open tabs</p>}
            <button className="sidebar-new-tab-row" type="button" aria-label="New tab" title="New tab (Ctrl/⌘+T)" onClick={createNewTab}>
              <span className="sidebar-new-tab-row-icon" aria-hidden="true">＋</span>
              <span className="sidebar-new-tab-row-label">New Tab</span>
            </button>
          </div>
        )}

        <div className="sidebar-footer">
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
          <form className="browser-toolbar" onSubmit={(event) => void navigate(event)}>
            <div className="browser-toolbar-leading">
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
            </div>
            <div className="omnibox-wrap">
              <div className="omnibox">
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
                  onFocus={(event) => {
                    event.currentTarget.select()
                    setSuggestionsOpen(true)
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
                <button
                  className={`toolbar-button favorite-button omnibox-favorite-button${currentOriginIsBookmarked ? ' is-favorite' : ''}`}
                  type="button"
                  aria-label={currentOriginIsBookmarked ? 'Remove bookmark' : 'Bookmark this site'}
                  aria-pressed={currentOriginIsBookmarked}
                  title={currentOriginIsBookmarked ? 'Remove bookmark' : 'Bookmark this site'}
                  disabled={!activeOrigin}
                  onClick={() => void toggleCurrentSiteBookmark()}
                ><span aria-hidden="true">{currentOriginIsBookmarked ? '★' : '☆'}</span></button>
              </div>
              {suggestionsOpen && addressSuggestions.length > 0 && (
                <div id="address-suggestions" className="address-suggestions" role="listbox" aria-label="Local address suggestions">
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
                      <span className="suggestion-mark" aria-hidden="true">{suggestion.source === 'Pinned site' ? '★' : suggestion.source === 'Open tab' ? '▤' : '◷'}</span>
                      <span className="suggestion-main"><strong>{suggestion.title || suggestion.url}</strong><small>{suggestion.url}</small></span>
                      <span className="suggestion-source">{suggestion.source}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="browser-toolbar-trailing">
              <div className="omnibox-actions" role="group" aria-label="Browser panels">
                <button className={`omnibox-action-button tabs-sidebar-button${sidebarMode === 'tabs' && sidebarPinned ? ' is-current' : ''}`} type="button" aria-label={sidebarMode === 'tabs' && sidebarPinned ? 'Auto-hide sidebar' : 'Pin sidebar open'} aria-pressed={sidebarMode === 'tabs' && sidebarPinned} title={sidebarMode === 'tabs' && sidebarPinned ? 'Auto-hide sidebar' : 'Pin sidebar open'} onClick={() => toggleToolbarPanel('tabs')}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3" /><path d="M8 9h8M8 12.5h8M8 16h5" /></svg>
                </button>
                <button className={`omnibox-action-button${sidebarMode === 'history' ? ' is-current' : ''}`} type="button" aria-label="Browsing history" aria-pressed={sidebarMode === 'history'} title="Browsing history" onClick={() => toggleToolbarPanel('history')}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 8.5A8 8 0 1 1 4 12" /><path d="M4.5 4.5v4h4M12 7.5v5l3 1.8" /></svg>
                </button>
              </div>
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
          {(browser.error || navigationError) && (
            <p className="browser-error" role="status">
              {browser.error ? `Page load issue: ${browser.error}. Check the tunnel or turn the proxy off.` : navigationError}
            </p>
          )}
        </header>
        <div className="browser-viewport" ref={viewportRef} aria-label={sidebarMode === 'settings' || sidebarMode === 'integrations' ? 'Settings content' : sidebarMode === 'downloads' ? 'Downloads content' : sidebarMode === 'network' ? 'Network inspector' : sidebarMode === 'site' ? 'Site settings' : 'Web page area'}>
          {sidebarMode === 'tabs' && !sidebarVisible && <div className="sidebar-reveal-edge" aria-hidden="true" onMouseEnter={revealSidebar} onMouseMove={revealSidebar} onMouseLeave={scheduleSidebarHide} />}
          {isLocalNewTab && !SETTINGS_SECTIONS.some((section) => section.mode === sidebarMode) && sidebarMode !== 'downloads' && (
            <section className="new-tab-page" aria-label="New Tab" style={{
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
                <h1 className="new-tab-sr-only">New Tab</h1>
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
                {newTabSites.length > 0 ? (
                  <div className="new-tab-link-groups" style={{
                    '--new-tab-icon-size': `${newTabPreferences.iconSize}px`,
                    '--new-tab-links-per-row': newTabPreferences.linksPerRow,
                    '--new-tab-icon-offset': `${newTabPreferences.iconVerticalOffset}px`
                  } as React.CSSProperties}>
                    {frequentlyVisitedSites.length > 0 && <section className="new-tab-link-group" aria-label="Most visited sites">
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
                ) : <p className="new-tab-empty">Pin a site from the address bar to add its icon here.</p>}
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
              {SETTINGS_SECTIONS.map((section) => (
                <button key={section.mode} type="button" className={sidebarMode === section.mode ? 'is-current' : ''} aria-current={sidebarMode === section.mode ? 'page' : undefined} onClick={() => selectSettingsSection(section.mode)}>{section.label}</button>
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
          {sidebarMode === 'downloads' && <DownloadsPanel mode="page" />}
          {(sidebarMode === 'settings' || sidebarMode === 'integrations') && (
            <div className="settings-view">
              <header className="settings-page-header">
                <div className="settings-page-heading-copy">
                  <h1>{sidebarMode === 'integrations' ? 'Integrations & add-ons' : 'Settings'}</h1>
                  <p>{sidebarMode === 'integrations' ? 'Configure New Tab, ad blocking, and browser add-ons.' : 'Choose browser behavior, proxy, and saved-session options.'}</p>
                </div>
              </header>
              <div className="settings-content">
                {sidebarMode === 'settings' && <>
                <section className="settings-section">
                  <label className="settings-field">
                    <span>Search engine</span>
                    <select className="settings-select" value={searchEngine} disabled={!searchEngineLoaded} onChange={(event) => setSearchEngine(event.target.value as SearchEngineId)} aria-label="Default search engine">
                      {SEARCH_ENGINES.map((engine) => <option key={engine.id} value={engine.id}>{engine.label}</option>)}
                    </select>
                  </label>
                  <p className="settings-help">Used for searches typed into the address bar.</p>
                </section>
                </>}
                {sidebarMode === 'integrations' && <>
                <section className="settings-section" aria-label="Site ad blocking">
                  <div className="settings-section-heading">
                    <div>
                      <strong>Ad blocking</strong>
                      <span className={`settings-status${siteSettings?.blockAds ? ' is-on' : ''}`}>
                        {siteSettingsLoading ? 'Loading this site…' : siteSettings ? siteSettings.blockAds ? 'On for this site' : 'Off for this site' : 'Per-site control'}
                      </span>
                    </div>
                  </div>
                  {siteSettingsLoading ? <p className="settings-help">Loading this site’s ad-blocking preference…</p> : siteSettings ? (
                    <label className="site-setting-row">
                      <span><strong>Block ads and trackers on this site</strong><small>Uses the browser’s network filter for future requests on this site.</small></span>
                      <input type="checkbox" checked={siteSettings.blockAds} onChange={(event) => void updateSiteSetting('blockAds', event.target.checked)} aria-label="Block ads and trackers on this site" />
                    </label>
                  ) : <p className="settings-help">Select an HTTP or HTTPS page to customize its ad and tracker blocking. The browser filter remains enabled by default.</p>}
                </section>
                <section className="settings-section">
                  <label className="settings-field">
                    <span>New tab page</span>
                    <select className="settings-select" value={newTabPage} onChange={(event) => {
                      const page = event.target.value as NewTabPageId
                      void window.api.browser.newTabPage.set(page).then((saved) => { if (saved) setNewTabPage(saved) })
                    }} aria-label="Default new tab page">
                      <option value="quick-links">Surffish New Tab (local)</option>
                      <option value="bonjourr">Bonjourr (online)</option>
                      <option value="search">Search engine</option>
                    </select>
                  </label>
                  <p className="settings-help">The local page uses a compact site-icon grid and rotating nature photos. Favorites reuse pinned sites; frequent sites are calculated from local history. Commons photo requests contain no browsing data, and approved photos are cached with source and license credits. Site icons use the page’s declared icon URL (or the site origin’s /favicon.ico fallback) and are cached locally. Bonjourr and the selected search engine remain available. This setting applies to new tabs opened from now on.</p>
                </section>
                <section className="settings-section new-tab-settings-section" aria-label="New Tab clocks">
                  <div className="settings-section-heading"><div><strong>New Tab · time and clocks</strong><span className="settings-status">Choose any supported time zone and give each of up to {MAX_WORLD_CLOCKS} world clocks its own label.</span></div></div>
                  <label className="new-tab-setting-toggle"><span>Show local clock</span><input type="checkbox" checked={newTabPreferences.showClock} onChange={(event) => patchNewTabPreferences({ showClock: event.target.checked })} /></label>
                  <label className="new-tab-setting-toggle"><span>Show date</span><input type="checkbox" checked={newTabPreferences.showDate} onChange={(event) => patchNewTabPreferences({ showDate: event.target.checked })} /></label>
                  <label className="new-tab-setting-toggle"><span>Use 24-hour time</span><input type="checkbox" checked={newTabPreferences.use24HourTime} onChange={(event) => patchNewTabPreferences({ use24HourTime: event.target.checked })} /></label>
                  <label className="new-tab-setting-toggle"><span>Show seconds</span><input type="checkbox" checked={newTabPreferences.showSeconds} onChange={(event) => patchNewTabPreferences({ showSeconds: event.target.checked })} /></label>
                  <label className="settings-field">
                    <span>Primary time zone</span>
                    <select className="settings-select" value={newTabPreferences.timeZone} onChange={(event) => patchNewTabPreferences({ timeZone: event.target.value })} aria-label="Primary New Tab time zone">
                      <option value="local">Automatic · device time</option>
                      {Array.from(new Set([...TIME_ZONE_OPTIONS, ...(newTabPreferences.timeZone === 'local' ? [] : [newTabPreferences.timeZone])])).map((zone) => <option key={zone} value={zone}>{timeZoneOptionLabel(zone)}</option>)}
                    </select>
                  </label>
                  <div className="new-tab-world-clocks">
                    <div className="new-tab-world-clocks-heading"><strong>World clocks</strong><button className="settings-action secondary" type="button" disabled={newTabPreferences.worldClocks.length >= MAX_WORLD_CLOCKS} onClick={() => {
                      const usedTimeZones = new Set([
                        Intl.DateTimeFormat().resolvedOptions().timeZone,
                        ...(newTabPreferences.timeZone === 'local' ? [] : [newTabPreferences.timeZone]),
                        ...newTabPreferences.worldClocks.map((item) => item.timeZone)
                      ])
                      const timeZone = TIME_ZONE_OPTIONS.find((zone) => !usedTimeZones.has(zone)) ?? 'UTC'
                      const clock: WorldClockPreference = { id: `${Date.now()}-${Math.floor(Math.random() * 10_000)}`, label: timeZoneCityName(timeZone), timeZone }
                      patchNewTabPreferences({ worldClocks: [...newTabPreferences.worldClocks, clock] })
                    }}>Add clock</button></div>
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
                        <button className="settings-action secondary" type="button" aria-label={`Remove ${clock.label} world clock`} onClick={() => patchNewTabPreferences({ worldClocks: newTabPreferences.worldClocks.filter((item) => item.id !== clock.id) })}>Remove</button>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="settings-section new-tab-settings-section" aria-label="New Tab weather">
                  <div className="settings-section-heading"><div><strong>New Tab · weather</strong><span className="settings-status">Optional current conditions, loaded only when enabled.</span></div></div>
                  <label className="new-tab-setting-toggle"><span>Show weather</span><input type="checkbox" checked={newTabPreferences.weatherEnabled} onChange={(event) => patchNewTabPreferences({ weatherEnabled: event.target.checked })} /></label>
                  <label className="settings-field"><span>City or town</span><input type="text" maxLength={100} value={newTabPreferences.weatherLocation} placeholder="e.g. Melbourne" onChange={(event) => patchNewTabPreferences({ weatherLocation: event.target.value })} aria-label="Weather city or town" /></label>
                  <label className="settings-field">
                    <span>Temperature unit</span>
                    <select className="settings-select" value={newTabPreferences.temperatureUnit} onChange={(event) => patchNewTabPreferences({ temperatureUnit: event.target.value as NewTabPreferences['temperatureUnit'] })} aria-label="Weather temperature unit">
                      <option value="celsius">Celsius</option><option value="fahrenheit">Fahrenheit</option>
                    </select>
                  </label>
                  <p className="settings-help">Weather is off by default. When enabled, the app sends only the city name you enter to Open-Meteo to retrieve current conditions; it does not use device geolocation or browsing history.</p>
                </section>
                <section className="settings-section new-tab-settings-section" aria-label="New Tab display options">
                  <div className="settings-section-heading"><div><strong>New Tab · display</strong><span className="settings-status">Adjust icon density and background treatment.</span></div></div>
                  <label className="new-tab-setting-toggle"><span>Show site names under icons</span><input type="checkbox" checked={newTabPreferences.showLinkLabels} onChange={(event) => patchNewTabPreferences({ showLinkLabels: event.target.checked })} /></label>
                  <label className="settings-field"><span>Icon size · {newTabPreferences.iconSize}px</span><input className="settings-range" type="range" min={20} max={52} value={newTabPreferences.iconSize} onChange={(event) => patchNewTabPreferences({ iconSize: Number(event.target.value) })} aria-label="New Tab icon size" /></label>
                  <label className="settings-field"><span>Links per row · {newTabPreferences.linksPerRow}</span><input className="settings-range" type="range" min={3} max={12} value={newTabPreferences.linksPerRow} onChange={(event) => patchNewTabPreferences({ linksPerRow: Number(event.target.value) })} aria-label="New Tab links per row" /></label>
                  <label className="settings-field"><span>Icon vertical position · {newTabPreferences.iconVerticalOffset}px</span><input className="settings-range" type="range" min={0} max={480} step={10} value={newTabPreferences.iconVerticalOffset} onChange={(event) => patchNewTabPreferences({ iconVerticalOffset: Number(event.target.value) })} aria-label="New Tab icon vertical position" /></label>
                  <label className="settings-field"><span>Background dim · {newTabPreferences.backgroundDim}%</span><input className="settings-range" type="range" min={0} max={70} value={newTabPreferences.backgroundDim} onChange={(event) => patchNewTabPreferences({ backgroundDim: Number(event.target.value) })} aria-label="New Tab background dim" /></label>
                  <label className="settings-field"><span>Background blur · {newTabPreferences.backgroundBlur}px</span><input className="settings-range" type="range" min={0} max={12} value={newTabPreferences.backgroundBlur} onChange={(event) => patchNewTabPreferences({ backgroundBlur: Number(event.target.value) })} aria-label="New Tab background blur" /></label>
                </section>
                <section className="settings-section bramble-settings-section" aria-label="Bramble extension settings">
                  <div className="settings-section-heading">
                    <div>
                      <strong>Bramble password manager</strong>
                      <span className={`settings-status${bramblePoc.installed ? ' is-on' : ''}`}>
                        {bramblePoc.loading ? 'Working…' : bramblePoc.installed ? `Installed · ${bramblePoc.version ?? 'version unknown'}` : 'Not installed in this Surffish profile'}
                      </span>
                    </div>
                    {bramblePoc.installed && bramblePoc.iconDataUrl && <img className="bramble-settings-icon" src={bramblePoc.iconDataUrl} alt="" />}
                  </div>
                  <p className="settings-help">Install or update the verified Firefox release here. The install and vault storage stay scoped to this Surffish profile; legacy Sockfish profile and vault data are never imported. “Create your vault” from the toolbar and Setup / customize here open Bramble setup in a regular Surffish browser tab.</p>
                  <div className="settings-actions bramble-settings-actions">
                    <button className="settings-action secondary" type="button" disabled={bramblePoc.loading} onClick={() => void window.api.browser.bramble.checkForUpdates()}>{bramblePoc.loading ? 'Checking…' : 'Check for updates'}</button>
                    <button className="settings-action primary" type="button" disabled={bramblePoc.loading || (bramblePoc.installed && bramblePoc.latestVersion !== null && !bramblePoc.updateAvailable)} onClick={() => void window.api.browser.bramble.installLatest()}>
                      {brambleInstallLabel}
                    </button>
                    <button className="settings-action secondary" type="button" disabled={!bramblePoc.installed || bramblePoc.loading} onClick={() => void openBrambleSetupPage()}>Setup / customize</button>
                  </div>
                  {bramblePoc.latestVersion && <p className="settings-help bramble-version-note">Latest Firefox release: <strong>{bramblePoc.latestVersion}</strong>{bramblePoc.installed && bramblePoc.updateAvailable ? ' · update available' : ''}</p>}
                  {bramblePoc.permissions.length > 0 && <p className="settings-help bramble-permission-note"><strong>Extension permissions:</strong> {bramblePoc.permissions.join(', ')}</p>}
                  {bramblePoc.hostPermissions.length > 0 && <p className="settings-help bramble-permission-note"><strong>Site access:</strong> {bramblePoc.hostPermissions.join(', ')}</p>}
                  <p className="settings-help">Releases are checked against Bramble’s SHA256SUMS and GitHub asset digest when available. Installation and updates are always manual; every release shows its requested access before activation. Surffish removes Firefox-only OAuth access, so Google Drive backup is unavailable.</p>
                  {bramblePoc.notice && <p className="settings-message" role="status">{bramblePoc.notice}</p>}
                  {bramblePoc.error && <p className="settings-message is-error" role="alert">{bramblePoc.error}</p>}
                </section>
                </>}
                {sidebarMode === 'settings' && <>
                <section className="settings-section" aria-label="Background tab sleep settings">
                  <label className="settings-field">
                    <span>Hibernate inactive tabs after</span>
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
                      <option value={5}>5 minutes</option>
                      <option value={15}>15 minutes</option>
                      <option value={30}>30 minutes</option>
                      <option value={60}>1 hour</option>
                    </select>
                  </label>
              <p className="settings-help">New tabs load immediately, including tabs opened in the background. Restored tabs may defer loading until selected. Loaded tabs keep playing media when you switch away, and audible tabs stay awake while playing. Hibernated tabs reload their last page; unsaved forms and in-page state are cleared.</p>
                </section>
                <section className="settings-section" aria-label="Saved session privacy">
                  <div className="settings-section-heading"><div><strong>Saved tabs</strong><span className="settings-status">Restore on next launch</span></div></div>
                  <p className="settings-help">Saved tab URLs are stored locally in your Surffish profile and are not separately encrypted. URL fragments and common credential-like query parameters (such as tokens, codes, passwords, and keys) are removed before saving; ordinary query parameters, such as searches and filters, are preserved.</p>
                  <div className="settings-actions">
                    <button className="settings-action secondary" type="button" aria-label="Clear saved session" onClick={() => void clearSavedSession()}>Clear saved session</button>
                  </div>
                  {sessionMessage && <p className="settings-message" role="status">{sessionMessage}</p>}
                </section>
                <section className="settings-section settings-connection" aria-label="SOCKS5 proxy settings">
                  <div className="settings-section-heading">
                    <div>
                      <strong>SOCKS5 proxy</strong>
                      <span className={`settings-status${appliedProxy.enabled ? ' is-on' : ''}`}>{appliedProxy.enabled ? `${appliedProxy.host}:${appliedProxy.port}` : 'Direct connection'}</span>
                    </div>
                    <label className="settings-toggle" title="Use local SOCKS5 proxy">
                      <input type="checkbox" checked={proxy.enabled} onChange={(event) => setProxy((current) => ({ ...current, enabled: event.target.checked }))} />
                      <span>On</span>
                    </label>
                  </div>
                  <label className="settings-field">
                    <span>Host</span>
                    <input type="text" value={proxy.host} spellCheck={false} onChange={(event) => setProxy((current) => ({ ...current, host: event.target.value }))} aria-label="Local SOCKS5 host" />
                  </label>
                  <label className="settings-field">
                    <span>Port</span>
                    <input type="number" value={proxy.port} min={1} max={65535} onChange={(event) => setProxy((current) => ({ ...current, port: Number(event.target.value) }))} aria-label="Local SOCKS5 port" />
                  </label>
                  <div className="settings-actions">
                    <button className="settings-action secondary" type="button" disabled={busy} onClick={() => void testProxy()}>Test port</button>
                    <button className="settings-action primary" type="button" disabled={busy} onClick={() => void saveProxy()}>{busy ? 'Working…' : 'Save'}</button>
                  </div>
                  <p className="settings-help">Start an SSH tunnel locally first: <code>ssh -N -D 127.0.0.1:1080 user@your-ssh-host</code></p>
                  {(proxyMessage || browser.error) && <p className={`settings-message${proxyMessageIsError || browser.error ? ' is-error' : ''}`} role="status">{browser.error ? `Page load issue: ${browser.error}. Check the tunnel or turn the proxy off.` : proxyMessage}</p>}
                </section>
                <section className="settings-section settings-data-note">
                  <strong>Browser data stays local</strong>
                  <p>Site data stays in this profile. Session-only sign-in cookies are saved with OS-backed encryption when available; sites can still expire logins themselves.</p>
                </section>
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
                        <span><strong>Open pop-ups in tabs</strong><small>Routes pop-up windows from this site into a regular browser tab.</small></span>
                        <input type="checkbox" checked={siteSettings.openPopupsInTabs} onChange={(event) => void updateSiteSetting('openPopupsInTabs', event.target.checked)} aria-label="Open this site’s pop-ups in tabs" />
                      </label>
                    </section>
                    <section className="settings-section">
                      <div className="settings-section-heading"><div><strong>Permissions</strong><span className="settings-status">Denied unless allowed below</span></div></div>
                      <label className="site-setting-row">
                        <span><strong>Camera and microphone</strong><small>Allows media access requests for this origin; the operating system may still require approval.</small></span>
                        <input type="checkbox" checked={siteSettings.allowMedia} onChange={(event) => void updateSiteSetting('allowMedia', event.target.checked)} aria-label="Allow camera and microphone on this site" />
                      </label>
                      <label className="site-setting-row">
                        <span><strong>Location</strong><small>Allows location requests for this origin.</small></span>
                        <input type="checkbox" checked={siteSettings.allowGeolocation} onChange={(event) => void updateSiteSetting('allowGeolocation', event.target.checked)} aria-label="Allow location on this site" />
                      </label>
                      <label className="site-setting-row">
                        <span><strong>Notifications</strong><small>Allows notification requests for this origin.</small></span>
                        <input type="checkbox" checked={siteSettings.allowNotifications} onChange={(event) => void updateSiteSetting('allowNotifications', event.target.checked)} aria-label="Allow notifications on this site" />
                      </label>
                      <p className="settings-help">All other web permissions stay denied. Turning a permission on does not bypass macOS or Windows privacy prompts.</p>
                    </section>
                    <div className="settings-actions"><button className="settings-action primary" type="button" onClick={() => void window.api.browser.reload()}>Reload page to apply</button></div>
                  </>
                ) : <section className="settings-section"><p className="settings-help">Select an HTTP or HTTPS page to manage its privacy controls.</p></section>}
              </div>
            </div>
          )}
          {sidebarMode === 'network' && (
            <div className="network-view">
              <header className="network-page-header">
                <div>
                  <h1>Network</h1>
                  <p>Live Chromium network events captured by this browser. Request details stay in memory only.</p>
                </div>
                <div className="network-toolbar-actions">
                  <label className="network-search">
                    <span aria-hidden="true">⌕</span>
                    <input type="search" value={networkQuery} onChange={(event) => setNetworkQuery(event.target.value)} placeholder="Filter requests" aria-label="Filter network requests" />
                  </label>
                  <select className="network-control" value={networkScope} onChange={(event) => setNetworkScope(event.target.value as 'all' | 'active')} aria-label="Request tab scope">
                    <option value="all">All tabs</option>
                    <option value="active">Active tab</option>
                  </select>
                  <select className="network-control" value={networkTypeFilter} onChange={(event) => setNetworkTypeFilter(event.target.value)} aria-label="Request type filter">
                    <option value="all">All types</option>
                    {[...new Set(networkRequests.map((request) => request.resourceType))].sort().map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                  <button className="settings-action secondary network-clear" type="button" disabled={networkRequests.length === 0} onClick={() => {
                    void window.api.browser.network.clear()
                    setSelectedNetworkId(null)
                    setNetworkDetails(null)
                    setNetworkResponseBody(null)
                  }}>Clear</button>
                </div>
              </header>
              <div className="network-summary" aria-live="polite">
                <span>{networkRequests.length.toLocaleString()} retained</span>
                <span>{networkRequests.filter((request) => request.state === 'pending').length.toLocaleString()} pending</span>
                <span>Latest 1,000 retained · oldest roll off</span>
                {networkRequests.length === 0 && <span>Navigate in a loaded tab to capture requests.</span>}
              </div>
              <div className="network-workspace">
                <div className="network-request-table-wrap">
                  <table className="network-request-table">
                    <thead><tr><th>Name</th><th>Status</th><th>Type</th><th>Initiator</th><th>Size</th><th>Time</th></tr></thead>
                    <tbody>
                      {networkRequests.filter((request) => {
                        const query = networkQuery.trim().toLowerCase()
                        const activeId = tabs.find((tab) => tab.active)?.id
                        return (networkScope === 'all' || request.tabId === activeId) &&
                          (networkTypeFilter === 'all' || request.resourceType === networkTypeFilter) &&
                          (!query || `${request.url} ${request.method} ${request.status ?? ''} ${request.resourceType} ${request.initiator} ${request.errorText}`.toLowerCase().includes(query))
                      }).map((request) => (
                        <tr key={request.id} className={`${request.state === 'failed' ? 'is-failed' : ''}${request.id === selectedNetworkId ? ' is-selected' : ''}`} onClick={() => {
                          setSelectedNetworkId(request.id)
                          setNetworkDetailsTab('headers')
                          setNetworkResponseBody(null)
                          setNetworkResponseError('')
                          setNetworkBodyLoading(false)
                        }} title={request.url} aria-selected={request.id === selectedNetworkId} tabIndex={0} onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelectedNetworkId(request.id)
                            setNetworkDetailsTab('headers')
                            setNetworkResponseBody(null)
                            setNetworkResponseError('')
                            setNetworkBodyLoading(false)
                          }
                        }}>
                          <td><span className="network-method">{request.method}</span><span className="network-name">{networkRequestName(request.url)}</span><span className="network-tab-label">{tabs.find((tab) => tab.id === request.tabId)?.title ?? 'Closed tab'}</span></td>
                          <td><span className={`network-status network-status-${request.state}`}>{networkStatusLabel(request)}</span></td>
                          <td>{request.resourceType}</td>
                          <td title={request.initiator}>{request.initiator || '—'}</td>
                          <td>{formatNetworkSize(request.transferSize)}</td>
                          <td>{formatNetworkTime(request.durationMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <section className="network-request-details" aria-label="Selected request details">
                  {selectedNetworkSummary ? (
                    <>
                      <div className="network-detail-title"><strong>{networkRequestName(selectedNetworkSummary.url)}</strong><span>{selectedNetworkSummary.method} · {networkStatusLabel(selectedNetworkSummary)}</span></div>
                      <nav className="network-detail-tabs" aria-label="Request detail sections">
                        {(['headers', 'payload', 'response', 'timing'] as const).map((tab) => <button key={tab} type="button" className={networkDetailsTab === tab ? 'is-current' : ''} aria-current={networkDetailsTab === tab ? 'page' : undefined} onClick={() => setNetworkDetailsTab(tab)}>{tab[0]?.toUpperCase()}{tab.slice(1)}</button>)}
                      </nav>
                      <div className="network-detail-content">
                        {networkDetailsTab === 'headers' && (networkDetails ? (
                          <>
                            <div className="network-detail-section"><strong>General</strong>
                              <dl>
                                <dt>Request URL</dt><dd className="network-url-value">{networkDetails.url}</dd>
                                <dt>Request Method</dt><dd>{networkDetails.method}</dd>
                                <dt>Status Code</dt><dd>{networkStatusLabel(networkDetails)}</dd>
                                <dt>Remote Address</dt><dd>{networkDetails.remoteAddress || '—'}</dd>
                                <dt>Protocol / Security</dt><dd>{networkDetails.protocol || '—'}{networkDetails.securityState ? ` · ${networkDetails.securityState}` : ''}</dd>
                              </dl>
                            </div>
                            {networkDetails.responseHeaders.length > 0 && <div className="network-detail-section"><strong>Response Headers</strong><dl>{networkDetails.responseHeaders.map((header, index) => <Fragment key={`response-${header.name}-${index}`}><dt>{header.name}</dt><dd>{header.value || '(empty)'}</dd></Fragment>)}</dl></div>}
                            {networkDetails.requestHeaders.length > 0 && <div className="network-detail-section"><strong>Request Headers</strong><dl>{networkDetails.requestHeaders.map((header, index) => <Fragment key={`request-${header.name}-${index}`}><dt>{header.name}</dt><dd>{header.value || '(empty)'}</dd></Fragment>)}</dl></div>}
                            {networkDetails.errorText && <p className="network-error-detail">{networkDetails.errorText}</p>}
                          </>
                        ) : <p className="network-empty-detail">Loading request details…</p>)}
                        {networkDetailsTab === 'payload' && (networkDetails?.requestBodyAvailable
                          ? <><strong className="network-detail-heading">Request payload</strong><pre>{networkDetails.requestBody ?? 'Chromium did not retain the request payload.'}</pre>{networkDetails.requestBodyTruncated && <p className="network-body-note">Payload display limited to 128 KB.</p>}</>
                          : <p className="network-empty-detail">This request has no captured payload.</p>)}
                        {networkDetailsTab === 'response' && (networkBodyLoading
                          ? <p className="network-empty-detail">Loading response body…</p>
                          : networkResponseBody
                            ? <><pre>{responseBodyText(networkResponseBody)}</pre>{networkResponseBody.truncated && <p className="network-body-note">Response display limited to 1 MB.</p>}{networkResponseBody.base64Encoded && <p className="network-body-note">Chromium returned this body as base64-encoded data.</p>}</>
                            : <p className="network-empty-detail">{networkResponseError || 'Select a completed request to inspect its response body.'}</p>)}
                        {networkDetailsTab === 'timing' && (networkDetails ? (
                          <div className="network-detail-section"><strong>Timing</strong>
                            <dl>
                              <dt>Started</dt><dd>{formatVisitedAt(networkDetails.startedAt)}</dd>
                              <dt>Total duration</dt><dd>{formatNetworkTime(networkDetails.durationMs)}</dd>
                              {networkDetails.timing && Object.entries(networkDetails.timing).filter(([name]) => name !== 'requestTime').map(([name, value]) => <Fragment key={name}><dt>{networkTimingLabel(name)}</dt><dd>{networkTimingValue(value)}</dd></Fragment>)}
                            </dl>
                          </div>
                        ) : <p className="network-empty-detail">Loading timing…</p>)}
                      </div>
                    </>
                  ) : <p className="network-empty-detail">Select a request to inspect its headers, payload, response and timing.</p>}
                </section>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
