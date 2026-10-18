import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { CastSnapshot } from '../../../../shared/cast'
import { usePopoverDismiss } from '../../lib/popover-dismiss'
import { useCastSnapshot } from './useCastSnapshot'
import { useReturnFocusRef, useToolbarOpenRequest, useToolbarSlot } from '../toolbar/toolbar-slot'
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

/** What the toolbar's contextual rule needs from the cast state (shared/toolbar-layout.ts). */
export interface CastToolbarContext {
  enabled: boolean
  live: boolean
  devices: number
}

/**
 * Toolbar cast button. Where it shows is the toolbar layout's call (shared/toolbar-layout.ts): by
 * default only while a page played media and a Chromecast is known, or a cast is live; pinned, always;
 * otherwise it sits folded (hidden) and the Surffish menu or ⌘K "Cast…" opens its picker.
 */
export function CastButton({ tabId, url, onOpenChange, onOpenSettings, onContext }: {
  tabId: string
  url: string
  onOpenChange?: (open: boolean) => void
  onOpenSettings: () => void
  onContext?: (context: CastToolbarContext) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const snapshot = useCastSnapshot()
  useEffect(() => { onOpenChange?.(open) }, [open])
  useEffect(() => window.api.browser.cast.onShow(() => setOpen(true)), [])
  useEffect(() => { if (!snapshot.enabled) setOpen(false) }, [snapshot.enabled])
  const { folded } = useToolbarSlot()
  const returnFocusRef = useReturnFocusRef(buttonRef)
  useToolbarOpenRequest('cast', () => { if (snapshot.enabled) setOpen(true) })
  usePopoverDismiss(open, controlRef, () => setOpen(false), { returnFocusRef, preventEscapeDefault: true })
  const active = snapshot.session !== null
  const deviceCount = snapshot.devices.length
  useEffect(() => { onContext?.({ enabled: snapshot.enabled, live: active, devices: deviceCount }) }, [snapshot.enabled, active, deviceCount])
  if (!snapshot.enabled) return null
  const label = castButtonLabel(snapshot)
  return (
    <div className="cast-control" ref={controlRef}>
      <button
        ref={buttonRef}
        type="button"
        hidden={folded}
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
