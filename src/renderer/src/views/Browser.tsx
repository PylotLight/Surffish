import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { BrowserProxySettings, BrowserState } from '../../../shared/types'
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

export default function Browser(): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const [browser, setBrowser] = useState<BrowserState>(EMPTY_BROWSER)
  const [address, setAddress] = useState(EMPTY_BROWSER.url)
  const [proxy, setProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [appliedProxy, setAppliedProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [proxyOpen, setProxyOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [proxyMessage, setProxyMessage] = useState('')
  const [navigationError, setNavigationError] = useState('')
  const [proxyMessageIsError, setProxyMessageIsError] = useState(false)

  useEffect(() => {
    const unsubscribe = window.api.browser.onState(setBrowser)
    const unsubscribeFocusAddress = window.api.browser.onFocusAddress(() => {
      addressRef.current?.focus()
      addressRef.current?.select()
    })
    void window.api.browser.state().then((current) => {
      setBrowser(current)
      setAddress(current.url)
    })
    void window.api.browser.proxy.get().then((settings) => {
      setProxy(settings)
      setAppliedProxy(settings)
    })
    return () => {
      unsubscribe()
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
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        addressRef.current?.focus()
        addressRef.current?.select()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

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

  return (
    <section className="browser-layout" aria-label="Sockfish browser">
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
                <button className="toolbar-action secondary" type="button" disabled={busy} onClick={() => void testProxy()}>
                  Test port
                </button>
                <button className="toolbar-action primary" type="button" disabled={busy} onClick={() => void saveProxy()}>
                  {busy ? 'Working…' : 'Save & apply'}
                </button>
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
    </section>
  )
}
