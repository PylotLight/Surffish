/** Shared type-only contracts between the main, preload, and renderer processes. */
export type SearchEngineId = 'brave' | 'duckduckgo' | 'google' | 'bing'
export type TabSleepMinutes = 0 | 5 | 15 | 30 | 60
export type NewTabPageId = 'quick-links' | 'bonjourr' | 'search'

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

export interface NewTabPreferences {
  showClock: boolean
  showDate: boolean
  use24HourTime: boolean
  showSeconds: boolean
  timeZone: string
  worldClocks: WorldClockPreference[]
  weatherEnabled: boolean
  weatherLocation: string
  temperatureUnit: TemperatureUnit
  iconSize: number
  linksPerRow: number
  showLinkLabels: boolean
  backgroundDim: number
  backgroundBlur: number
  iconVerticalOffset: number
}

export interface NewTabWeatherSnapshot {
  location: string
  temperatureCelsius: number
  weatherCode: number
  description: string
  fetchedAt: number
}

export interface PinnedSite {
  title: string
  url: string
}

/** Effective per-origin privacy choices; permissions are denied unless explicitly allowed. */
export interface BrowserSiteSettings {
  origin: string
  blockAds: boolean
  openPopupsInTabs: boolean
  allowMedia: boolean
  allowGeolocation: boolean
  allowNotifications: boolean
}

export interface BrowserProxySettings {
  enabled: boolean
  host: string
  port: number
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
}
export interface BrowserTabSummary {
  id: string
  url: string
  title: string
  faviconUrl: string | null
  loading: boolean
  active: boolean
  sleeping: boolean
}
export interface BrowsingHistoryEntry {
  id: string
  url: string
  title: string
  visitedAt: number
}
export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserSidebarMode = 'tabs' | 'history' | 'settings' | 'network' | 'site' | 'downloads'

/** UI state shared by the independent local renderer surfaces in the native browser window. */
export interface BrowserChromeState {
  sidebarMode: BrowserSidebarMode
  sidebarPinned: boolean
  sidebarHovered: boolean
  sidebarFocused: boolean
}

export interface BrowserChromeMetrics {
  toolbarHeight: number
  toolbarExtent: number
}

export interface BrowserPreferencesSnapshot {
  searchEngine: SearchEngineId
  tabSleepMinutes: TabSleepMinutes
  newTabPage: NewTabPageId
  newTabPreferences: NewTabPreferences
  pinnedSites: PinnedSite[]
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

export interface AdblockBlockedRequest {
  timestamp: number
  requestHost: string
  pageHost: string
  resourceType: string
}

export interface AdblockDiagnostics {
  status: 'starting' | 'active' | 'updating' | 'degraded'
  blockingEnabled: boolean
  source: 'none' | 'updated' | 'cache' | 'stale-cache' | 'empty'
  lastUpdatedAt: number | null
  blockedRequests: number
  allowedRequests: number
  networkFilterCount: number
  /** Element-hiding and scriptlet rules loaded in the engine. */
  cosmeticFilterCount: number
  /** Scriptlets (uBO `+js` page fixes, e.g. YouTube ad removal) injected since launch. */
  pageFixInjections: number
  loadedListCount: number
  loadedLists: string[]
  recentBlockedRequests: AdblockBlockedRequest[]
  lastError: string | null
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
