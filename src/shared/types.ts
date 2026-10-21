import type { ClockDateFormat, ClockTimeFormat, ClockWeight, WeatherPosition } from './new-tab-clock'
import type { WeatherCondition, WeatherDay, WeatherForecastView } from './weather-forecast'
import type { BrowserPageSecurity } from './certificates'
import type { BrowserLoadError } from './navigation-errors'
import type { TabSplitInfo } from './split-view'
import type { TabGroupInfo } from './tab-groups'
/** Shared type-only contracts between the main, preload, and renderer processes. */
export type SearchEngineId = 'brave' | 'duckduckgo' | 'google' | 'bing'
export type TabSleepMinutes = 0 | 5 | 15 | 30 | 60
/** Why a tab has no live page (shared/tab-sleep.ts). */
export type TabSleepReason = 'restored' | 'idle' | 'memory' | 'manual' | 'crashed'
export interface BrowserTabSleep {
  reason: TabSleepReason
  /** `idle`: the sleep timer it slept after. */
  minutes?: number
}
export type NewTabPageId = 'quick-links' | 'bonjourr' | 'search'
export type BrowserUiFont = 'system' | 'maple-mono'

export interface NewTabBackground {
  id: string
  src: string
  title: string
  creator: string
  sourceUrl: string
  licenseName: string
  licenseUrl: string
}

export interface NewTabBackgroundRefreshResult {
  backgrounds: NewTabBackground[]
  updated: boolean
  error: string | null
}

export interface WorldClockPreference {
  id: string
  label: string
  timeZone: string
}

export type TemperatureUnit = 'celsius' | 'fahrenheit'
export type WeatherProviderId = 'open-meteo' | 'met-norway' | 'wttr' | 'openweathermap'
/** Open-Meteo's `models=` choice (Best match lets Open-Meteo pick per place). */
export type OpenMeteoModelId = 'best_match' | 'bom_access_global' | 'ecmwf_ifs' | 'ncep_gfs_seamless' | 'dwd_icon_seamless' | 'ukmo_seamless'

/** A place picked in the New Tab weather search: weather lookups use its coordinates, never re-geocode. */
export interface WeatherPlace {
  name: string
  region?: string
  country?: string
  countryCode?: string
  latitude: number
  longitude: number
  timeZone?: string
}

/** Weather IPC replies: expected failures (offline, bad key, unknown city) are values, not thrown errors. */
export type WeatherResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Which weather API keys are saved (the keys themselves never leave main). */
export interface WeatherKeyStatus {
  openweathermap: boolean
}

export interface NewTabPreferences {
  showClock: boolean
  showDate: boolean
  /** Replaced `use24HourTime` (Oct 2026): true → '24h', false → '12h'. */
  timeFormat: ClockTimeFormat
  /** 12-hour clocks only. */
  showAmPm: boolean
  showSeconds: boolean
  dateFormat: ClockDateFormat
  /** Clock size, percent of the original (MIN_CLOCK_SCALE–MAX_CLOCK_SCALE); replaced S/M/L/XL `clockSize`. */
  clockScale: number
  /** Vertical position of the clocks/weather, percent of the free space above the icons (0 = top). */
  clockVerticalPosition: number
  clockWeight: ClockWeight
  /** Tabular (fixed-width) digits so the time doesn't jiggle as it ticks. */
  clockTabularDigits: boolean
  /** "Good evening" above the clocks. */
  showGreeting: boolean
  timeZone: string
  worldClocks: WorldClockPreference[]
  /** World clocks: "+2h" from the main clock. */
  worldClockShowDifference: boolean
  /** World clocks: "Tomorrow" / "Yesterday" when the day differs from the main clock's. */
  worldClockShowDay: boolean
  weatherEnabled: boolean
  /** Display label of the place ("Melbourne, Victoria, Australia"); before places existed, free text. */
  weatherLocation: string
  /** The searched place; null for settings saved before city search (looked up once, then saved). */
  weatherPlace: WeatherPlace | null
  weatherProvider: WeatherProviderId
  /** Only used when weatherProvider is Open-Meteo. */
  openMeteoModel: OpenMeteoModelId
  temperatureUnit: TemperatureUnit
  /** Weather on its own line under the clocks, or in the top-right corner. */
  weatherPosition: WeatherPosition
  /** Weather size, percent (MIN_WEATHER_SCALE–MAX_WEATHER_SCALE) on top of the gentle clock-following scale; 100 = the original look. */
  weatherScale: number
  /** Current only (the original look), today's high/low, or 3/5/7 daily rows. */
  weatherForecast: WeatherForecastView
  iconSize: number
  linksPerRow: number
  showLinkLabels: boolean
  backgroundDim: number
  backgroundBlur: number
  /**
   * Where the site icons sit in the free space between the clocks and the photo credit: 0 = top,
   * 100 = bottom (percent). Replaced `iconVerticalOffset` (px below centre, 0–480) in Oct 2026.
   */
  iconVerticalPosition: number
}

