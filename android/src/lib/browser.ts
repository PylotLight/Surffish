/**
 * Browser state: tabs, active tab, closed-tab stack, pending prompts. A tiny external store
 * (useSyncExternalStore) so GeckoView events at 60 Hz don't re-render the whole tree.
 *
 * Native GeckoSessions are created lazily: restored tabs only get a session when first shown,
 * a fresh New Tab only when you navigate somewhere.
 */
import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { Gecko, addGeckoListener, type GeckoEvents, type LaunchIntent } from '../../modules/gecko-view'
import * as db from './db'
import { DEFAULT_CUSTOM_SEARCH_ENGINES, DEFAULT_SEARCH_ENGINE, isSearchEngineId, parseKeywordSearch, resolveNavigationTarget, type SearchEngineId } from './shared'
import { uuidv7 } from './sync-clock'

export interface Tab {
  id: string
  url: string
  title: string
  progress: number
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  secure: boolean
  host: string
  issuer: string | null
  mixed: boolean
  private: boolean
  desktop: boolean
  thumbnail: string | null
  openerId: string | null
  /** Saved Gecko session state (back/forward history) to restore when the session is created. */
  restoreState: string | null
  native: boolean
  crashed: boolean
}

export interface ClosedTab {
  url: string
  title: string
  state: string | null
  index: number
  desktop: boolean
}

export interface PermissionRequest extends Omit<GeckoEvents['onPermissionRequest'], 'uri'> {
  uri: string
}

export interface Settings {
  searchEngine: SearchEngineId
  remoteSuggestions: boolean
  ublockInstalled: boolean
  /** "socks5://host:port" or "" (stretch: not wired to Gecko yet) */
  proxy: string
}

export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

export interface BrowserState {
  ready: boolean
  tabs: Tab[]
  activeId: string | null
  closed: ClosedTab[]
  fullScreen: boolean
  permissions: PermissionRequest[]
  /** granted this session, per host: shown in the site info sheet */
  granted: Record<string, string[]>
  contextMenu: GeckoEvents['onContextMenu'] | null
  installPrompt: GeckoEvents['onExtensionInstallPrompt'] | null
  popup: GeckoEvents['onExtensionPopup'] | null
  extensionActions: Record<string, GeckoEvents['onExtensionAction']>
  extensionsVersion: number
  settings: Settings
  toast: Toast | null
  /** bumps when the address bar should take focus (new tab, share intent text, ...) */
  focusAddressBar: number
}

const defaultSettings: Settings = { searchEngine: DEFAULT_SEARCH_ENGINE, remoteSuggestions: true, ublockInstalled: false, proxy: '' }

let state: BrowserState = {
  ready: false,
  tabs: [],
  activeId: null,
  closed: [],
  fullScreen: false,
  permissions: [],
  granted: {},
  contextMenu: null,
  installPrompt: null,
  popup: null,
  extensionActions: {},
  extensionsVersion: 0,
  settings: defaultSettings,
  toast: null,
  focusAddressBar: 0
}

const listeners = new Set<() => void>()

function set(patch: Partial<BrowserState> | ((s: BrowserState) => Partial<BrowserState>)) {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function patchTab(id: string, patch: Partial<Tab>) {
  if (!state.tabs.some((t) => t.id === id)) return
  set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
}

export function getState(): BrowserState {
  return state
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useBrowser<T>(selector: (s: BrowserState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state))
}

export function activeTab(s: BrowserState = state): Tab | null {
  return s.tabs.find((t) => t.id === s.activeId) ?? null
}

function blankTab(id: string, partial: Partial<Tab> = {}): Tab {
  return {
    id,
    url: '',
    title: '',
    progress: 0,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    secure: false,
    host: '',
    issuer: null,
    mixed: false,
    private: false,
    desktop: false,
    thumbnail: null,
    openerId: null,
    restoreState: null,
    native: false,
    crashed: false,
    ...partial
  }
}

// ------------------------------------------------------------------ toast

let toastSeq = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null

export function showToast(text: string, action?: Toast['action']) {
  toastSeq += 1
  set({ toast: { id: toastSeq, text, action } })
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => set({ toast: null }), action ? 5000 : 2500)
}

export function dismissToast() {
  set({ toast: null })
}

// ------------------------------------------------------------------ settings

