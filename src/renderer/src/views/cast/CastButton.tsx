import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { CastSnapshot } from '../../../../shared/cast'
import { usePopoverDismiss } from '../../lib/popover-dismiss'
import { useCastSnapshot } from './useCastSnapshot'
import './cast-button.css'

/** The picker body is its own chunk: launch only pays for this button. */
const CastPanel = lazy(() => import('./CastPanel').then((module) => ({ default: module.CastPanel })))

function CastGlyph({ active = false }: { active?: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 17.5a3 3 0 0 1 3 3M3.5 13.8a6.7 6.7 0 0 1 6.7 6.7M3.5 10a10.5 10.5 0 0 1 10.5 10.5" />
      <path d="M3.5 7.5V6a1.5 1.5 0 0 1 1.5-1.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-2.5" />
      {active && <path className="cast-glyph-fill" d="M6.5 7.5h11v9h-1.4A12.5 12.5 0 0 0 6.5 8.9z" />}
    </svg>
  )
}

function castButtonLabel(snapshot: CastSnapshot): string {
  if (snapshot.session) return `Casting to ${snapshot.session.deviceName}`
  return snapshot.devices.length === 1 ? `Cast to ${snapshot.devices[0]!.name}` : 'Cast to a device'
}

/**
 * Toolbar cast button (in the address bar's actions, like the ad blocker's): shown when a
 * Chromecast was found on the network or a cast is live, and while its picker is open. ⌘K "Cast…"
 * opens the picker even when the button is hidden.
 */
export function CastButton({ tabId, url, onOpenChange, onOpenSettings }: {
  tabId: string
  url: string
  onOpenChange?: (open: boolean) => void
  onOpenSettings: () => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const snapshot = useCastSnapshot()
  useEffect(() => { onOpenChange?.(open) }, [open])
  useEffect(() => window.api.browser.cast.onShow(() => setOpen(true)), [])
  useEffect(() => { if (!snapshot.enabled) setOpen(false) }, [snapshot.enabled])
  usePopoverDismiss(open, controlRef, () => setOpen(false), { returnFocusRef: buttonRef, preventEscapeDefault: true })
  const active = snapshot.session !== null
  if (!snapshot.enabled || (!open && !active && snapshot.devices.length === 0)) return null
  const label = castButtonLabel(snapshot)
  return (
    <div className="cast-control" ref={controlRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`omnibox-action-button cast-button${open ? ' is-current' : ''}${active ? ' is-casting' : ''}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="cast-popover"
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        <CastGlyph active={active} />
      </button>
      {open && (
        <Suspense fallback={null}>
          <CastPanel tabId={tabId} pageUrl={url} snapshot={snapshot} onClose={() => setOpen(false)} onOpenSettings={() => { setOpen(false); onOpenSettings() }} />
        </Suspense>
      )}
    </div>
  )
}

/** The tab a cast was started from (its sidebar row shows the cast badge), or null. */
export function useCastTabId(): string | null {
  return useCastSnapshot().session?.tabId ?? null
}

export function TabCastBadge(): React.JSX.Element {
  return <span className="tab-cast-badge" title="Casting from this tab" aria-label="Casting from this tab"><CastGlyph active /></span>
}
