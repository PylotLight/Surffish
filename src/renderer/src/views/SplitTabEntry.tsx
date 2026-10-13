import type { PointerEvent as ReactPointerEvent } from 'react'
import type { BrowserTabSummary } from '../../../shared/types'
import { TabAudioButton, TabFavicon, PrivateGlyph } from './TabIndicators'
import './SplitTabEntry.css'

interface DragHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
  onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void
}

/**
 * A split view in the sidebar: one row (it drags, sorts and tears out as one) with a half per
 * pane, left to right. Clicking a half shows the split with that pane focused; each half has its
 * own close button and right-click menu (data-browser-pane-id).
 */
export function SplitTabEntry({ entryId, tabs, dragging, animate, handlers, onActivate, onMoveBy, titleFor, groupColor }: {
  entryId: string
  /** The split's tab group colour (it sits in the group's run with the coloured rail). */
  groupColor?: string
  tabs: BrowserTabSummary[]
  dragging: boolean
  animate: boolean
  handlers: DragHandlers
  onActivate: (id: string) => void
  onMoveBy: (offset: number) => void
  titleFor: (tab: BrowserTabSummary) => string
}): React.JSX.Element {
  const active = tabs.some((tab) => tab.active)
  const label = tabs.map((tab) => tab.title).join(' | ')
  return (
    <div
      className={`tab-item tab-split-entry${active ? ' is-active' : ''}${tabs.some((tab) => tab.private) ? ' is-private' : ''}${dragging ? ' is-dragging' : ''}${groupColor ? ' is-grouped' : ''}`}
      style={groupColor ? { '--group-color': groupColor } as React.CSSProperties : undefined}
      data-browser-tab-id={entryId}
      role="tab"
      aria-selected={active}
      aria-label={`Split view: ${label}`}
      aria-grabbed={dragging ? true : undefined}
      tabIndex={0}
      title={`Split view · ${label}`}
      onKeyDown={(event) => {
        if (event.altKey && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault()
          onMoveBy(event.key === 'ArrowUp' ? -1 : 1)
          return
        }
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onActivate((tabs.find((tab) => tab.active) ?? tabs[0])!.id)
      }}
      {...handlers}
    >
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          className={`tab-split-pane${tab.active ? ' is-focused' : ''}${tab.sleeping ? ' is-sleeping' : ''}`}
          data-browser-pane-id={tab.id}
          title={titleFor(tab)}
          onClick={() => onActivate(tab.id)}
          onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
          onAuxClick={(event) => {
            if (event.button !== 1) return
            event.preventDefault()
            event.stopPropagation()
            void window.api.browser.tabs.close(tab.id)
          }}
        >
          {index > 0 && <span className="tab-split-divider" aria-hidden="true" />}
          <TabFavicon tab={tab} animate={animate} />
          <span className="tab-title">{tab.title}</span>
          {tab.private && <span className="tab-private-badge" title="Private tab" aria-label="Private tab"><PrivateGlyph /></span>}
          <TabAudioButton tab={tab} />
          <button
            className="tab-close"
            type="button"
            aria-label={`Close ${tab.title}`}
            title="Close this pane"
            onClick={(event) => { event.stopPropagation(); void window.api.browser.tabs.close(tab.id) }}
          >×</button>
        </div>
      ))}
    </div>
  )
}