export function updateSettings(patch: Partial<Settings>) {
  const next = { ...state.settings, ...patch }
  set({ settings: next })
  for (const [key, value] of Object.entries(patch)) db.setSetting(`android.${key}`, value, key === 'ublockInstalled' ? 'device' : 'synced')
}

function loadSettings(): Settings {
  const engine = db.getSetting<string>('android.searchEngine', DEFAULT_SEARCH_ENGINE)
  return {
    searchEngine: isSearchEngineId(engine) ? engine : DEFAULT_SEARCH_ENGINE,
    remoteSuggestions: db.getSetting('android.remoteSuggestions', true),
    ublockInstalled: db.getSetting('android.ublockInstalled', false),
    proxy: db.getSetting('android.proxy', '')
  }
}

// ------------------------------------------------------------------ navigation

/** Address bar input -> url (keywords/!bangs first, then desktop's resolver). */
export function resolveInput(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  if (/^(about:|moz-extension:\/\/)/i.test(value)) return value
  const keyword = parseKeywordSearch(value, DEFAULT_CUSTOM_SEARCH_ENGINES)
  if (keyword) return keyword.url
  return resolveNavigationTarget(value, state.settings.searchEngine)
}

async function ensureNative(tab: Tab, url: string | null): Promise<void> {
  if (tab.native) {
    if (url) await Gecko.load(tab.id, url)
    return
  }
  patchTab(tab.id, { native: true, restoreState: null })
  await Gecko.createTab(tab.id, tab.private, tab.desktop, url ?? (tab.restoreState ? null : tab.url || null), url ? null : tab.restoreState)
}

export async function navigate(input: string, tabId: string | null = state.activeId) {
  const url = resolveInput(input)
  if (!url) {
    showToast('That address can\u2019t be opened')
    return
  }
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab) {
    newTab(url)
    return
  }
  patchTab(tab.id, { url, loading: true, progress: 5 })
  await ensureNative(tab, url)
}

export function newTab(url: string | null = null, opts: { private?: boolean; activate?: boolean; openerId?: string | null; nativeId?: string } = {}): string {
  const id = opts.nativeId ?? `t-${uuidv7()}`
  const opener = opts.openerId ? state.tabs.find((t) => t.id === opts.openerId) : null
  const tab = blankTab(id, { url: url ?? '', private: opts.private ?? false, openerId: opts.openerId ?? null, native: !!opts.nativeId, loading: !!url })
  set((s) => {
    const tabs = [...s.tabs]
    const at = opener ? tabs.indexOf(opener) + 1 : tabs.length
    tabs.splice(at, 0, tab)
    return {
      tabs,
      activeId: opts.activate === false ? s.activeId : id,
      focusAddressBar: !url && opts.activate !== false ? s.focusAddressBar + 1 : s.focusAddressBar
    }
  })
  if (url && !opts.nativeId) void ensureNative(tab, url)
  schedulePersist()
  return id
}

export async function selectTab(id: string) {
  if (id === state.activeId) return
  const current = activeTab()
  if (current?.native) void captureThumbnail(current.id)
  set({ activeId: id, fullScreen: false })
  const tab = state.tabs.find((t) => t.id === id)
  if (tab && !tab.native && (tab.url || tab.restoreState)) await ensureNative(tab, null)
  schedulePersist()
}

export async function captureThumbnail(id: string) {
  try {
    const uri = await Gecko.captureThumbnail(id)
    if (uri) patchTab(id, { thumbnail: uri })
  } catch {
    /* view not showing this tab */
  }
}

export function closeTab(id: string, opts: { silent?: boolean } = {}) {
  const index = state.tabs.findIndex((t) => t.id === id)
  if (index < 0) return
  const tab = state.tabs[index]!
  void Gecko.closeTab(id)
  set((s) => {
    const tabs = s.tabs.filter((t) => t.id !== id)
    let activeId = s.activeId
    if (activeId === id) {
      const opener = tab.openerId ? tabs.find((t) => t.id === tab.openerId) : null
      activeId = opener?.id ?? tabs[Math.min(index, tabs.length - 1)]?.id ?? null
    }
    const closed = tab.private || !tab.url ? s.closed : [{ url: tab.url, title: tab.title, state: null, index, desktop: tab.desktop }, ...s.closed].slice(0, 25)
    return { tabs, activeId, closed, fullScreen: activeId === s.activeId ? s.fullScreen : false }
  })
  const next = activeTab()
  if (next && !next.native && (next.url || next.restoreState)) void ensureNative(next, null)
  if (!opts.silent && !tab.private && tab.url) showToast('Tab closed', { label: 'Undo', run: () => restoreClosedTab() })
  schedulePersist()
}