export interface NewTabWeatherSnapshot {
  location: string
  provider: WeatherProviderId
  /** The place the reading is for (lets a legacy free-text setting save its place once). */
  place: WeatherPlace
  temperatureCelsius: number
  description: string
  fetchedAt: number
  /** Open-Meteo model the reading came from (best_match when the chosen model had no data). */
  model?: OpenMeteoModelId
  /** One short line when the reading isn't exactly what was asked for ("BOM ACCESS-G data unavailable, showing best match."). */
  notice?: string
  /** Icon family for the current reading. */
  condition?: WeatherCondition
  /** Daily rows (the place's local dates, today first) when the request asked for them. */
  daily?: WeatherDay[]
}

export interface PinnedSite {
  title: string
  url: string
  faviconUrl?: string
}

/** One folder or bookmark in the bookmark tree; `parentId` is null only for the invisible root. */
export interface BookmarkNode {
  id: string
  type: 'folder' | 'bookmark'
  title: string
  url?: string
  parentId: string | null
  index: number
  dateAdded: number
  faviconUrl?: string
}

/** Every node except the root, pre-ordered (parents before children, siblings by index). */
export interface BookmarksSnapshot {
  nodes: BookmarkNode[]
}

/** Effective per-origin privacy choices; permissions are denied unless explicitly allowed. */
export interface BrowserSiteSettings {
  origin: string
  blockAds: boolean
  openPopupsInTabs: boolean
  allowMedia: boolean
  allowGeolocation: boolean
  allowNotifications: boolean
  allowClipboardRead: boolean
}

export interface BrowserProxySettings {
  enabled: boolean
  host: string
  port: number
  /** Local-network addresses (192.168.x, 10.x, `*.local`, …) skip the proxy. Default on. */
  bypassLocalNetwork: boolean
}
export interface BrowserProxyTestResult {
  reachable: boolean
  message: string
}
export interface BrowserState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
  /** The active tab is a private tab. */
  private: boolean
  /** Page zoom of the active tab (1 = 100%). */
  zoomFactor: number
  /** The active tab shows a PDF in the built-in viewer, or the PDF editor. */
  pdf: 'viewer' | 'editor' | null
  /** Reader view: the page looks like an article ('available') or Reader view is open ('active'). */
  reader: 'available' | 'active' | null
  /** A full-page notice drawn over the active tab (crash, hang, HTTPS-only fallback). */
  interstitial: BrowserTabInterstitial | null
  /** Details for `error` when it is a page-load failure (friendly copy, Retry, in-page error). */
  loadError: BrowserLoadError | null
  /** How the active page's HTTPS certificate was trusted (null: not HTTPS, unknown, or an error page). */
  security?: BrowserPageSecurity | null
  /**
   * When main made the current tab the active one (epoch ms, `Date.now()` in main). A renderer
   * learns of a tab switch from the per-frame coalesced tab broadcast, which can land after a
   * popover main opened *after* the switch; this stamp lets that late switch skip such a popover
   * (shared/popover-dismiss.ts `tabSwitchClosesPopover`).
   */
  activeTabSince?: number
  /** The active tab's page has played video or audio since it loaded (the toolbar's contextual Cast button). */
  media?: boolean
  /**
   * The active tab is the window's Settings tab (shared/settings-tab.ts): which page to show, the
   * site to focus on Sites, the General category to scroll to. `revision` changes with every request
   * to open Settings, so asking for the same page again still re-applies it (scroll, focus).
   */
  settings?: BrowserSettingsTabState | null
}

/** Where to open Settings (shared/settings-tab.ts normalizes it). */
export interface BrowserSettingsTarget {
  section: BrowserSettingsTabState['section']
  host?: string
  focus?: string
}

export interface BrowserSettingsTabState {
  section: 'settings' | 'newtab' | 'integrations' | 'feeds' | 'readaloud' | 'privacy' | 'watchers' | 'site' | 'network' | 'diagnostics'
  host?: string
  focus?: string
  revision: number
}

export type BrowserTabInterstitial =
  | { kind: 'crashed'; reason: string; label: string; /** Crashed again right after auto-reloading; we stopped retrying. */ repeated: boolean }
  | { kind: 'unresponsive' }
  | {
    kind: 'https-unavailable'
    /** The http:// URL the user asked for (or typed without a scheme). */
    url: string
    host: string
    error: string
    /** What tried https: HTTPS-only mode, or the address bar trying https first for a typed bare host. */
    source?: 'https-only' | 'typed'
    /** Continue to HTTP saves a per-host HTTPS-only exception (only while HTTPS-only mode is on). */
    remember?: boolean
  }

/** Find-in-page result for the active tab, from Electron's `found-in-page`. */
export interface BrowserFindResult {
  activeMatchOrdinal: number
  matches: number
  finalUpdate: boolean
}

