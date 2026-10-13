import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { BrowserTabSummary, BrowsingHistoryEntry, PinnedSite, SearchEngineId } from '../../../shared/types'
import { buildPaletteItems, formatAccelerator, type CommandPaletteSnapshot, type PaletteItem, type PaletteMode } from '../../../shared/command-palette'
import { useSearchKeywords } from './useSearchKeywords'
import type { ArchivedTab } from '../../../shared/tab-archive'
import './CommandPalette.css'

const EMPTY_SNAPSHOT: CommandPaletteSnapshot = { commands: [], recentCommandIds: [] }
const MAX_HISTORY = 3000

interface CommandPaletteProps {
  tabs: readonly BrowserTabSummary[]
  pinnedSites: readonly PinnedSite[]
  searchEngine: SearchEngineId
  searchEngineLabel: string
  onOpenChange?: (open: boolean) => void
}

function ItemIcon({ item }: { item: PaletteItem }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const favicon = item.kind === 'tab' || item.kind === 'site' || item.kind === 'archived' ? item.faviconUrl : null
  if (favicon && !failed) return <span className="palette-item-icon"><img src={favicon} alt="" onError={() => setFailed(true)} /></span>
  const glyph = item.kind === 'command' ? '›' : item.kind === 'tab' ? '▤' : item.kind === 'search' ? '⌕' : item.kind === 'archived' ? '⤓' : item.source === 'favorite' ? '★' : '◷'
  return <span className={`palette-item-icon is-${item.kind}`} aria-hidden="true">{glyph}</span>
}

/**
 * Cmd/Ctrl+K command palette (and Cmd/Ctrl+Shift+A tab search). Main decides which shell surface
 * shows it (toolbar overlay above live pages, the content renderer on New Tab / full panels) and
 * sends `open`; everything it runs goes back through main.
 */