export function closeAllTabs(privateOnly = false) {
  for (const t of [...state.tabs]) if (!privateOnly || t.private) closeTab(t.id, { silent: true })
}

export function restoreClosedTab() {
  const [last, ...rest] = state.closed
  if (!last) return
  set({ closed: rest })
  const id = `t-${uuidv7()}`
  const tab = blankTab(id, { url: last.url, title: last.title, desktop: last.desktop, loading: true })
  set((s) => {
    const tabs = [...s.tabs]
    tabs.splice(Math.min(last.index, tabs.length), 0, tab)
    return { tabs, activeId: id }
  })
  void ensureNative(tab, last.url)
  schedulePersist()
}

export function goBack() { const t = activeTab(); if (t?.native) void Gecko.goBack(t.id) }
export function goForward() { const t = activeTab(); if (t?.native) void Gecko.goForward(t.id) }
export function reload() {
  const t = activeTab()
  if (!t) return
  if (t.loading && t.native) void Gecko.stop(t.id)
  else if (t.native) void Gecko.reload(t.id)
  else if (t.url) void ensureNative(t, t.url)
}

export function toggleDesktop() {
  const t = activeTab()
  if (!t) return
  patchTab(t.id, { desktop: !t.desktop })
  if (t.native) void Gecko.setDesktopMode(t.id, !t.desktop)
  schedulePersist()
}

// ------------------------------------------------------------------ prompts

export function answerPermission(requestId: string, allow: boolean) {
  const req = state.permissions.find((p) => p.requestId === requestId)
  void Gecko.resolvePermission(requestId, allow)
  set((s) => {
    const permissions = s.permissions.filter((p) => p.requestId !== requestId)
    if (!req || !allow) return { permissions }
    const host = hostOf(req.uri)
    const list = new Set([...(s.granted[host] ?? []), req.kind])
    return { permissions, granted: { ...s.granted, [host]: [...list] } }
  })
}

export function answerInstall(allow: boolean, allowPrivate: boolean) {
  const p = state.installPrompt
  if (!p) return
  void Gecko.resolveInstallPrompt(p.requestId, allow, allowPrivate)
  set({ installPrompt: null })
}

export function closeContextMenu() { set({ contextMenu: null }) }
export function closePopup() {
  const p = state.popup
  if (p) void Gecko.closeTab(p.tabId)
  set({ popup: null })
}
export function setFullScreen(on: boolean) {
  set({ fullScreen: on })
  void Gecko.setImmersive(on)
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

// ------------------------------------------------------------------ persistence

let persistTimer: ReturnType<typeof setTimeout> | null = null
let sessionStates: Record<string, string> = {}

function schedulePersist() {
  if (!state.ready) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(persistNow, 800)
}

function persistNow() {
  persistTimer = null
  try {
    const rows = state.tabs
      .filter((t) => !t.private && (t.url || t.restoreState))
      .map((t, position) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        position,
        active: t.id === state.activeId,
        state: sessionStates[t.id] ?? t.restoreState ?? null,
        desktop: t.desktop
      }))
    db.saveSessionTabs(rows)
  } catch (e) {
    console.warn('persist failed', e)
  }
}

async function persistWithStates() {
  try {
    sessionStates = await Gecko.getSessionStates()
  } catch {
    /* keep old */
  }
  persistNow()
}

// ------------------------------------------------------------------ intents