/** What the toolbar find bar should show; `open` false hides it. */
export interface BrowserFindState {
  open: boolean
  text: string
  result: BrowserFindResult | null
}
export interface BrowserTabSummary {
  id: string
  url: string
  title: string
  faviconUrl: string | null
  loading: boolean
  active: boolean
  pinned: boolean
  sleeping: boolean
  /** Why it sleeps (only while `sleeping`). */
  sleep?: BrowserTabSleep
  /** Tab is producing sound (Chromium's audible state, held ~1 s after it goes quiet; muted media never counts). */
  audible: boolean
  /** Tab audio is muted by the user. */
  muted: boolean
  /** Tab volume 0..1 (shared/tab-volume.ts), absent at 100%; separate from `muted`. */
  volume?: number
  /** The page has been audible since it loaded: a quiet tab keeps its volume control on hover (shared/tab-audio.ts). */
  audioHeard?: boolean
  /** Private tab: in-memory session, nothing saved. */
  private: boolean
  /** The tab's page process crashed; it reloads when the tab is next opened. */
  crashed?: boolean
  /** The tab is a pane of a split view (the sidebar shows the split as one entry). */
  split?: TabSplitInfo
  /** The tab is in a tab group (the sidebar draws a header above the group's run). */
  group?: TabGroupInfo
}
export interface BrowsingHistoryEntry {
  id: string
  url: string
  title: string
  visitedAt: number
  faviconUrl?: string
}
export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserSidebarMode = 'tabs' | 'history' | 'settings' | 'newtab' | 'integrations' | 'network' | 'site' | 'downloads' | 'privacy' | 'diagnostics' | 'bookmarks' | 'watchers' | 'feeds' | 'readaloud'

/** UI state shared by the independent local renderer surfaces in the native browser window. */
export interface BrowserChromeState {
  sidebarMode: BrowserSidebarMode
  sidebarPinned: boolean
  sidebarHovered: boolean
  sidebarFocused: boolean
  sidebarWidth: number
  sidebarResizing: boolean
}

export interface BrowserChromeMetrics {
  toolbarHeight: number
  toolbarExtent: number
  /** Toolbar → main: a popover is open (shared/popover-dismiss.ts). */
  popoverOpen?: boolean
  /** Main → toolbar: the window's content height, so popovers can cap themselves to it. */
  windowHeight?: number
}

export interface BrowserPreferencesSnapshot {
  uiFont: BrowserUiFont
  searchEngine: SearchEngineId
  tabSleepMinutes: TabSleepMinutes
  newTabPage: NewTabPageId
  newTabPreferences: NewTabPreferences
  pinnedSites: PinnedSite[]
  sidebarWidth: number
}

/** Browser-renderer coordinates for anchoring the Bramble launcher window. */
export interface BramblePopupAnchor {
  x: number
  y: number
  width: number
  height: number
}

export interface BrambleExtensionState {
  installed: boolean
  loading: boolean
  version: string | null
  latestVersion: string | null
  updateAvailable: boolean
  popupOpen: boolean
  error: string | null
  notice: string | null
  permissions: string[]
  hostPermissions: string[]
  iconDataUrl: string | null
}

export type NetworkRequestState = 'pending' | 'complete' | 'failed'

export interface NetworkHeader {
  name: string
  value: string
}

/** Safe-to-render row data emitted frequently while a request is in flight. */
export interface NetworkRequestSummary {
  id: string
  tabId: string
  url: string
  method: string
  resourceType: string
  status: number | null
  statusText: string
  mimeType: string
  startedAt: number
  durationMs: number | null
  transferSize: number | null
  responseBodyAvailable: boolean
  state: NetworkRequestState
  initiator: string
  errorText: string
  fromDiskCache: boolean
  fromServiceWorker: boolean
}

/** Full request metadata is fetched only when the user opens a request. */
export interface NetworkRequestDetails extends NetworkRequestSummary {
  requestHeaders: NetworkHeader[]
  responseHeaders: NetworkHeader[]
  requestBody: string | null
  requestBodyAvailable: boolean
  requestBodyTruncated: boolean
  remoteAddress: string
  protocol: string
  securityState: string
  timing: Record<string, number> | null
}

export interface NetworkResponseBody {
  text: string
  base64Encoded: boolean
  truncated: boolean
}

export type WebStoreExtensionCompatLevel = 'supported' | 'partial' | 'unsupported'

/** A Chrome Web Store extension installed in this Surffish profile. */
export interface WebStoreExtensionSummary {
  id: string
  name: string
  description: string
  version: string
  enabled: boolean
  /** Loaded into the browser session right now. */
  loaded: boolean
  iconDataUrl: string | null
  hasPopup: boolean
  hasOptions: boolean
  compatibility: WebStoreExtensionCompatLevel
  gaps: string[]
  shimmed: string[]
  permissions: string[]
  hostPermissions: string[]
  installedAt: number
  updatedAt: number
  error: string | null
}

export interface WebStoreExtensionsState {
  extensions: WebStoreExtensionSummary[]
  /** An install/update/uninstall is running. */
  busy: boolean
  busyId: string | null
  popupOpenId: string | null
  notice: string | null
  error: string | null
}

export interface DefaultBrowserStatus {
  /** Surffish handles both http and https links system-wide. */
  isDefault: boolean
  /** Only the packaged app can register; a dev build would register the bare Electron binary. */
  canSet: boolean
  platform: string
}
