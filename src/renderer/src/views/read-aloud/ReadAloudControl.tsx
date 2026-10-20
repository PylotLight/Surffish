import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { IDLE_READ_ALOUD_STATE, type ReadAloudState } from '../../../../shared/read-aloud'
import { usePopoverDismiss } from '../../lib/popover-dismiss'

/** Player controls, voices and speeds are their own chunk: launch only pays for this button. */
const ReadAloudPanel = lazy(() => import('./ReadAloudPanel').then((module) => ({ default: module.ReadAloudPanel })))

/** Player state from main, kept current by its broadcast (idle until the first reading). */
export function useReadAloudState(): ReadAloudState {
  const [state, setState] = useState<ReadAloudState>(IDLE_READ_ALOUD_STATE)
  useEffect(() => window.api.browser.readAloud.onState(setState), [])
  return state
}

/**
 * Omnibox Read Aloud button: only on screen while a reading is loading, playing or paused (or just
 * failed). Click opens the player popover (play/pause, skip, stop, speed, voice). Nothing renders
 * and nothing loads while Read Aloud is off or idle.
 */
export function ReadAloudControl({ onOpenChange }: { onOpenChange?: (open: boolean) => void }): React.JSX.Element | null {
  const state = useReadAloudState()
  const [open, setOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const visible = state.status !== 'idle'
  useEffect(() => { onOpenChange?.(open && visible) }, [open, visible])
  useEffect(() => { if (!visible) setOpen(false) }, [visible])
  // A failure (no article, download blocked) opens the player once so the reason is seen.
  useEffect(() => { if (state.status === 'error') setOpen(true) }, [state.status, state.error])
  usePopoverDismiss(open && visible, controlRef, () => setOpen(false), { returnFocusRef: buttonRef, preventEscapeDefault: true })
  if (!visible) return null
  const busy = state.status === 'downloading' || state.status === 'loading'
  const label = state.status === 'error' ? 'Read Aloud: problem' : busy ? 'Read Aloud: getting ready' : state.status === 'paused' ? 'Read Aloud: paused' : 'Read Aloud: playing'
  return (
    <div className="read-aloud-control" ref={controlRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`omnibox-action-button read-aloud-button${open ? ' is-current' : ''}${state.status === 'playing' ? ' is-playing' : ''}${state.status === 'error' ? ' is-error' : ''}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="read-aloud-popover"
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z" /><path className="read-aloud-wave" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>
      </button>
      {open && (
        <Suspense fallback={null}>
          <ReadAloudPanel state={state} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