export function handleIntent(intent: LaunchIntent | null) {
  if (!intent) return
  if (intent.url) {
    newTab(intent.url)
    return
  }
  const text = intent.text?.trim()
  if (!text) return
  // Shared text often wraps a link ("Look at this https://...").
  const link = /https?:\/\/[^\s<>"']+/i.exec(text)?.[0]
  newTab(resolveInput(link ?? text))
}

// ------------------------------------------------------------------ init

let started = false

export async function startBrowser() {
  if (started) return
  started = true
  set({ settings: loadSettings() })
  wireEvents()
  await Gecko.init()
  const saved = db.loadSessionTabs()
  const tabs = saved.map((r) => blankTab(r.id, { url: r.url, title: r.title, desktop: r.desktop, restoreState: r.state }))
  const active = saved.find((r) => r.active)?.id ?? tabs[tabs.length - 1]?.id ?? null
  set({ tabs, activeId: active, ready: true })
  const first = activeTab()
  if (first) await ensureNative(first, null)
  handleIntent(await Gecko.consumeLaunchIntent())
  if (state.tabs.length === 0) newTab(null)
  AppState.addEventListener('change', (s) => {
    if (s !== 'active') void persistWithStates()
  })
  if (!state.settings.ublockInstalled) {
    Gecko.ensureUblock()
      .then((installed) => {
        updateSettings({ ublockInstalled: true })
        if (installed) showToast('uBlock Origin is on')
        set((s) => ({ extensionsVersion: s.extensionsVersion + 1 }))
      })
      .catch(() => showToast('Couldn\u2019t install uBlock Origin yet, will retry next launch'))
  }
}

function wireEvents() {
  addGeckoListener('onLocationChange', ({ tabId, url }) => {
    const tab = state.tabs.find((t) => t.id === tabId)
    if (!tab) return
    patchTab(tabId, { url, crashed: false })
    if (!tab.private && /^https?:/i.test(url)) db.recordVisit(url, '')
    schedulePersist()
  })
  addGeckoListener('onTitleChange', ({ tabId, title }) => {
    const tab = state.tabs.find((t) => t.id === tabId)
    if (!tab) return
    patchTab(tabId, { title })
    if (!tab.private) db.updateVisitTitle(tab.url, title)
    schedulePersist()
  })
  addGeckoListener('onProgress', ({ tabId, progress }) => patchTab(tabId, { progress }))
  addGeckoListener('onPageStart', ({ tabId }) => patchTab(tabId, { loading: true, progress: 5 }))
  addGeckoListener('onPageStop', ({ tabId }) => {
    patchTab(tabId, { loading: false, progress: 100 })
    if (tabId === state.activeId) setTimeout(() => void captureThumbnail(tabId), 600)
  })
  addGeckoListener('onNavState', ({ tabId, canGoBack, canGoForward }) => patchTab(tabId, { canGoBack, canGoForward }))
  addGeckoListener('onSecurity', ({ tabId, secure, host, issuer, mixed }) => patchTab(tabId, { secure, host, issuer, mixed }))
  addGeckoListener('onFullScreen', ({ tabId, fullScreen }) => {
    if (tabId === state.activeId) setFullScreen(fullScreen)
  })
  addGeckoListener('onContextMenu', (e) => set({ contextMenu: e }))
  addGeckoListener('onNewTabRequest', (e) => {
    newTab(e.url || null, { nativeId: e.tabId, private: e.private, openerId: e.openerTabId, activate: e.active !== false })
    patchTab(e.tabId, { url: e.url, loading: true })
  })
  addGeckoListener('onCloseTabRequest', ({ tabId }) => closeTab(tabId, { silent: true }))
  addGeckoListener('onSelectTabRequest', ({ tabId }) => void selectTab(tabId))
  addGeckoListener('onPermissionRequest', (e) => set((s) => ({ permissions: [...s.permissions, e] })))
  addGeckoListener('onDownload', ({ filename, status, error }) => {
    if (status === 'started') showToast(`Downloading ${filename}`)
    else if (status === 'done') showToast(`Saved ${filename} to Downloads`)
    else showToast(`Download failed${error ? `: ${error}` : ''}`)
  })
  addGeckoListener('onExtensionsChanged', () => set((s) => ({ extensionsVersion: s.extensionsVersion + 1 })))
  addGeckoListener('onExtensionPopup', (e) => set({ popup: e }))
  addGeckoListener('onExtensionAction', (e) => {
    if (e.tabId) return
    set((s) => ({ extensionActions: { ...s.extensionActions, [e.id]: e } }))
  })
  addGeckoListener('onExtensionInstallPrompt', (e) => set({ installPrompt: e }))
  addGeckoListener('onCrash', ({ tabId }) => patchTab(tabId, { crashed: true, loading: false }))
  addGeckoListener('onIntent', (intent) => handleIntent(intent))
  addGeckoListener('onOpenUrl', ({ url }) => newTab(url))
}
