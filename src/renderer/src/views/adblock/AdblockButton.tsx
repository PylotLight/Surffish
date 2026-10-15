import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { adblockBadge, adblockButtonLabel, type AdblockCounts } from '../../../../shared/adblock-stats'
import { usePopoverDismiss } from '../../lib/popover-dismiss'

/** The popover body is its own chunk: launch only pays for this button. */
const AdblockPanel = lazy(() => import('./AdblockPanel').then((module) => ({ default: module.AdblockPanel })))

/** Counts that arrived before this renderer mounted are fetched once the window has settled. */
const COUNTS_DELAY_MS = 1_500

function webOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null
  } catch {
    return null
  }
}

/** Blocked counts for every tab of this window: main pushes changes (throttled). */
function useAdblockCounts(): AdblockCounts {
  const [counts, setCounts] = useState<AdblockCounts>({})
  useEffect(() => window.api.browser.adblock.onCounts((changed) => setCounts((current) => ({ ...current, ...changed }))), [])
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.browser.adblock.counts().then((all) => { if (!cancelled && all) setCounts((current) => ({ ...all, ...current })) }).catch(() => undefined)
    }, COUNTS_DELAY_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])
  return counts
}

/** Is blocking on for this origin (Settings → This site → Block ads and trackers)? */
function useSiteBlocking(origin: string | null): boolean {
  const [enabled, setEnabled] = useState(true)
  useEffect(() => {
    setEnabled(true)
    if (!origin) return
    let cancelled = false
    void window.api.browser.siteSettings.get(origin).then((settings) => { if (!cancelled && settings) setEnabled(settings.blockAds !== false) }).catch(() => undefined)
    const stop = window.api.browser.adblock.onSiteSettingsChanged((settings) => { if (settings?.origin === origin) setEnabled(settings.blockAds !== false) })
    return () => { cancelled = true; stop() }
  }, [origin])
  return enabled
}

/**
 * Toolbar ad-blocker button (uBlock Origin-style): the number of requests blocked on this tab's
 * page, and a popover with the per-site switch, blocked requests by domain and a link to the
 * site's settings.
 */
export function AdblockButton({ tabId, url, onOpenChange, onOpenSettings }: {
  tabId: string
  url: string
  onOpenChange?: (open: boolean) => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const counts = useAdblockCounts()
  const origin = webOrigin(url)
  const enabled = useSiteBlocking(origin)
  useEffect(() => { onOpenChange?.(open) }, [open])
  usePopoverDismiss(open, controlRef, () => setOpen(false), { returnFocusRef: buttonRef, preventEscapeDefault: true })
  const blocked = origin ? counts[tabId] ?? 0 : 0
  const badge = enabled ? adblockBadge(blocked) : ''
  const label = adblockButtonLabel({ web: origin !== null, enabled, blocked, host: origin ? new URL(origin).hostname : '' })
  return (
    <div className="adblock-control" ref={controlRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`omnibox-action-button adblock-button${open ? ' is-current' : ''}${enabled ? '' : ' is-off'}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="adblock-popover"
        title={label}
        data-blocked={blocked}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.5 5 6v5.2c0 4.3 2.9 7.9 7 9.3 4.1-1.4 7-5 7-9.3V6z" />
          {!enabled && <path d="M4.5 4.5l15 15" />}
        </svg>
        {badge && <span className="adblock-badge" aria-hidden="true">{badge}</span>}
      </button>
      {open && (
        <Suspense fallback={null}>
          <AdblockPanel tabId={tabId} pageUrl={url} blocked={blocked} onClose={() => setOpen(false)} onOpenSettings={() => { setOpen(false); onOpenSettings() }} />
        </Suspense>
      )}
    </div>
  )
}
