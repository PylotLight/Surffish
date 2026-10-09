import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type {
  BrowserProxySettings,
  BrowserState,
  BrowserTabSummary,
  BrowsingHistoryEntry
} from '../../../shared/types'
import './Browser.css'

const DEFAULT_PROXY: BrowserProxySettings = { enabled: true, host: '127.0.0.1', port: 1080 }
const EMPTY_BROWSER: BrowserState = {
  url: 'https://duckduckgo.com/',
  title: 'DuckDuckGo',
  loading: true,
  canGoBack: false,
  canGoForward: false,
  error: null
}

type SidebarMode = 'tabs' | 'history'

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
  const addressRef = useRef<HTMLInputElement>(null)
  const [browser, setBrowser] = useState<BrowserState>(EMPTY_BROWSER)
  const [tabs, setTabs] = useState<BrowserTabSummary[]>([])
  const [history, setHistory] = useState<BrowsingHistoryEntry[]>([])
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('tabs')
  const [historyQuery, setHistoryQuery] = useState('')
  const [address, setAddress] = useState(EMPTY_BROWSER.url)
  const [proxy, setProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [appliedProxy, setAppliedProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [proxyOpen, setProxyOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [proxyMessage, setProxyMessage] = useState('')
  const [navigationError, setNavigationError] = useState('')
  const [proxyMessageIsError, setProxyMessageIsError] = useState(false)

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
    void window.api.browser.state().then((current) => {
      setBrowser(current)
      setAddress(current.url)
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
      unsubscribeFocusAddress()
    }
  }, [])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const updateBounds = (): void => {
      const rect = element.getBoundingClientRect()
      void window.api.browser.setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
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
  }, [])

  useEffect(() => {
    if (document.activeElement !== addressRef.current) setAddress(browser.url)
  }, [browser.url])

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 't' && !event.shiftKey) {
        event.preventDefault()
        void window.api.browser.tabs.create()
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
  }, [tabs])

  async function navigate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const value = address.trim()
    if (!value) return
    const ok = await window.api.browser.navigate(value)
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

  return (
    <section className="browser-layout" aria-label="Sockfish browser">
      <aside className="browser-sidebar" aria-label="Browser sidebar">
        <div className="sidebar-brand"><span className="sidebar-brand-mark" aria-hidden="true">S</span><strong>Sockfish</strong></div>
        <div className="sidebar-heading">
          <strong>{sidebarMode === 'tabs' ? 'Tabs' : 'History'}</strong>
          {sidebarMode === 'tabs' ? (
            <button className="sidebar-icon-button" type="button" aria-label="New tab" title="New tab (Ctrl/⌘+T)" onClick={() => { void window.api.browser.tabs.create() }}>
              <span aria-hidden="true">＋</span>
            </button>
          ) : (
            <button className="sidebar-icon-button" type="button" aria-label="Clear browsing history" title="Clear history" disabled={history.length === 0} onClick={() => void clearHistory()}>
              <span aria-hidden="true">⌫</span>
            </button>
          )}
        </div>

        {sidebarMode === 'tabs' ? (
          <div className="tab-list" role="tablist" aria-label="Open tabs" aria-orientation="vertical">
            {tabs.map((tab) => (
              <div
                className={`tab-item${tab.active ? ' is-active' : ''}`}
                key={tab.id}
                role="tab"
                aria-selected={tab.active}
                tabIndex={0}
                title={tab.title}
                onClick={() => { void window.api.browser.tabs.activate(tab.id) }}
                onKeyDown={(event) => selectTabOnKeyboard(event, tab.id)}
              >
                <span className={`tab-favicon${tab.loading ? ' is-loading' : ''}`} aria-hidden="true">{tab.loading ? '' : tab.title.slice(0, 1).toUpperCase()}</span>
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
        ) : (
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
        )}

        <div className="sidebar-footer">
          {sidebarMode === 'tabs' ? (
            <button className="sidebar-mode-button" type="button" onClick={() => { setSidebarMode('history'); void refreshHistory() }}>
              <span aria-hidden="true">◷</span><span>History</span>
            </button>
          ) : (
            <button className="sidebar-mode-button" type="button" onClick={() => setSidebarMode('tabs')}>
              <span aria-hidden="true">▤</span><span>Open tabs</span>
            </button>
          )}
        </div>
      </aside>

      <div className="browser-main">
        <header className="browser-chrome">
          <form className="browser-toolbar" onSubmit={(event) => void navigate(event)}>
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
              <span className="omnibox-shortcut" aria-hidden="true">{window.api.platform === 'darwin' ? '⌘L' : 'Ctrl L'}</span>
            </label>
            <button
              className={`proxy-chip${appliedProxy.enabled ? ' is-on' : ''}`}
              type="button"
              aria-expanded={proxyOpen}
              aria-controls="proxy-settings"
              onClick={() => setProxyOpen((open) => !open)}
              title="Configure SOCKS5 proxy"
            >
              <span className="proxy-dot" aria-hidden="true" />
              <span>SOCKS5</span>
            </button>
          </form>
          {proxyOpen && (
            <section className="proxy-panel" id="proxy-settings" aria-label="SOCKS5 proxy settings">
              <div className="proxy-panel-heading">
                <div>
                  <strong>Local SOCKS5 proxy</strong>
                  <p>{appliedProxy.enabled ? `SOCKS5 enabled · ${appliedProxy.host}:${appliedProxy.port}` : 'Direct connection'}</p>
                </div>
                <label className="proxy-toggle">
                  <input
                    type="checkbox"
                    checked={proxy.enabled}
                    onChange={(event) => setProxy((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  <span>Use proxy</span>
                </label>
              </div>
              <div className="proxy-fields">
                <label>
                  <span>Host</span>
                  <input
                    type="text"
                    value={proxy.host}
                    spellCheck={false}
                    onChange={(event) => setProxy((current) => ({ ...current, host: event.target.value }))}
                    aria-label="Local SOCKS5 host"
                  />
                </label>
                <label className="proxy-port">
                  <span>Port</span>
                  <input
                    type="number"
                    value={proxy.port}
                    min={1}
                    max={65535}
                    onChange={(event) => setProxy((current) => ({ ...current, port: Number(event.target.value) }))}
                    aria-label="Local SOCKS5 port"
                  />
                </label>
                <div className="proxy-actions">
                  <button className="toolbar-action secondary" type="button" disabled={busy} onClick={() => void testProxy()}>Test port</button>
                  <button className="toolbar-action primary" type="button" disabled={busy} onClick={() => void saveProxy()}>{busy ? 'Working…' : 'Save & apply'}</button>
                </div>
              </div>
              <p className="proxy-hint">Start an SSH tunnel locally first: <code>ssh -N -D 127.0.0.1:1080 user@your-ssh-host</code></p>
              {(proxyMessage || browser.error || navigationError) && (
                <p className={`proxy-message${proxyMessageIsError || browser.error || navigationError ? ' is-error' : ''}`} role="status">
                  {browser.error ? `Page load issue: ${browser.error}. Check the tunnel or turn the proxy off.` : navigationError || proxyMessage}
                </p>
              )}
            </section>
          )}
          {!proxyOpen && (browser.error || navigationError) && (
            <p className="browser-error" role="status">
              {browser.error ? `Page load issue: ${browser.error}. Check the tunnel or turn the proxy off.` : navigationError}
            </p>
          )}
        </header>
        <div className="browser-viewport" ref={viewportRef} aria-label="Web page area" />
      </div>
    </section>
  )
}
