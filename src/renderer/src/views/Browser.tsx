import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type {
  AdblockDiagnostics,
  BrambleExtensionState,
  BrowserRuntimeDiagnostics,
  BrowserProxySettings,
  BrowserSiteSettings,
  BrowserState,
  BrowserTabSummary,
  BrowsingHistoryEntry,
  NewTabBackground,
  NewTabPageId,
  NetworkRequestDetails,
  NetworkRequestSummary,
  NetworkResponseBody,
  PinnedSite,
  SearchEngineId,
  TabSleepMinutes
} from '../../../shared/types'
import { DEFAULT_SEARCH_ENGINE, getSearchHomepage, SEARCH_ENGINES, SOCKFISH_QUICK_LINKS_URL } from '../../../shared/navigation'
import { MAX_PINNED_SITES } from '../../../shared/persistence'
import { buildAddressSuggestions } from '../../../shared/autocomplete'
import { buildFrequentSites, toQuickLinkSite, type QuickLinkSite } from '../../../shared/quick-links'
import {
  getQuickLinkBackgroundIndex,
  nextQuickLinkBackgroundIndex,
  QUICK_LINK_BACKGROUND_ROTATION_MS
} from '../../../shared/quick-links-backgrounds'
import { NEW_TAB_PHOTO_REFRESH_INTERVAL_MS } from '../../../shared/new-tab-photo-feed'
import forestLake from '../assets/quick-links-backgrounds/forest-lake.webp'
import mountainLake from '../assets/quick-links-backgrounds/tranquil-mountain-lake.webp'
import './Browser.css'

const DEFAULT_PROXY: BrowserProxySettings = { enabled: true, host: '127.0.0.1', port: 1080 }
const BONJOURR_START_PAGE = 'https://online.bonjourr.fr/'
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

type SidebarMode = 'tabs' | 'history' | 'settings' | 'diagnostics' | 'network' | 'site'
type NetworkDetailsTab = 'headers' | 'payload' | 'response' | 'timing'

