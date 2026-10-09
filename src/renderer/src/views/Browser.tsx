import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { BrowserProxySettings, BrowserState } from '../../../shared/types'
import './Browser.css'

const DEFAULT_PROXY: BrowserProxySettings = { enabled: true, host: '127.0.0.1', port: 1080 }
const EMPTY_BROWSER: BrowserState = {
  url: 'https://example.com/',
  title: 'Fish Browser',
  loading: true,
  canGoBack: false,
  canGoForward: false,
  error: null
}

export default function Browser(): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [browser, setBrowser] = useState<BrowserState>(EMPTY_BROWSER)
  const [address, setAddress] = useState(EMPTY_BROWSER.url)
  const [proxy, setProxy] = useState<BrowserProxySettings>(DEFAULT_PROXY)
  const [busy, setBusy] = useState(false)
  const [proxyMessage, setProxyMessage] = useState('')
  const [proxyMessageIsError, setProxyMessageIsError] = useState(false)

  useEffect(() => {
    const unsubscribe = window.api.browser.onState(setBrowser)
    void window.api.browser.state().then((current) => {
      setBrowser(current)
      setAddress(current.url)
    })
    void window.api.browser.proxy.get().then(setProxy)
    return unsubscribe
  }, [])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const updateBounds = (): void => {
      const rect = element.getBoundingClientRect()
      void window.api.browser.setBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      })
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
    if (browser.url) setAddress(browser.url)
  }, [browser.url])

  async function navigate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const value = address.trim()
    if (!value) return
    const ok = await window.api.browser.navigate(value)
    if (!ok) {
      setProxyMessage('Enter a valid HTTP or HTTPS address.')
      setProxyMessageIsError(true)
    }
  }

  async function saveProxy(): Promise<void> {
    setBusy(true)
    setProxyMessage('Applying proxy to the browser session…')
    setProxyMessageIsError(false)
    try {
      const saved = await window.api.browser.proxy.set(proxy)
      setProxy(saved)
      await window.api.browser.reload()
      setProxyMessage(saved.enabled
        ? `SOCKS5 enabled for browser traffic via ${saved.host}:${saved.port}.`
        : 'Proxy disabled. Browser traffic will connect directly.')
    } catch (error) {
      setProxyMessage(error instanceof Error ? error.message : String(error))
      setProxyMessageIsError(true)
    } finally {
      setBusy(false)
    }
  }

  async function testProxy(): Promise<void> {
    setBusy(true)
    setProxyMessage('Checking whether a local service is listening…')
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
    <section className="browser-layout" aria-label="Browser">
      <div className="browser-controls">
        <form className="browser-address-row" onSubmit={(event) => void navigate(event)}>
          <div className="browser-nav-buttons">
            <button className="btn ghost browser-icon-btn" type="button" aria-label="Back" title="Back" disabled={!browser.canGoBack} onClick={() => void window.api.browser.back()}>
              ‹
            </button>
            <button className="btn ghost browser-icon-btn" type="button" aria-label="Forward" title="Forward" disabled={!browser.canGoForward} onClick={() => void window.api.browser.forward()}>
              ›
            </button>
            <button className="btn ghost browser-icon-btn" type="button" aria-label={browser.loading ? 'Stop' : 'Reload'} title={browser.loading ? 'Stop' : 'Reload'} onClick={() => void (browser.loading ? window.api.browser.stop() : window.api.browser.reload())}>
              {browser.loading ? '×' : '↻'}
            </button>
          </div>
          <label className="browser-address-field">
            <span className="browser-lock" aria-hidden>{browser.url.startsWith('https://') ? '●' : '○'}</span>
            <input
              type="text"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              aria-label="Web address"
              spellCheck={false}
              autoCapitalize="none"
              placeholder="Enter a website address"
            />
          </label>
          <button className="btn browser-go" type="submit">Go</button>
        </form>

        <div className="browser-proxy-panel">
          <div className="browser-proxy-header">
            <div className="browser-proxy-title">
              <span className={`browser-proxy-dot${proxy.enabled ? ' enabled' : ''}`} aria-hidden />
              <strong>SOCKS5 proxy</strong>
              <span className="browser-proxy-caption">
                {proxy.enabled ? `${proxy.host}:${proxy.port}` : 'Direct connection'}
              </span>
            </div>
            <label className="browser-proxy-toggle">
              <input
                type="checkbox"
                checked={proxy.enabled}
                onChange={(event) => setProxy((current) => ({ ...current, enabled: event.target.checked }))}
              />
              <span>Use proxy</span>
            </label>
          </div>
          <div className="browser-proxy-fields">
            <label>
              <span>Local host</span>
              <input
                type="text"
                value={proxy.host}
                spellCheck={false}
                onChange={(event) => setProxy((current) => ({ ...current, host: event.target.value }))}
                aria-label="Local SOCKS5 host"
              />
            </label>
            <label className="browser-port-field">
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
            <div className="browser-proxy-actions">
              <button className="btn ghost" type="button" disabled={busy} onClick={() => void testProxy()}>
                Test local port
              </button>
              <button className="btn" type="button" disabled={busy} onClick={() => void saveProxy()}>
                {busy ? 'Working…' : 'Save & apply'}
              </button>
            </div>
          </div>
          <p className="browser-tunnel-hint">
            On your Mac, start an SSH dynamic tunnel first:{' '}
            <code>ssh -N -D 127.0.0.1:1080 user@your-ssh-host</code>
          </p>
        </div>
        {(proxyMessage || browser.error) && (
          <div className={`browser-message${proxyMessageIsError || browser.error ? ' is-error' : ''}`} role="status">
            {browser.error ? `Page load issue: ${browser.error}. Check the SSH tunnel, or turn the proxy off.` : proxyMessage}
          </div>
        )}
        <div className="browser-page-label" title={browser.title}>
          {browser.loading ? 'Loading page…' : browser.title || 'Page'}
          <span>Remote page runs in an isolated Electron view; web permissions are denied.</span>
        </div>
      </div>
      <div className="browser-viewport" ref={viewportRef} aria-label="Web page area" />
    </section>
  )
}
