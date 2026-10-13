import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { TAB_GROUP_COLOR_VALUES, tabGroupLabel, type TabGroupInfo } from '../../../../shared/tab-groups'
import './tab-groups.css'

interface DragHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
  onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void
}

/**
 * A tab group's header row in the sidebar: colour chip with the name, click to collapse/expand,
 * double-click (or the menu's Rename…) to rename inline, right-click for the group menu. It is a
 * drag-sort item (`group:<id>`): dragging it moves the whole group, out of the window too.
 */
export function TabGroupHeader({ group, entryKey, dragging, handlers }: { group: TabGroupInfo; entryKey: string; dragging: boolean; handlers: DragHandlers }): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(group.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => window.api.browser.tabGroups.onRenameRequest((id) => {
    if (id !== group.id) return
    setDraft(group.name)
    setRenaming(true)
  }), [group.id, group.name])

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  function commit(): void {
    setRenaming(false)
    if (draft.trim() !== group.name) void window.api.browser.tabGroups.update(group.id, { name: draft }).catch(() => undefined)
  }

  const label = tabGroupLabel(group)
  return (
    <div
      className={`tab-group-header${group.collapsed ? ' is-collapsed' : ''}${dragging ? ' is-dragging' : ''}`}
      data-browser-tab-id={entryKey}
      data-tab-group-id={group.id}
      role="button"
      tabIndex={0}
      aria-expanded={!group.collapsed}
      aria-label={`Tab group ${label}, ${group.count} tab${group.count === 1 ? '' : 's'}`}
      title={`${label} · ${group.count} tab${group.count === 1 ? '' : 's'} · click to ${group.collapsed ? 'expand' : 'collapse'}`}
      style={{ '--group-color': TAB_GROUP_COLOR_VALUES[group.color] } as React.CSSProperties}
      onClick={() => { if (!renaming) void window.api.browser.tabGroups.toggle(group.id) }}
      onDoubleClick={(event) => {
        event.preventDefault()
        setDraft(group.name)
        setRenaming(true)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        void window.api.browser.tabGroups.showMenu(group.id)
      }}
      onKeyDown={(event) => {
        if (renaming) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          void window.api.browser.tabGroups.toggle(group.id)
        } else if (event.key === 'F2') {
          setDraft(group.name)
          setRenaming(true)
        }
      }}
      {...handlers}
    >
      <span className="tab-group-chevron" aria-hidden="true">›</span>
      {renaming ? (
        <input
          ref={inputRef}
          className="tab-group-rename"
          value={draft}
          maxLength={40}
          placeholder="Name this group"
          aria-label="Group name"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') commit()
            else if (event.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <span className={`tab-group-chip${group.name ? '' : ' is-unnamed'}`}>{group.name || '\u00a0'}</span>
      )}
      {group.collapsed && <span className="tab-group-count">{group.count}</span>}
    </div>
  )
}
