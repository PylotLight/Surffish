import { useEffect, useState } from 'react'
import type { BrowserTabSummary } from '../../../shared/types'

/** Favicon / loading spinner, audio mute button and pinned-tab icon used by the tab sidebar. */
export function TabFavicon({ tab }: { tab: BrowserTabSummary }): React.JSX.Element {
  const [iconFailed, setIconFailed] = useState(false)
  useEffect(() => setIconFailed(false), [tab.faviconUrl])
  return (
    <span className={`tab-favicon${tab.loading ? ' is-loading' : ''}`} aria-hidden="true">
      {tab.loading ? (
        <svg className="tab-spinner" viewBox="0 0 24 24" shapeRendering="geometricPrecision">
          <circle className="tab-spinner-track" cx="12" cy="12" r="9" />
          {/* SMIL rotation keeps the arc vector-drawn every frame; a CSS transform on the svg
              gets rasterised into a layer and wobbles into a lumpy squircle at favicon size. */}
          <g>
            <circle className="tab-spinner-arc" cx="12" cy="12" r="9" pathLength="100" />
            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
          </g>
        </svg>
      ) : tab.faviconUrl && !iconFailed
        ? <img src={tab.faviconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setIconFailed(true)} />
        : tab.title.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function TabAudioButton({ tab, className = '' }: { tab: BrowserTabSummary; className?: string }): React.JSX.Element | null {
  if (!tab.audible && !tab.muted) return null
  const label = tab.muted ? `Unmute ${tab.title}` : `Mute ${tab.title}`
  return (
    <button
      className={`tab-audio-button${tab.muted ? ' is-muted' : ' is-playing'} ${className}`.trim()}
      type="button"
      aria-label={label}
      aria-pressed={tab.muted}
      title={tab.muted ? 'Unmute tab' : 'Playing audio · click to mute'}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); void window.api.browser.tabs.setMuted(tab.id, !tab.muted) }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path className="tab-audio-speaker" d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z" />
        {tab.muted
          ? <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
          : <><path className="tab-audio-wave1" d="M15 9.2a4 4 0 0 1 0 5.6" /><path className="tab-audio-wave2" d="M17.6 6.8a7.4 7.4 0 0 1 0 10.4" /></>}
      </svg>
    </button>
  )
}

export function PinnedTabIcon({ tab }: { tab: BrowserTabSummary }): React.JSX.Element {
  return (
    <button
      className={`pinned-tab-icon-button${tab.active ? ' is-active' : ''}`}
      type="button"
      data-browser-tab-id={tab.id}
      aria-label={`Open pinned tab ${tab.title}`}
      title={`${tab.title}${tab.sleeping ? ' · sleeping' : ''}${tab.muted ? ' · muted' : tab.audible ? ' · playing audio' : ''}`}
      onClick={() => { void window.api.browser.tabs.activate(tab.id) }}
    >
      <TabFavicon tab={tab} />
      {tab.sleeping && <span className="pinned-tab-sleep-indicator" aria-hidden="true">☾</span>}
      {(tab.audible || tab.muted) && <span className={`pinned-tab-audio-indicator${tab.muted ? ' is-muted' : ''}`} aria-hidden="true"><svg viewBox="0 0 24 24"><path className="tab-audio-speaker" d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z" />{tab.muted ? <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" /> : <path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.8a7.4 7.4 0 0 1 0 10.4" />}</svg></span>}
    </button>
  )
}
