import { lazy, Suspense, useEffect, useState } from 'react'
import type { ReadAloudState } from '../../../../shared/read-aloud'

/** The control and its player are their own chunk: launch only pays for this listener. */
const ReadAloudControl = lazy(() => import('./ReadAloudControl').then((module) => ({ default: module.ReadAloudControl })))

/**
 * Omnibox slot for Read Aloud: nothing renders and nothing loads until a reading starts (main
 * broadcasts the player state); then the control (and, on click, the player) load.
 */
export function ReadAloudSlot({ onOpenChange }: { onOpenChange?: (open: boolean) => void }): React.JSX.Element | null {
  const [state, setState] = useState<ReadAloudState | null>(null)
  useEffect(() => window.api.browser.readAloud.onState(setState), [])
  const visible = state !== null && state.status !== 'idle'
  // The control unmounts with its popover when the reading ends; tell the toolbar it closed.
  useEffect(() => { if (!visible) onOpenChange?.(false) }, [visible])
  if (!visible) return null
  return <Suspense fallback={null}><ReadAloudControl state={state} onOpenChange={onOpenChange} /></Suspense>
}