const SETTINGS_SECTIONS: ReadonlyArray<{ mode: Extract<SidebarMode, 'settings' | 'site' | 'diagnostics' | 'network'>; label: string }> = [
  { mode: 'settings', label: 'General' },
  { mode: 'site', label: 'This site' },
  { mode: 'diagnostics', label: 'Ad blocking' },
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

function NewTabSiteIcon({ site, onOpen }: { site: QuickLinkSite; onOpen: () => void }): React.JSX.Element {
  const [iconFailed, setIconFailed] = useState(false)
  const hostname = new URL(site.origin).hostname.replace(/^www\./i, '')
  const faviconUrl = `${site.origin}/favicon.ico`
  return (
    <button className="new-tab-icon-tile" type="button" onClick={onOpen} title={`Open ${site.title} · ${site.origin}`} aria-label={`Open ${site.title}, ${hostname}`}>
      <span className="new-tab-site-icon" aria-hidden="true">
        {!iconFailed && <img src={faviconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setIconFailed(true)} />}
        {iconFailed && <span>{site.title.trim().slice(0, 1).toUpperCase() || hostname.slice(0, 1).toUpperCase() || '↗'}</span>}
      </span>
    </button>
  )
}

export default function Browser(): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const browserChromeRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarToggleRef = useRef<HTMLButtonElement>(null)
  const sidebarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const newTabControlRef = useRef<HTMLDivElement>(null)
  const brambleButtonRef = useRef<HTMLButtonElement>(null)
  const [browser, setBrowser] = useState<BrowserState>(EMPTY_BROWSER)
  const [tabs, setTabs] = useState<BrowserTabSummary[]>([])
  const [bramblePoc, setBramblePoc] = useState<BrambleExtensionState>(EMPTY_BRAMBLE_POC)
  const [history, setHistory] = useState<BrowsingHistoryEntry[]>([])
  const [pinnedSites, setPinnedSites] = useState<PinnedSite[]>([])
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('tabs')
  const [sidebarPinned, setSidebarPinned] = useState(false)
  const [sidebarHovered, setSidebarHovered] = useState(false)
  const [sidebarFocused, setSidebarFocused] = useState(false)
  const [browserChromeHeight, setBrowserChromeHeight] = useState(window.api.platform === 'darwin' ? 73 : 45)
  const [historyQuery, setHistoryQuery] = useState('')
  const [address, setAddress] = useState(EMPTY_BROWSER.url)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [searchEngine, setSearchEngine] = useState<SearchEngineId>(DEFAULT_SEARCH_ENGINE)
  const [newTabPage, setNewTabPage] = useState<NewTabPageId>('quick-links')
  const [newTabBackgrounds, setNewTabBackgrounds] = useState<NewTabBackground[]>(FALLBACK_NEW_TAB_BACKGROUNDS)
  const [newTabBackgroundIndex, setNewTabBackgroundIndex] = useState(
    () => getQuickLinkBackgroundIndex(Date.now(), FALLBACK_NEW_TAB_BACKGROUNDS.length)
  )
  const [photoRefreshBusy, setPhotoRefreshBusy] = useState(false)
  const [photoRefreshStatus, setPhotoRefreshStatus] = useState('')
  const [tabSleepMinutes, setTabSleepMinutes] = useState<TabSleepMinutes>(30)
  const [searchEngineLoaded, setSearchEngineLoaded] = useState(false)
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false)
  const [proxy, setProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [appliedProxy, setAppliedProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [adblockDiagnostics, setAdblockDiagnostics] = useState<AdblockDiagnostics | null>(null)
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<BrowserRuntimeDiagnostics | null>(null)
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
  const [navigationError, setNavigationError] = useState('')
  const [proxyMessageIsError, setProxyMessageIsError] = useState(false)
  useEffect(() => {
    const rotationTimer = window.setInterval(() => {
      setNewTabBackgroundIndex((index) => nextQuickLinkBackgroundIndex(index, FALLBACK_NEW_TAB_BACKGROUNDS.length))
    }, QUICK_LINK_BACKGROUND_ROTATION_MS)
    return () => window.clearInterval(rotationTimer)
  }, [])
  const sidebarVisible = sidebarPinned || sidebarHovered || sidebarFocused || sidebarMode !== 'tabs'
  const addressSuggestions = useMemo(
    () => buildAddressSuggestions(address, pinnedSites, tabs, history),
    [address, pinnedSites, tabs, history]
  )
  const favoriteSites = useMemo(() => pinnedSites.map(toQuickLinkSite).filter((site): site is QuickLinkSite => site !== null), [pinnedSites])
  const frequentlyVisitedSites = useMemo(() => buildFrequentSites(history, pinnedSites), [history, pinnedSites])
  const newTabSites = useMemo(() => [...favoriteSites, ...frequentlyVisitedSites], [favoriteSites, frequentlyVisitedSites])
  const isLocalNewTab = browser.url === SOCKFISH_QUICK_LINKS_URL
  const newTabBackground = newTabBackgrounds[newTabBackgroundIndex] ?? newTabBackgrounds[0]!
  useEffect(() => {
    if (!isLocalNewTab) return
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
  }, [isLocalNewTab])
  const activeOrigin = httpOrigin(browser.url)
  const currentOriginIsPinned = Boolean(activeOrigin && pinnedSites.some((site) => httpOrigin(site.url) === activeOrigin))

  function revealSidebar(): void {
    if (sidebarHideTimerRef.current) clearTimeout(sidebarHideTimerRef.current)
    sidebarHideTimerRef.current = null
    setSidebarHovered(true)
  }

  function scheduleSidebarHide(): void {
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
    if (nextTarget && (sidebarRef.current?.contains(nextTarget) || sidebarToggleRef.current?.contains(nextTarget))) return
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

  async function refreshRuntimeDiagnostics(): Promise<void> {
    try {
      setRuntimeDiagnostics(await window.api.browser.runtime())
    } catch {
      setRuntimeDiagnostics(null)
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

  async function toggleCurrentSitePin(): Promise<void> {
    if (!activeOrigin) return
    const pinned = pinnedSites.some((site) => httpOrigin(site.url) === activeOrigin)
    if (!pinned && pinnedSites.length >= MAX_PINNED_SITES) {
      setNavigationError(`You can pin up to ${MAX_PINNED_SITES} sites. Remove one from the sidebar first.`)
      return
    }
    const title = browser.title.trim().slice(0, 80) || new URL(activeOrigin).hostname
    const next = pinned
      ? pinnedSites.filter((site) => httpOrigin(site.url) !== activeOrigin)
      : [...pinnedSites, { title, url: activeOrigin }]
    await savePinnedSites(next)
  }

  async function openPinnedSite(site: PinnedSite): Promise<void> {
    setSidebarMode('tabs')
    setSuggestionsOpen(false)
    await window.api.browser.navigate(site.url, searchEngine)
  }

  function selectSettingsSection(mode: Extract<SidebarMode, 'settings' | 'site' | 'diagnostics' | 'network'>): void {
    setSidebarMode(mode)
    if (mode === 'settings') void refreshRuntimeDiagnostics()
    if (mode === 'diagnostics') void window.api.browser.adblock.get().then(setAdblockDiagnostics)
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

  async function refreshAdblock(): Promise<void> {
    try {
      setAdblockDiagnostics(await window.api.browser.adblock.refresh())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAdblockDiagnostics((current) => current ? { ...current, lastError: message } : current)
    }
  }

  useEffect(() => {
    const unsubscribeState = window.api.browser.onState(setBrowser)
    const unsubscribeTabs = window.api.browser.tabs.onChange(setTabs)
    const unsubscribeHistory = window.api.browser.history.onChange(() => { void refreshHistory() })
    const unsubscribeAdblock = window.api.browser.adblock.onChange(setAdblockDiagnostics)
    const unsubscribeFocusAddress = window.api.browser.onFocusAddress(() => {
      addressRef.current?.focus()
      addressRef.current?.select()
    })
    void Promise.all([window.api.browser.state(), window.api.browser.getSearchEngine()]).then(([current, savedEngine]) => {
      setBrowser(current)
      setAddress(current.url)
      setSearchEngine(savedEngine)
      setSearchEngineLoaded(true)
      void window.api.browser.setSearchEngine(savedEngine)
      if (savedEngine !== DEFAULT_SEARCH_ENGINE && current.url === getSearchHomepage(DEFAULT_SEARCH_ENGINE)) {
        void window.api.browser.navigate(getSearchHomepage(savedEngine), savedEngine)
      }
    })
    void window.api.browser.tabs.get().then(setTabs)
    void refreshHistory()
    void window.api.browser.newTabPage.get().then(setNewTabPage)
    void window.api.browser.pinnedSites.get().then(setPinnedSites)
    void refreshRuntimeDiagnostics()
    void window.api.browser.getTabSleepMinutes().then(setTabSleepMinutes)
    void window.api.browser.adblock.get().then(setAdblockDiagnostics)
    void window.api.browser.proxy.get().then((settings) => {
      setProxy(settings)
      setAppliedProxy(settings)
    })
    return () => {
      unsubscribeState()
      unsubscribeTabs()
      unsubscribeHistory()
      unsubscribeAdblock()
      unsubscribeFocusAddress()
    }
  }, [])

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
    if (searchEngineLoaded) void window.api.browser.setSearchEngine(searchEngine)
  }, [searchEngine, searchEngineLoaded])

  useEffect(() => {
    if (!newTabMenuOpen) return
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (!newTabControlRef.current?.contains(event.target as Node)) setNewTabMenuOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setNewTabMenuOpen(false)
    }
    window.addEventListener('pointerdown', closeOnOutsideClick)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [newTabMenuOpen])

  useEffect(() => {
    const element = browserChromeRef.current
    if (!element) return
    const updateChromeHeight = (): void => setBrowserChromeHeight(element.getBoundingClientRect().height)
    const observer = new ResizeObserver(updateChromeHeight)
    observer.observe(element)
    window.addEventListener('resize', updateChromeHeight)
    updateChromeHeight()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateChromeHeight)
    }
  }, [])

  useEffect(() => () => {
    if (sidebarHideTimerRef.current) clearTimeout(sidebarHideTimerRef.current)
  }, [])

  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const updateBounds = (): void => {
      const rect = element.getBoundingClientRect()
      const sidebarInset = sidebarVisible ? Math.min(sidebarRef.current?.offsetWidth ?? 0, Math.max(0, rect.width - 48)) : 0
      const edgeRevealWidth = sidebarVisible ? 0 : 14
      const contentWidth = rect.width - sidebarInset - edgeRevealWidth
      const suggestionsCoverPage = suggestionsOpen && addressSuggestions.length > 0
      const canShow = sidebarMode !== 'settings' && sidebarMode !== 'diagnostics' && sidebarMode !== 'network' && sidebarMode !== 'site' && !isLocalNewTab && !suggestionsCoverPage && contentWidth > 0 && rect.height > 0
      void window.api.browser.setBounds(canShow
        ? { x: rect.left + sidebarInset + edgeRevealWidth, y: rect.top, width: contentWidth, height: rect.height }
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
  }, [sidebarMode, sidebarVisible, suggestionsOpen, addressSuggestions.length, isLocalNewTab])

  useEffect(() => {
    if (document.activeElement !== addressRef.current) setAddress(isLocalNewTab ? '' : browser.url)
  }, [browser.url, isLocalNewTab])

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 't' && !event.shiftKey) {
        event.preventDefault()
        createNewTab()
      } else if (key === 'w' && !event.shiftKey) {
        const activeTab = tabs.find((tab) => tab.active)
        if (!activeTab) return
        event.preventDefault()
        void window.api.browser.tabs.close(activeTab.id)
      } else if (key === 'tab' && tabs.length > 1) {
        event.preventDefault()
        const activeIndex = tabs.findIndex((tab) => tab.active)
        const offset = event.shiftKey ? -1 : 1
        const nextIndex = (activeIndex + offset + tabs.length) % tabs.length
        const nextTab = tabs[nextIndex]
        if (nextTab) void window.api.browser.tabs.activate(nextTab.id)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [tabs, searchEngine])

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
    if (!window.confirm('Clear all browsing history saved by Sockfish? Open tabs will stay open.')) return
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

  return (
    <section className={`browser-layout${sidebarVisible ? ' is-sidebar-visible' : ''}`} aria-label="Sockfish browser" onMouseMove={(event) => {
      if (!sidebarVisible && event.clientX <= 18) revealSidebar()
    }}>
      <aside
        ref={sidebarRef}
        className="browser-sidebar"
        style={{ top: `${browserChromeHeight}px` }}
        aria-label="Browser sidebar"
        onMouseEnter={revealSidebar}
        onMouseLeave={scheduleSidebarHide}
        onFocusCapture={keepSidebarVisibleForFocus}
        onBlurCapture={releaseSidebarFocus}
      >
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark" aria-hidden="true">S</span>
          <strong>Sockfish</strong>
          <button
            className="sidebar-collapse-button"
            type="button"
            aria-label={sidebarPinned ? 'Auto-hide sidebar' : 'Pin sidebar open'}
            aria-pressed={sidebarPinned}
            title={sidebarPinned ? 'Auto-hide sidebar' : 'Pin sidebar open'}
            onClick={() => setSidebarPinned((pinned) => !pinned)}
          ><span aria-hidden="true">{sidebarPinned ? '●' : '○'}</span></button>
        </div>
        <div className="sidebar-heading">
                <strong>{sidebarMode === 'history' ? 'History' : sidebarMode === 'diagnostics' ? 'Ad blocking' : sidebarMode === 'network' ? 'Network' : sidebarMode === 'site' ? 'This site' : 'Tabs'}</strong>
          {sidebarMode !== 'history' ? (
            <div className="new-tab-control" ref={newTabControlRef}>
              <button className="sidebar-icon-button" type="button" aria-label="New tab" title="New tab (Ctrl/⌘+T); Alt-click for options" onClick={(event) => {
                if (event.altKey) {
                  setNewTabMenuOpen((open) => !open)
                  return
                }
                setNewTabMenuOpen(false)
                createNewTab()
              }}>
                <span aria-hidden="true">＋</span>
              </button>
              {newTabMenuOpen && (
                <div className="new-tab-menu" role="menu" aria-label="New tab options">
                  <button type="button" role="menuitem" onClick={() => {
                    createNewTab()
                    setNewTabMenuOpen(false)
                  }}>
                    <strong>New tab</strong><span>{newTabPage === 'quick-links' ? 'Sockfish New Tab · local' : newTabPage === 'bonjourr' ? 'Bonjourr start page' : `${SEARCH_ENGINES.find((engine) => engine.id === searchEngine)?.label} start page`}</span>
                  </button>
                  <button type="button" role="menuitem" disabled={!tabs.some((tab) => tab.active)} onClick={() => {
                    const activeTab = tabs.find((tab) => tab.active)
                    if (activeTab) void window.api.browser.tabs.create(activeTab.url, searchEngine)
                    setNewTabMenuOpen(false)
                  }}>
                    <strong>Duplicate active tab</strong><span>Open the same address in a new tab</span>
                  </button>
                </div>
              )}
            </div>
          ) : sidebarMode === 'history' ? (
            <button className="sidebar-icon-button" type="button" aria-label="Clear browsing history" title="Clear history" disabled={history.length === 0} onClick={() => void clearHistory()}>
              <span aria-hidden="true">⌫</span>
            </button>
          ) : null}
        </div>

        {sidebarMode === 'tabs' && (
          <section className="sidebar-pinned-sites" aria-label="Pinned sites">
            <div className="sidebar-pinned-heading">
              <strong>Pinned</strong>
              <button className="sidebar-icon-button" type="button" aria-label="Pin current site" title="Pin current site" disabled={!activeOrigin || currentOriginIsPinned} onClick={() => void toggleCurrentSitePin()}>＋</button>
            </div>
            {pinnedSites.length > 0 ? (
              <div className="sidebar-pinned-list">
                {pinnedSites.map((site) => (
                  <button className="pinned-site-button" key={site.url} type="button" title={`${site.title} · ${site.url} (right-click to unpin)`} aria-label={`Open pinned site ${site.title}`} onClick={() => void openPinnedSite(site)} onContextMenu={(event) => {
                    event.preventDefault()
                    void savePinnedSites(pinnedSites.filter((pinned) => pinned.url !== site.url))
                  }}>
                    <span className="pinned-site-mark" aria-hidden="true">{site.title.slice(0, 1).toUpperCase()}</span>
                    <span>{site.title}</span>
                  </button>
                ))}
              </div>
            ) : <p className="sidebar-pinned-empty">Pin sites with ☆ in the address bar.</p>}
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
          <div className="tab-list" role="tablist" aria-label="Open tabs">
            {tabs.map((tab) => (
              <div
                className={`tab-item${tab.active ? ' is-active' : ''}${tab.sleeping ? ' is-sleeping' : ''}`}
                key={tab.id}
                role="tab"
                aria-selected={tab.active}
                tabIndex={0}
                title={tab.sleeping ? `${tab.title} — sleeping; select to reload` : tab.title}
                onClick={() => { void window.api.browser.tabs.activate(tab.id) }}
                onKeyDown={(event) => selectTabOnKeyboard(event, tab.id)}
              >
                <span className={`tab-favicon${tab.loading ? ' is-loading' : ''}${tab.sleeping ? ' is-sleeping' : ''}`} aria-hidden="true">{tab.loading ? '' : tab.sleeping ? 'Z' : tab.title.slice(0, 1).toUpperCase()}</span>
                <span className="tab-title">{tab.title}</span>
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
          </div>
        )}

        <div className="sidebar-footer">
          <button className={`sidebar-mode-button${SETTINGS_SECTIONS.some((section) => section.mode === sidebarMode) ? ' is-current' : ''}`} type="button" aria-label="Settings" title="Settings" aria-current={SETTINGS_SECTIONS.some((section) => section.mode === sidebarMode) ? 'page' : undefined} onClick={() => selectSettingsSection('settings')}>
            <span aria-hidden="true">⚙</span><span>Settings</span>
          </button>
          <div className="sidebar-footer-divider" />
          <button className="sidebar-mode-button sidebar-quit-button" type="button" aria-label="Quit Sockfish" title="Quit Sockfish" onClick={() => void window.api.browser.quit()}>
            <span aria-hidden="true">⏻</span><span>Quit Sockfish</span>
          </button>
        </div>
      </aside>

      <div className="browser-main">
        <header className="browser-chrome" ref={browserChromeRef}>
          <div className="window-drag-region" aria-hidden="true" />
          <form className="browser-toolbar" onSubmit={(event) => void navigate(event)}>
            <button
              ref={sidebarToggleRef}
              className="toolbar-button sidebar-toggle-button"
              type="button"
              aria-label={sidebarPinned ? 'Auto-hide sidebar' : 'Pin sidebar open'}
              aria-pressed={sidebarPinned}
              title={sidebarPinned ? 'Auto-hide sidebar' : 'Pin sidebar open'}
              onMouseEnter={revealSidebar}
              onMouseLeave={scheduleSidebarHide}
              onFocus={revealSidebar}
              onBlurCapture={releaseSidebarFocus}
              onClick={() => setSidebarPinned((pinned) => !pinned)}
            >
              <span aria-hidden="true">▤</span>
            </button>
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
            <div className="omnibox-wrap">
              <div className="omnibox">
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
                <div className="omnibox-actions" role="group" aria-label="Browser panels">
                  <button className={`omnibox-action-button${sidebarMode === 'tabs' && sidebarPinned ? ' is-current' : ''}`} type="button" aria-label="Tabs and pinned sites" aria-pressed={sidebarMode === 'tabs' && sidebarPinned} title="Tabs and pinned sites" onClick={() => toggleToolbarPanel('tabs')}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3" /><path d="M8 9h8M8 12.5h8M8 16h5" /></svg>
                  </button>
                  <button className={`omnibox-action-button${sidebarMode === 'history' ? ' is-current' : ''}`} type="button" aria-label="Browsing history" aria-pressed={sidebarMode === 'history'} title="Browsing history" onClick={() => toggleToolbarPanel('history')}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 8.5A8 8 0 1 1 4 12" /><path d="M4.5 4.5v4h4M12 7.5v5l3 1.8" /></svg>
                  </button>
                </div>
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
            <button
              className={`toolbar-button favorite-button${currentOriginIsPinned ? ' is-favorite' : ''}`}
              type="button"
              aria-label={currentOriginIsPinned ? 'Unpin this site' : 'Pin this site'}
              aria-pressed={currentOriginIsPinned}
              title={currentOriginIsPinned ? 'Unpin this site' : 'Pin this site'}
              disabled={!activeOrigin}
              onClick={() => void toggleCurrentSitePin()}
            ><span aria-hidden="true">{currentOriginIsPinned ? '★' : '☆'}</span></button>
            <button
              className="toolbar-button picture-in-picture-button"
              type="button"
              aria-label="Picture in Picture"
              title="Picture in Picture (video opens in a floating window)"
              onClick={() => {
                void window.api.browser.pictureInPicture().then((started) => {
                  if (!started) setNavigationError('No active video can open in Picture in Picture on this page.')
                  else setNavigationError('')
                })
              }}
            ><span aria-hidden="true">▣</span></button>
            <button
              className={`toolbar-button site-controls-button${sidebarMode === 'site' ? ' is-current' : ''}`}
              type="button"
              aria-label="Site settings"
              aria-pressed={sidebarMode === 'site'}
              title={activeOrigin ? `Site settings for ${activeOrigin}` : 'Site settings unavailable for this page'}
              disabled={!activeOrigin}
              onClick={() => selectSettingsSection('site')}
            ><span aria-hidden="true">⛨</span></button>
            <button
              className={`toolbar-button bramble-toolbar-button${bramblePoc.installed ? ' is-installed' : ''}`}
              ref={brambleButtonRef}
              type="button"
              aria-label={bramblePoc.installed ? 'Open Bramble' : 'Open Bramble extension settings'}
              aria-pressed={bramblePoc.popupOpen}
              aria-busy={bramblePoc.loading}
              title={bramblePoc.installed ? `Open Bramble${bramblePoc.version ? ` ${bramblePoc.version}` : ''}` : 'Bramble extension settings'}
              disabled={bramblePoc.loading}
              onClick={() => bramblePoc.installed ? void openBramblePoc() : selectSettingsSection('settings')}
            >
              {bramblePoc.iconDataUrl
                ? <img className="bramble-toolbar-icon" src={bramblePoc.iconDataUrl} alt="" />
                : <span className="bramble-toolbar-fallback" aria-hidden="true">B</span>}
            </button>
          </form>
          {(browser.error || navigationError) && (
            <p className="browser-error" role="status">
              {browser.error ? `Page load issue: ${browser.error}. Check the tunnel or turn the proxy off.` : navigationError}
            </p>
          )}
        </header>
        <div className="browser-viewport" ref={viewportRef} aria-label={sidebarMode === 'settings' ? 'Settings content' : sidebarMode === 'diagnostics' ? 'Diagnostics content' : sidebarMode === 'network' ? 'Network inspector' : sidebarMode === 'site' ? 'Site settings' : 'Web page area'}>
          {sidebarMode === 'tabs' && !sidebarVisible && <div className="sidebar-reveal-edge" aria-hidden="true" onMouseEnter={revealSidebar} onMouseMove={revealSidebar} onMouseLeave={scheduleSidebarHide} />}
          {isLocalNewTab && !SETTINGS_SECTIONS.some((section) => section.mode === sidebarMode) && (
            <section className="new-tab-page" aria-label="New Tab">
              <div
                key={newTabBackground.title}
                className="new-tab-backdrop"
                aria-hidden="true"
                style={{ backgroundImage: `url("${newTabBackground.src}")` }}
              />
              <div className="new-tab-content">
                <h1 className="new-tab-sr-only">New Tab</h1>
                {newTabSites.length > 0 ? (
                  <div className="new-tab-icon-grid" role="group" aria-label="Favorite and frequently visited sites">
                    {newTabSites.map((site) => <NewTabSiteIcon key={site.origin} site={site} onOpen={() => void navigateTo(site.url)} />)}
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
            </nav>
          )}
          {sidebarMode === 'settings' && (
            <div className="settings-view">
              <header className="settings-page-header">
                <h1>Settings</h1>
                <p>Choose your start page, search engine, and browser behavior.</p>
              </header>
              <div className="settings-content">
                <section className="settings-section">
                  <label className="settings-field">
                    <span>Search engine</span>
                    <select className="settings-select" value={searchEngine} disabled={!searchEngineLoaded} onChange={(event) => setSearchEngine(event.target.value as SearchEngineId)} aria-label="Default search engine">
                      {SEARCH_ENGINES.map((engine) => <option key={engine.id} value={engine.id}>{engine.label}</option>)}
                    </select>
                  </label>
                  <p className="settings-help">Used for searches typed into the address bar.</p>
                </section>
                <section className="settings-section">
                  <label className="settings-field">
                    <span>New tab page</span>
                    <select className="settings-select" value={newTabPage} onChange={(event) => {
                      const page = event.target.value as NewTabPageId
                      void window.api.browser.newTabPage.set(page).then((saved) => { if (saved) setNewTabPage(saved) })
                    }} aria-label="Default new tab page">
                      <option value="quick-links">Sockfish New Tab (local)</option>
                      <option value="bonjourr">Bonjourr (online)</option>
                      <option value="search">Search engine</option>
                    </select>
                  </label>
                  <p className="settings-help">The local page uses a compact site-icon grid and rotating nature photos. Favorites reuse pinned sites; frequent sites are calculated from local history. Commons photo requests contain no browsing data, and approved photos are cached with source and license credits. Each favicon is requested from its site's own origin. Bonjourr and the selected search engine remain available. This setting applies to new tabs opened from now on.</p>
                </section>
                <section className="settings-section bramble-settings-section" aria-label="Bramble extension settings">
                  <div className="settings-section-heading">
                    <div>
                      <strong>Bramble password manager</strong>
                      <span className={`settings-status${bramblePoc.installed ? ' is-on' : ''}`}>
                        {bramblePoc.loading ? 'Working…' : bramblePoc.installed ? `Installed · ${bramblePoc.version ?? 'version unknown'}` : 'Not installed'}
                      </span>
                    </div>
                    {bramblePoc.installed && bramblePoc.iconDataUrl && <img className="bramble-settings-icon" src={bramblePoc.iconDataUrl} alt="" />}
                  </div>
                  <p className="settings-help">Install or update the verified Firefox release here. Bramble’s vault setup and customization open in Bramble’s own window; the toolbar keeps only its popup icon.</p>
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
                  <p className="settings-help">Releases are checked against Bramble’s SHA256SUMS and GitHub asset digest when available. Installation and updates are always manual; every release shows its requested access before activation. Sockfish removes Firefox-only OAuth access, so Google Drive backup is unavailable.</p>
                  {bramblePoc.notice && <p className="settings-message" role="status">{bramblePoc.notice}</p>}
                  {bramblePoc.error && <p className="settings-message is-error" role="alert">{bramblePoc.error}</p>}
                </section>
                <section className="settings-section runtime-diagnostics-section" aria-label="Passkey runtime diagnostics">
                  <div className="settings-section-heading">
                    <div><strong>Passkey compatibility check</strong><span className={`settings-status${runtimeDiagnostics && Number.parseInt(runtimeDiagnostics.chromiumVersion, 10) >= 122 ? ' is-on' : ''}`}>{runtimeDiagnostics ? `Electron ${runtimeDiagnostics.electronVersion} · Chromium ${runtimeDiagnostics.chromiumVersion}` : 'Reading runtime…'}</span></div>
                    <button className="settings-action secondary" type="button" onClick={() => void refreshRuntimeDiagnostics()}>Refresh check</button>
                  </div>
                  {runtimeDiagnostics && (
                    <>
                      <p className="settings-help">{Number.parseInt(runtimeDiagnostics.chromiumVersion, 10) >= 122 ? 'This Chromium build meets Bramble’s documented Chrome 122+ version floor for extension custom-RP-ID WebAuthn.' : 'This Chromium build is below Bramble’s documented Chrome 122+ version floor for extension custom-RP-ID WebAuthn.'}</p>
                      <p className="settings-help">Active page: {runtimeDiagnostics.pageUrl ? httpOrigin(runtimeDiagnostics.pageUrl) ?? 'non-web page' : 'not available'} · secure context: {runtimeDiagnostics.pageSecureContext === null ? 'unknown' : runtimeDiagnostics.pageSecureContext ? 'yes' : 'no'} · Credentials API: {runtimeDiagnostics.pageHasCredentialsApi === null ? 'unknown' : runtimeDiagnostics.pageHasCredentialsApi ? 'available' : 'unavailable'} · WebAuthn create/get: {runtimeDiagnostics.pageHasWebAuthnApi === null ? 'unknown' : runtimeDiagnostics.pageHasWebAuthnApi ? 'available' : 'unavailable'}.</p>
                      <code className="runtime-user-agent">{runtimeDiagnostics.userAgent || 'User-Agent is unavailable for this tab.'}</code>
                    </>
                  )}
                  <p className="settings-help">The browser does not spoof its User-Agent. Bramble also maps a WebAuthn <code>SecurityError</code> to its “too old” message; a rejected custom RP ID or extension host-permission mismatch can look the same, even when the version is new enough. This page-level probe reports engine/API facts, not a guarantee that the extension host accepted its RP ID.</p>
                  <p className="settings-help">Native macOS Touch ID for arbitrary site passkeys needs Apple’s managed browser public-key-credential entitlement and organization review/signing; this app does not claim that support or add an Apple Developer enrollment requirement. Bramble’s vault passkeys are a separate extension feature.</p>
                </section>
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
                        <input type="checkbox" checked={siteSettings.blockAds} onChange={(event) => void updateSiteSetting('blockAds', event.target.checked)} aria-label="Block ads and trackers on this site" />
                      </label>
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
          {sidebarMode === 'diagnostics' && (
            <div className="diagnostics-view">
              <header className="settings-page-header">
                <h1>Diagnostics</h1>
                <p>Live ad-filter status and recent network decisions for this browser session.</p>
              </header>
              <div className="settings-content">
                <section className="settings-section diagnostics-section" aria-label="Network ad blocking diagnostics">
                  <div className="settings-section-heading">
                    <div>
                      <strong>Network ad blocking</strong>
                      <span className={`settings-status${adblockDiagnostics?.blockingEnabled ? ' is-on' : ''}`}>
                        {!adblockDiagnostics ? 'Reading status…' : adblockDiagnostics.status === 'updating'
                          ? `Active · refreshing filters (${adblockDiagnostics.loadedListCount} lists)`
                          : adblockDiagnostics.blockingEnabled
                            ? adblockDiagnostics.status === 'degraded' ? 'Limited · filter engine unavailable or empty' : 'Active'
                            : 'Unavailable'}
                      </span>
                    </div>
                    <button className="settings-action secondary diagnostics-refresh" type="button" disabled={!adblockDiagnostics || adblockDiagnostics.status === 'updating'} onClick={() => {
                      void refreshAdblock()
                    }}>{adblockDiagnostics?.status === 'updating' ? 'Updating…' : 'Update filters'}</button>
                  </div>
                  <div className="diagnostics-stats" aria-live="polite">
                    <div><strong>{adblockDiagnostics?.blockedRequests.toLocaleString() ?? '—'}</strong><span>Blocked requests</span></div>
                    <div><strong>{adblockDiagnostics?.allowedRequests.toLocaleString() ?? '—'}</strong><span>Allowed requests</span></div>
                    <div><strong>{adblockDiagnostics?.networkFilterCount.toLocaleString() ?? '—'}</strong><span>Network rules</span></div>
                    <div><strong>{adblockDiagnostics?.loadedListCount ?? '—'}</strong><span>Loaded lists</span></div>
                  </div>
                  <p className="settings-help diagnostics-summary">
                    {adblockDiagnostics
                      ? `${adblockDiagnostics.source === 'updated' ? 'Latest lists downloaded' : adblockDiagnostics.source === 'cache' ? 'Using cached lists' : adblockDiagnostics.source === 'stale-cache' ? 'Using older cached lists' : adblockDiagnostics.source === 'empty' ? 'No filter lists loaded' : 'Filter lists not loaded'}${adblockDiagnostics.lastUpdatedAt ? ` · Updated ${formatVisitedAt(adblockDiagnostics.lastUpdatedAt)}` : ''}. Counts cover subresource requests since this launch (not top-level page navigations); only hostnames and resource types are kept for the 20 most recent blocks.`
                      : 'Loading filter status…'}
                  </p>
                  {adblockDiagnostics?.lastError && <p className="settings-message is-error" role="status">{adblockDiagnostics.lastError}</p>}
                  {adblockDiagnostics && adblockDiagnostics.loadedLists.length > 0 && (
                    <div className="diagnostics-lists">
                      <strong>Active lists</strong>
                      <ul>{adblockDiagnostics.loadedLists.map((list, index) => <li key={`${list}-${index}`}>{list}</li>)}</ul>
                    </div>
                  )}
                </section>
                <section className="settings-section diagnostics-section" aria-label="Recent blocked requests">
                  <div className="diagnostics-section-heading"><strong>Recent blocked requests</strong><span>Newest first · hostnames only</span></div>
                  {adblockDiagnostics?.recentBlockedRequests.length ? (
                    <ol className="diagnostics-block-list">
                      {adblockDiagnostics.recentBlockedRequests.map((request, index) => (
                        <li key={`${request.timestamp}-${request.requestHost}-${index}`}>
                          <time dateTime={new Date(request.timestamp).toISOString()}>{new Date(request.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</time>
                          <span className="diagnostics-block-host" title={request.requestHost}>{request.requestHost}</span>
                          <span className="diagnostics-block-page" title={`From ${request.pageHost}`}>{request.pageHost}</span>
                          <span className="diagnostics-block-type">{request.resourceType}</span>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="settings-help">No matching requests blocked yet. If ads remain, check whether the request is present above and refresh the maintained lists.</p>}
                </section>
                <section className="settings-section diagnostics-note">
                  <strong>YouTube note</strong>
                  <p>YouTube serves ads and wanted video chunks through shared delivery hosts. Sockfish allows requests to <code>googlevideo.com</code> delivery hosts so ad rules cannot interrupt video playback; ads delivered there may remain. Cosmetic hiding stays off, while matching ad requests on other hosts can still be blocked.</p>
                </section>
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
