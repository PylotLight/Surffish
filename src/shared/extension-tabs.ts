/**
 * Pure helpers behind the chrome.tabs shim for Web Store extension popups/options pages:
 * Chrome match patterns, tabs.query filtering, URL visibility (tabs / activeTab / host access),
 * and which URLs an extension may open. No Electron imports.
 */

/** Surffish's view of a tab, as the main process hands it to the shim. */
export interface ExtensionTabRecord {
  id: number
  index: number
  active: boolean
  pinned: boolean
  url: string
  title: string
  faviconUrl: string | null
  loading: boolean
  sleeping: boolean
}

/** The chrome.tabs.Tab subset the shim returns. */
export interface ChromeTabLike {
  id: number
  index: number
  windowId: number
  active: boolean
  highlighted: boolean
  selected: boolean
  pinned: boolean
  incognito: false
  discarded: boolean
  autoDiscardable: true
  groupId: -1
  status: 'loading' | 'complete' | 'unloaded'
  url?: string
  title?: string
  favIconUrl?: string
}

export interface ExtensionAccess {
  permissions: readonly string[]
  hostPermissions: readonly string[]
}

export const SURFFISH_EXTENSION_WINDOW_ID = 1

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

/** Chrome match-pattern test (https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns). */
export function matchesChromePattern(pattern: string, candidate: string): boolean {
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return false
  }
  if (pattern === '<all_urls>') return ['http:', 'https:', 'file:', 'ws:', 'wss:', 'ftp:'].includes(url.protocol)
  const match = /^(\*|https?|wss?|file|ftp|urn|chrome-extension):\/\/(\*|\*\.[^/*]+|[^/*]*)(\/.*)$/.exec(pattern)
  if (!match) return false
  const [, scheme, host, path] = match as unknown as [string, string, string, string]
  const protocol = url.protocol.slice(0, -1)
  if (scheme === '*' ? protocol !== 'http' && protocol !== 'https' : protocol !== scheme) return false
  const hostname = url.hostname.toLowerCase()
  if (host !== '*') {
    if (host.startsWith('*.')) {
      const base = host.slice(2).toLowerCase()
      if (hostname !== base && !hostname.endsWith(`.${base}`)) return false
    } else if (hostname !== host.toLowerCase()) {
      return false
    }
  }
  const pathRegex = new RegExp(`^${path.split('*').map(escapeRegex).join('.*')}$`)
  return pathRegex.test(`${url.pathname}${url.search}`)
}

function asList(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function globMatch(glob: string, value: string): boolean {
  return new RegExp(`^${glob.split('*').map(escapeRegex).join('.*')}$`, 'i').test(value)
}

/** chrome.tabs.query filtering over Surffish's single window. Unknown keys are ignored. */
export function filterTabsForQuery(tabs: readonly ExtensionTabRecord[], query: unknown): ExtensionTabRecord[] {
  const info = typeof query === 'object' && query !== null ? query as Record<string, unknown> : {}
  return tabs.filter((tab) => {
    if (typeof info.active === 'boolean' && tab.active !== info.active) return false
    if (typeof info.highlighted === 'boolean' && tab.active !== info.highlighted) return false
    if (typeof info.pinned === 'boolean' && tab.pinned !== info.pinned) return false
    if (typeof info.discarded === 'boolean' && tab.sleeping !== info.discarded) return false
    if (typeof info.index === 'number' && tab.index !== info.index) return false
    if (typeof info.windowId === 'number' && info.windowId >= 0 && info.windowId !== SURFFISH_EXTENSION_WINDOW_ID) return false
    if (info.status === 'loading' && !tab.loading) return false
    if (info.status === 'complete' && (tab.loading || tab.sleeping)) return false
    if (info.status === 'unloaded' && !tab.sleeping) return false
    if (typeof info.title === 'string' && !globMatch(info.title, tab.title)) return false
    const patterns = asList(info.url)
    if (patterns.length > 0 && !patterns.some((pattern) => matchesChromePattern(pattern, tab.url))) return false
    return true
  })
}

/** Whether Chrome would expose `url`/`title` of this tab to the extension. */
export function canSeeTabDetails(access: ExtensionAccess, tab: ExtensionTabRecord): boolean {
  if (access.permissions.includes('tabs')) return true
  // The popup opened from a toolbar click: activeTab grants the active tab.
  if (access.permissions.includes('activeTab') && tab.active) return true
  return [...access.hostPermissions, ...access.permissions.filter((entry) => entry.includes('://') || entry === '<all_urls>')]
    .some((pattern) => matchesChromePattern(pattern, tab.url))
}

export function toChromeTab(tab: ExtensionTabRecord, access: ExtensionAccess): ChromeTabLike {
  const visible = canSeeTabDetails(access, tab)
  return {
    id: tab.id,
    index: tab.index,
    windowId: SURFFISH_EXTENSION_WINDOW_ID,
    active: tab.active,
    highlighted: tab.active,
    selected: tab.active,
    pinned: tab.pinned,
    incognito: false,
    discarded: tab.sleeping,
    autoDiscardable: true,
    groupId: -1,
    status: tab.sleeping ? 'unloaded' : tab.loading ? 'loading' : 'complete',
    ...(visible ? { url: tab.url, title: tab.title } : {}),
    ...(visible && tab.faviconUrl && !tab.faviconUrl.startsWith('data:') ? { favIconUrl: tab.faviconUrl } : {})
  }
}

/** URLs an extension page may open or navigate a tab to: http(s) pages and its own pages. */
export function isAllowedExtensionTabUrl(candidate: unknown, extensionId: string): candidate is string {
  if (typeof candidate !== 'string') return false
  try {
    const url = new URL(candidate)
    if (url.username || url.password) return false
    if (url.protocol === 'http:' || url.protocol === 'https:') return true
    return url.protocol === 'chrome-extension:' && url.hostname === extensionId && !url.port
  } catch {
    return false
  }
}

/** What a browser window looks like when an extension asks to bring one of its tabs forward. */
export interface ExtensionRevealWindowState {
  /** The window's sidebar mode: anything but 'tabs' is a panel drawn over (or beside) the page. */
  sidebarMode: string
  minimized: boolean
  visible: boolean
}

/** The steps that put a tab in front of the user. */
export interface ExtensionTabRevealPlan {
  /** Close Settings / Downloads / Bookmarks / History so the tab's page is what the window shows. */
  closePanel: boolean
  restore: boolean
  show: boolean
  focus: true
}

/**
 * runtime.openOptionsPage, or tabs.update/create with active: true, from an extension page: Chrome
 * switches to the tab and its window comes forward (focusing an already open options page instead of
 * doing nothing). Surffish shows one window to extensions, so the tab's own window always gets focus.
 * A Settings or Downloads panel would otherwise keep covering the page, so it closes, the way clicking
 * a tab in the sidebar closes it.
 */
export function planExtensionTabReveal(window: ExtensionRevealWindowState): ExtensionTabRevealPlan {
  return {
    closePanel: window.sidebarMode !== 'tabs',
    restore: window.minimized,
    show: window.minimized || !window.visible,
    focus: true
  }
}
