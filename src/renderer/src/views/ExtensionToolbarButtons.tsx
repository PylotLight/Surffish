import { useEffect, useRef, useState } from 'react'
import type { WebStoreExtensionsState, WebStoreExtensionSummary } from '../../../shared/types'
import { runExtensionAction } from './useWebStoreExtensions'

/** Toolbar pin overrides by extension id (`bramble` for the built-in password manager). */
const PIN_STORAGE_KEY = 'surffish.toolbar.extensionPins'
export const BRAMBLE_TOOLBAR_ID = 'bramble'

type PinMap = Record<string, boolean>

function readPins(): PinMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(PIN_STORAGE_KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' ? parsed as PinMap : {}
  } catch {
    return {}
  }
}

/**
 * Which extensions sit on the toolbar. Background-only extensions (no popup) start hidden in the
 * overflow menu; everything else starts pinned. Shared across the toolbar/sidebar surfaces via
 * localStorage + the storage event.
 */
export function useExtensionPins(): { isPinned: (id: string, hasPopup: boolean) => boolean; setPinned: (id: string, pinned: boolean) => void } {
  const [pins, setPins] = useState<PinMap>(readPins)
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => { if (event.key === PIN_STORAGE_KEY) setPins(readPins()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return {
    isPinned: (id, hasPopup) => pins[id] ?? hasPopup,
    setPinned: (id, pinned) => {
      const next = { ...readPins(), [id]: pinned }
      localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(next))
      setPins(next)
    }
  }
}

export interface BrambleToolbarEntry {
  label: string
  iconSrc: string
  disabled: boolean
  onOpen: () => void
}

interface Props {
  state: WebStoreExtensionsState
  setState: (state: WebStoreExtensionsState) => void
  pins: ReturnType<typeof useExtensionPins>
  bramble?: BrambleToolbarEntry
  onManage: () => void
  /** Lets the shell grow the toolbar view so the menu isn't clipped by the page view. */
  onMenuOpenChange?: (open: boolean) => void
}

function ExtensionIcon({ extension }: { extension: WebStoreExtensionSummary }): React.JSX.Element {
  return extension.iconDataUrl
    ? <img className="extension-toolbar-icon" src={extension.iconDataUrl} alt="" />
    : <span className="extension-toolbar-fallback" aria-hidden="true">{extension.name.slice(0, 1).toUpperCase()}</span>
}

function PinGlyph({ pinned }: { pinned: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={pinned ? 'is-pinned' : undefined}>
      <path d="M9 4.5h6l-1 5 3 3v1.5H7V12.5l3-3z" />
      <path d="M12 14.5v5" />
    </svg>
  )
}

/** Pinned Web Store extensions on the toolbar, plus a puzzle-piece overflow menu for the rest. */
export function ExtensionToolbarButtons({ state, setState, pins, bramble, onManage, onMenuOpenChange }: Props): React.JSX.Element | null {
  const [menuOpen, setMenuOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const active = state.extensions.filter((extension) => extension.enabled && extension.loaded)
  const pinned = active.filter((extension) => (extension.hasPopup || extension.hasOptions) && pins.isPinned(extension.id, extension.hasPopup))

  useEffect(() => { onMenuOpenChange?.(menuOpen) }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutside = (event: PointerEvent): void => {
      if (!controlRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    window.addEventListener('pointerdown', closeOnOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const openExtension = (extension: WebStoreExtensionSummary, anchorEl: HTMLElement): void => {
    if (!extension.hasPopup) {
      if (extension.hasOptions) void runExtensionAction(() => window.api.browser.extensions.openOptions(extension.id), setState, state)
      return
    }
    const bounds = anchorEl.getBoundingClientRect()
    const anchor = { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
    void runExtensionAction(() => window.api.browser.extensions.openPopup(extension.id, anchor), setState, state)
  }

  if (active.length === 0 && !bramble) return null

  return (
    <div className="extension-toolbar-buttons" role="group" aria-label="Extensions" ref={controlRef}>
      {pinned.map((extension) => (
        <button
          key={extension.id}
          className={`toolbar-button extension-toolbar-button${state.popupOpenId === extension.id ? ' is-open' : ''}`}
          type="button"
          aria-label={extension.name}
          aria-haspopup={extension.hasPopup ? 'dialog' : undefined}
          aria-expanded={extension.hasPopup ? state.popupOpenId === extension.id : undefined}
          title={extension.hasPopup ? `${extension.name}${extension.hasOptions ? ' · right-click for options' : ''}` : `${extension.name} options`}
          onContextMenu={(event) => {
            if (!extension.hasOptions) return
            event.preventDefault()
            void runExtensionAction(() => window.api.browser.extensions.openOptions(extension.id), setState, state)
          }}
          onClick={(event) => openExtension(extension, event.currentTarget)}
        >
          <ExtensionIcon extension={extension} />
        </button>
      ))}
      <div className="extension-overflow-control">
        <button
          ref={menuButtonRef}
          className={`toolbar-button extension-overflow-button${menuOpen ? ' is-open' : ''}`}
          type="button"
          aria-label="Extensions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls="extensions-menu"
          title="Extensions"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4.5a2 2 0 0 1 4 0V6h3.5A1.5 1.5 0 0 1 19 7.5V11h-1.5a2 2 0 0 0 0 4H19v3.5a1.5 1.5 0 0 1-1.5 1.5H14v-1.5a2 2 0 0 0-4 0V20H6.5A1.5 1.5 0 0 1 5 18.5V15h1.5a2 2 0 0 0 0-4H5V7.5A1.5 1.5 0 0 1 6.5 6H10z" /></svg>
        </button>
        {menuOpen && (
          <div id="extensions-menu" className="extensions-menu" role="menu" aria-label="Extensions">
            <header className="extensions-menu-header">
              <strong>Extensions</strong>
              <span>{active.length + (bramble ? 1 : 0)} active</span>
            </header>
            <ul className="extensions-menu-list">
              {bramble && (() => {
                const isPinned = pins.isPinned(BRAMBLE_TOOLBAR_ID, true)
                return (
                  <li className="extensions-menu-row">
                    <button type="button" role="menuitem" className="extensions-menu-open" disabled={bramble.disabled} onClick={() => { setMenuOpen(false); bramble.onOpen() }}>
                      <img className="extension-toolbar-icon" src={bramble.iconSrc} alt="" />
                      <span className="extensions-menu-name">{bramble.label}<small>Built in</small></span>
                    </button>
                    <button type="button" className={`extensions-menu-pin${isPinned ? ' is-pinned' : ''}`} aria-pressed={isPinned} aria-label={isPinned ? 'Hide Bramble from toolbar' : 'Show Bramble on toolbar'} title={isPinned ? 'Hide from toolbar' : 'Pin to toolbar'} onClick={() => pins.setPinned(BRAMBLE_TOOLBAR_ID, !isPinned)}>
                      <PinGlyph pinned={isPinned} />
                    </button>
                  </li>
                )
              })()}
              {active.map((extension) => {
                const canPin = extension.hasPopup || extension.hasOptions
                const isPinned = canPin && pins.isPinned(extension.id, extension.hasPopup)
                return (
                  <li className="extensions-menu-row" key={extension.id}>
                    <button
                      type="button"
                      role="menuitem"
                      className="extensions-menu-open"
                      disabled={!canPin}
                      title={canPin ? `Open ${extension.name}` : `${extension.name} runs in the background`}
                      onClick={(event) => { setMenuOpen(false); openExtension(extension, menuButtonRef.current ?? event.currentTarget) }}
                    >
                      <ExtensionIcon extension={extension} />
                      <span className="extensions-menu-name">{extension.name}<small>{extension.hasPopup ? 'Popup' : extension.hasOptions ? 'Options only' : 'Background only'}</small></span>
                    </button>
                    {canPin && (
                      <button type="button" className={`extensions-menu-pin${isPinned ? ' is-pinned' : ''}`} aria-pressed={isPinned} aria-label={isPinned ? `Hide ${extension.name} from toolbar` : `Show ${extension.name} on toolbar`} title={isPinned ? 'Hide from toolbar' : 'Pin to toolbar'} onClick={() => pins.setPinned(extension.id, !isPinned)}>
                        <PinGlyph pinned={isPinned} />
                      </button>
                    )}
                  </li>
                )
              })}
              {active.length === 0 && !bramble && <li className="extensions-menu-empty">No extensions running</li>}
            </ul>
            <button type="button" role="menuitem" className="extensions-menu-manage" onClick={() => { setMenuOpen(false); onManage() }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" /></svg>
              Manage extensions
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
