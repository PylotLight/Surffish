import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type {
  BrowserProxySettings,
  BrowserState,
  BrowserTabSummary,
  BrowsingHistoryEntry,
  SearchEngineId,
  TabSleepMinutes
} from '../../../shared/types'
import { DEFAULT_SEARCH_ENGINE, getSearchHomepage, SEARCH_ENGINES } from '../../../shared/navigation'
import './Browser.css'

const DEFAULT_PROXY: BrowserProxySettings = { enabled: true, host: '127.0.0.1', port: 1080 }
const EMPTY_BROWSER: BrowserState = {
  url: getSearchHomepage(DEFAULT_SEARCH_ENGINE),
  title: 'Brave Search',
  loading: true,
  canGoBack: false,
  canGoForward: false,
  error: null
}

type SidebarMode = 'tabs' | 'history' | 'settings'

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

export default function Browser(): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const browserChromeRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarToggleRef = useRef<HTMLButtonElement>(null)
  const sidebarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const newTabControlRef = useRef<HTMLDivElement>(null)
  const [browser, setBrowser] = useState<BrowserState>(EMPTY_BROWSER)
  const [tabs, setTabs] = useState<BrowserTabSummary[]>([])
  const [history, setHistory] = useState<BrowsingHistoryEntry[]>([])
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('tabs')
  const [sidebarPinned, setSidebarPinned] = useState(false)
  const [sidebarHovered, setSidebarHovered] = useState(false)
  const [sidebarFocused, setSidebarFocused] = useState(false)
  const [browserChromeHeight, setBrowserChromeHeight] = useState(window.api.platform === 'darwin' ? 73 : 45)
  const [historyQuery, setHistoryQuery] = useState('')
  const [address, setAddress] = useState(EMPTY_BROWSER.url)
  const [searchEngine, setSearchEngine] = useState<SearchEngineId>(DEFAULT_SEARCH_ENGINE)
  const [tabSleepMinutes, setTabSleepMinutes] = useState<TabSleepMinutes>(30)
  const [searchEngineLoaded, setSearchEngineLoaded] = useState(false)
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false)
  const [proxy, setProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [appliedProxy, setAppliedProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [busy, setBusy] = useState(false)
  const [proxyMessage, setProxyMessage] = useState('')
  const [navigationError, setNavigationError] = useState('')
  const [proxyMessageIsError, setProxyMessageIsError] = useState(false)
  const sidebarVisible = sidebarPinned || sidebarHovered || sidebarFocused || sidebarMode === 'settings'

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

  useEffect(() => {
    const unsubscribeState = window.api.browser.onState(setBrowser)
    const unsubscribeTabs = window.api.browser.tabs.onChange(setTabs)
    const unsubscribeHistory = window.api.browser.history.onChange(() => { void refreshHistory() })
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
    void window.api.browser.getTabSleepMinutes().then(setTabSleepMinutes)
    void window.api.browser.proxy.get().then((settings) => {
      setProxy(settings)
      setAppliedProxy(settings)
    })
    return () => {
      unsubscribeState()
      unsubscribeTabs()
      unsubscribeHistory()
      unsubscribeFocusAddress()
    }
  }, [])

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
      const contentWidth = rect.width - sidebarInset
      const canShow = sidebarMode !== 'settings' && contentWidth > 0 && rect.height > 0
      void window.api.browser.setBounds(canShow
        ? { x: rect.left + sidebarInset, y: rect.top, width: contentWidth, height: rect.height }
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
  }, [sidebarMode, sidebarVisible])

  useEffect(() => {
    if (document.activeElement !== addressRef.current) setAddress(browser.url)
  }, [browser.url])

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 't' && !event.shiftKey) {
        event.preventDefault()
        void window.api.browser.tabs.create(undefined, searchEngine)
        setSidebarMode('tabs')
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

  async function navigate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const value = address.trim()
    if (!value) return
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
  const activeSleepingTab = tabs.find((tab) => tab.active && tab.sleeping)

  return (
    <section className={`browser-layout${sidebarVisible ? ' is-sidebar-visible' : ''}`} aria-label="Sockfish browser">
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
          <strong>{sidebarMode === 'history' ? 'History' : 'Tabs'}</strong>
          {sidebarMode !== 'history' ? (
            <div className="new-tab-control" ref={newTabControlRef}>
              <button className="sidebar-icon-button" type="button" aria-label="New tab" title="New tab (Ctrl/⌘+T); Alt-click for options" onClick={(event) => {
                if (event.altKey) {
                  setNewTabMenuOpen((open) => !open)
                  return
                }
                setNewTabMenuOpen(false)
                void window.api.browser.tabs.create(undefined, searchEngine)
              }}>
                <span aria-hidden="true">＋</span>
              </button>
              {newTabMenuOpen && (
                <div className="new-tab-menu" role="menu" aria-label="New tab options">
                  <button type="button" role="menuitem" onClick={() => {
                    void window.api.browser.tabs.create(undefined, searchEngine)
                    setNewTabMenuOpen(false)
                  }}>
                    <strong>New tab</strong><span>{SEARCH_ENGINES.find((engine) => engine.id === searchEngine)?.label} start page</span>
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
          <button className={`sidebar-mode-button${sidebarMode === 'tabs' ? ' is-current' : ''}`} type="button" aria-label="Tabs" title="Tabs" aria-current={sidebarMode === 'tabs' ? 'page' : undefined} onClick={() => setSidebarMode('tabs')}>
            <span aria-hidden="true">▤</span><span>Tabs</span>
          </button>
          <button className={`sidebar-mode-button${sidebarMode === 'history' ? ' is-current' : ''}`} type="button" aria-label="History" title="History" aria-current={sidebarMode === 'history' ? 'page' : undefined} onClick={() => { setSidebarMode('history'); void refreshHistory() }}>
            <span aria-hidden="true">◷</span><span>History</span>
          </button>
          <button className={`sidebar-mode-button${sidebarMode === 'settings' ? ' is-current' : ''}`} type="button" aria-label="Settings" title="Settings" aria-current={sidebarMode === 'settings' ? 'page' : undefined} onClick={() => setSidebarMode('settings')}>
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
                className="toolbar-button"
                type="button"
                aria-label={browser.loading ? 'Stop loading' : 'Reload page'}
                title={browser.loading ? 'Stop' : 'Reload'}
                onClick={() => void (browser.loading ? window.api.browser.stop() : window.api.browser.reload())}
              >
                <span aria-hidden="true">{browser.loading ? '×' : '↻'}</span>
              </button>
            </div>
            <label className="omnibox">
              <span className={`omnibox-mark${browser.url.startsWith('https://') ? ' secure' : ''}`} aria-hidden="true">
                {browser.url.startsWith('https://') ? '●' : '⌕'}
              </span>
              <input
                ref={addressRef}
                type="text"
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value)
                  setNavigationError('')
                }}
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Search or enter address"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                placeholder="Search or enter address"
              />
            </label>
          </form>
          {(browser.error || navigationError) && (
            <p className="browser-error" role="status">
              {browser.error ? `Page load issue: ${browser.error}. Check the tunnel or turn the proxy off.` : navigationError}
            </p>
          )}
        </header>
        <div className="browser-viewport" ref={viewportRef} aria-label={sidebarMode === 'settings' ? 'Settings content' : 'Web page area'}>
          {sidebarMode === 'settings' && (
            <div className="settings-view">
              <header className="settings-page-header">
                <h1>Settings</h1>
                <p>Choose your search engine and manage this browser’s connection.</p>
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
                  <p className="settings-help">New background tabs stay unloaded until selected; restored tabs stay unloaded until selected or resumed. Loaded tabs keep playing media when you switch away, and audible tabs stay awake while playing. Hibernated tabs reload their last page; unsaved forms and in-page state are cleared.</p>
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
          {sidebarMode !== 'settings' && activeSleepingTab && (
            <div className="sleeping-tab-prompt">
              <span className="sleeping-tab-mark" aria-hidden="true">Z</span>
              <strong>Tab unloaded to prevent autoplay</strong>
              <p>This page stays unloaded until you choose to load or resume it.</p>
              <button className="settings-action primary" type="button" onClick={() => void window.api.browser.tabs.activate(activeSleepingTab.id)}>Load page</button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