export function CommandPalette({ tabs, pinnedSites, searchEngine, searchEngineLabel, onOpenChange }: CommandPaletteProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<PaletteMode>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [snapshot, setSnapshot] = useState<CommandPaletteSnapshot>(EMPTY_SNAPSHOT)
  const [history, setHistory] = useState<BrowsingHistoryEntry[]>([])
  const [archivedTabs, setArchivedTabs] = useState<ArchivedTab[]>([])
  const [openRequest, setOpenRequest] = useState(0)
  const searchEngines = useSearchKeywords()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(false)
  const modeRef = useRef<PaletteMode>('all')
  const closingRef = useRef(false)

  const close = useCallback((refocusPage: boolean) => {
    if (!openRef.current) return
    openRef.current = false
    closingRef.current = true
    setOpen(false)
    setQuery('')
    if (refocusPage) void window.api.browser.commandPalette.closed(true).catch(() => undefined)
    window.setTimeout(() => { closingRef.current = false }, 0)
  }, [])

  useEffect(() => window.api.browser.commandPalette.onOpen(({ mode: requested }) => {
    // The shortcut again closes it (same mode) or switches mode.
    if (openRef.current && modeRef.current === requested) {
      close(true)
      return
    }
    openRef.current = true
    modeRef.current = requested
    setMode(requested)
    setQuery('')
    setSelected(0)
    setOpen(true)
    void window.api.browser.commands.list().then(setSnapshot).catch(() => undefined)
    void window.api.browser.tabArchive.get().then((archive) => setArchivedTabs(archive.tabs)).catch(() => undefined)
    if (requested === 'all') {
      void window.api.browser.history.get().then((entries) => setHistory(entries.slice(0, MAX_HISTORY))).catch(() => undefined)
    }
    setOpenRequest((count) => count + 1)
  }), [close])

  // Focus once the field is actually mounted (a rAF right after setOpen can run before React commits).
  useLayoutEffect(() => {
    if (open && openRequest > 0) inputRef.current?.focus()
  }, [open, openRequest, mode])

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  const items = useMemo(() => open ? buildPaletteItems({
    query,
    mode,
    commands: snapshot.commands,
    recentCommandIds: snapshot.recentCommandIds,
    tabs,
    pinnedSites,
    history,
    searchEngines,
    defaultSearchLabel: searchEngineLabel,
    platform: window.api.platform,
    archivedTabs
  }) : [], [open, query, mode, snapshot, tabs, pinnedSites, history, searchEngines, searchEngineLabel, archivedTabs])

  useEffect(() => {
    setSelected((index) => (items.length === 0 ? 0 : Math.min(index, items.length - 1)))
  }, [items.length])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected, open])

  if (!open) return null

  async function execute(item: PaletteItem | undefined, inNewTab: boolean): Promise<void> {
    if (!item) return
    close(false)
    try {
      switch (item.kind) {
        case 'command':
          await window.api.browser.commands.run(item.commandId)
          return
        case 'tab':
          await window.api.browser.tabs.activate(item.tabId)
          await window.api.browser.commandPalette.closed(true)
          return
        case 'archived':
          await window.api.browser.tabArchive.restore(item.archivedId)
          await window.api.browser.commandPalette.closed(true)
          return
        case 'site':
          if (inNewTab) await window.api.browser.tabs.create(item.url, searchEngine)
          else await window.api.browser.navigate(item.url, searchEngine)
          await window.api.browser.commandPalette.closed(true)
          return
        case 'search':
          if (inNewTab) await window.api.browser.tabs.create(item.input, searchEngine)
          else await window.api.browser.navigate(item.input, searchEngine)
          await window.api.browser.commandPalette.closed(true)
      }
    } catch {
      // The action reports its own failures (e.g. the toolbar error line for navigation).
    }
  }

  function move(delta: number): void {
    if (items.length === 0) return
    setSelected((index) => (index + delta + items.length) % items.length)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const ctrlOnly = event.ctrlKey && !event.metaKey && !event.altKey
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'ArrowDown' || (ctrlOnly && event.key.toLowerCase() === 'n')) {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowUp' || (ctrlOnly && event.key.toLowerCase() === 'p')) {
      event.preventDefault()
      move(-1)
    } else if (event.key === 'PageDown') {
      event.preventDefault()
      setSelected((index) => Math.min(items.length - 1, index + 8))
    } else if (event.key === 'PageUp') {
      event.preventDefault()
      setSelected((index) => Math.max(0, index - 8))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      void execute(items[selected], event.metaKey || event.ctrlKey)
    } else if (event.key === 'Backspace' && !query && mode === 'tabs') {
      // Backspace on an empty tab search widens it to everything.
      event.preventDefault()
      modeRef.current = 'all'
      setMode('all')
      void window.api.browser.history.get().then((entries) => setHistory(entries.slice(0, MAX_HISTORY))).catch(() => undefined)
    }
  }

  const isMac = window.api.platform === 'darwin'
  const activeId = items[selected] ? `palette-item-${selected}` : undefined
  return (
    <div id="command-palette" className="command-palette" role="dialog" aria-modal="true" aria-label={mode === 'tabs' ? 'Search tabs' : 'Command palette'}>
      <div className="command-palette-field">
        {mode === 'tabs' && <span className="command-palette-scope">Tabs</span>}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => window.setTimeout(() => {
            // Clicking an item keeps focus (mousedown is prevented); anything else closes it.
            if (!closingRef.current && document.activeElement !== inputRef.current) close(false)
          }, 0)}
          placeholder={mode === 'tabs' ? 'Search open and archived tabs' : 'Search commands, tabs, favourites, history or the web'}
          aria-label={mode === 'tabs' ? 'Search open tabs' : 'Search commands, tabs and the web'}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
        />
        <kbd className="command-palette-hint">{formatAccelerator(mode === 'tabs' ? 'CmdOrCtrl+Shift+A' : 'CmdOrCtrl+K', window.api.platform)}</kbd>
      </div>
      <div id="command-palette-list" className="command-palette-list" role="listbox" ref={listRef}>
        {items.length === 0 && <p className="command-palette-empty">{mode === 'tabs' ? 'No matching tabs' : 'No matches'}</p>}
        {items.map((item, index) => (
          <Fragment key={item.key}>
          {mode === 'tabs' && item.kind === 'archived' && items[index - 1]?.kind !== 'archived' && <p className="command-palette-group" role="presentation">Archived</p>}
          <button
            id={`palette-item-${index}`}
            data-index={index}
            type="button"
            role="option"
            aria-selected={index === selected}
            className={`command-palette-item${index === selected ? ' is-selected' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => { if (index !== selected) setSelected(index) }}
            onClick={(event) => void execute(item, event.metaKey || event.ctrlKey)}
          >
            <ItemIcon item={item} />
            <span className="command-palette-item-main">
              <strong>{item.title}</strong>
              <small>{item.subtitle}</small>
            </span>
            {item.kind === 'command' && item.shortcut && <kbd className="command-palette-shortcut">{item.shortcut}</kbd>}
            {item.kind === 'tab' && <span className="command-palette-tag">Switch</span>}
            {item.kind === 'archived' && <span className="command-palette-tag">Restore</span>}
          </button>
          </Fragment>
        ))}
      </div>
      <footer className="command-palette-footer" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↩</kbd> open</span>
        <span><kbd>{isMac ? '⌘' : 'Ctrl'}↩</kbd> new tab</span>
        <span><kbd>esc</kbd> close</span>
      </footer>
    </div>
  )
}
