import { useEffect, useState } from 'react'
import { APP_NAME, APP_TAGLINE } from '../../shared/config'
import type { GlassState, SysInfo } from '../../shared/types'
import Browser from './views/Browser'
import Kitchen from './views/Kitchen'
import TrayDemo from './views/TrayDemo'
import Glass from './views/Glass'
import Agent from './views/Agent'

type Tab = 'browser' | 'kitchen' | 'tray' | 'glass' | 'agent'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'browser', label: 'Browser' },
  { id: 'kitchen', label: 'Kitchen sink' },
  { id: 'tray', label: 'Tray' },
  { id: 'glass', label: 'Glass' },
  { id: 'agent', label: 'Agent mode' }
]

export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('browser')
  const [sys, setSys] = useState<SysInfo | null>(null)
  const [glass, setGlass] = useState<GlassState | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    window.api.sys.info().then(setSys).catch(console.error)
    window.api.glass.get().then(setGlass).catch(console.error)
  }, [])

  const vibrancyOn = glass !== null && glass.vibrancy !== null
  return (
    <div className="shell" data-platform={sys?.platform ?? 'unknown'}>
      <aside className="sidebar">
        <div className="traffic-spacer" aria-hidden />
        <div className="brand">
          <h1>{APP_NAME}</h1>
          <p>{APP_TAGLINE}</p>
        </div>
        <nav className="nav" role="tablist" aria-label="App sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'active' : ''}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <span className={`status-pill${vibrancyOn ? ' on' : ''}`}>
            vibrancy {glass === null ? '…' : vibrancyOn ? 'on' : 'off'}
          </span>
          <span className="status-sub">
            {sys ? `${sys.platform} · e${window.api.versions.electron()}` : '…'}
          </span>
        </div>
      </aside>

      <div className="content">
        {tab !== 'browser' && (
          <header className="topbar">
            <button
              className="btn ghost"
              title="Hide the whole app (macOS: Cmd+H behavior)"
              onClick={() => void window.api.app.hide()}
            >
              Hide
            </button>
            <input
              className="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the day…"
              aria-label="Search schedule items"
            />
            <span className="weather pill">
              {sys ? `${sys.hostname} · ${sys.cpus} cores` : '…'}
            </span>
          </header>
        )}

        <main className={`view${tab === 'browser' ? ' view-browser' : ''}`}>
          {tab === 'browser' && <Browser />}
          {tab === 'kitchen' && <Kitchen />}
          {tab === 'tray' && <TrayDemo platform={sys?.platform} />}
          {tab === 'glass' && (
            <Glass platform={sys?.platform} query={query} glass={glass} onGlassChange={setGlass} />
          )}
          {tab === 'agent' && <Agent />}
        </main>
      </div>
    </div>
  )
}
