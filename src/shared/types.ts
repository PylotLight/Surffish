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
  faviconUrl?: string
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
  /** The active tab is a private tab. */
  private: boolean
  /** Page zoom of the active tab (1 = 100%). */
  zoomFactor: number
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
  /** Tab is currently producing sound (Chromium's audible state, ~ignores silent media). */
  audible: boolean
  /** Tab audio is muted by the user. */
  muted: boolean
  /** Private tab: in-memory session, nothing saved. */
  private: boolean
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

export type BrowserSidebarMode = 'tabs' | 'history' | 'settings' | 'newtab' | 'integrations' | 'network' | 'site' | 'downloads'

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
}

export interface BrowserPreferencesSnapshot {
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
