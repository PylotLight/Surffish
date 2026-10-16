import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import NewTabSettingsFields, { type NewTabSettingsFieldsProps } from './NewTabSettingsFields'
import './new-tab-customize.css'

type Props = Omit<NewTabSettingsFieldsProps, 'variant' | 'onCustomizeOnNewTab'> & {
  open: boolean
  onClose: () => void
  /** Settings → New Tab (the full page). */
  onOpenSettings: () => void
  /** The gear: a press on it is not "outside", and focus returns to it on close. */
  gearRef: RefObject<HTMLButtonElement | null>
}

/**
 * "Customize New Tab" side panel, drawn over the right edge of the New Tab page (like Chrome's
 * Customize Chrome panel) so every change shows live on the page behind it. Loaded on first open
 * (lazy chunk), then kept mounted and slid out of view, so reopening is instant. Escape, the close
 * button or a press outside it close it; focus moves in on open and back to the gear on close.
 */
export default function NewTabCustomizePanel({ open, onClose, onOpenSettings, gearRef, ...fields }: Props): React.JSX.Element {
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // The first render is off-screen, then it slides in (a mount straight into `is-open` wouldn't animate).
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!open) { setShown(false); return }
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [open])

  // Focus once it is visible (a visibility: hidden element can't take focus).
  useEffect(() => {
    if (shown) closeRef.current?.focus({ preventScroll: true })
  }, [shown])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'SELECT') return
      event.preventDefault()
      onClose()
      gearRef.current?.focus({ preventScroll: true })
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (!target || panelRef.current?.contains(target) || gearRef.current?.contains(target)) return
      // The fixed city / time zone suggestion lists live inside the panel's DOM, so they count as inside.
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open, onClose, gearRef])

  return (
    <aside
      ref={panelRef}
      id="new-tab-customize-panel"
      className={`settings-view settings-view-newtab new-tab-customize${shown ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-hidden={!open}
      inert={!open}
    >
      <header className="new-tab-customize-header">
        <h2 id={titleId}>Customize New Tab</h2>
        <button className="new-tab-customize-settings" type="button" onClick={onOpenSettings} title="Open Settings → New Tab">All settings</button>
        <button ref={closeRef} className="new-tab-customize-close" type="button" aria-label="Close Customize New Tab" title="Close (Esc)" onClick={() => { onClose(); gearRef.current?.focus({ preventScroll: true }) }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>
      <div className="settings-content new-tab-customize-body">
        <NewTabSettingsFields {...fields} variant="panel" />
      </div>
    </aside>
  )
}
