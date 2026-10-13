import { useEffect, useRef } from 'react'
import { blurDismissesPopover, dismissReasonCloses, normalizeDismissReason, POPOVER_DISMISS_EVENT, type DismissibleKind, type PopoverDismissReason } from '../../../shared/popover-dismiss'

/** Close every open popover in this renderer (main asked, see shared/popover-dismiss.ts). */
export function dismissPopovers(reason: PopoverDismissReason | string = 'request'): void {
  window.dispatchEvent(new CustomEvent(POPOVER_DISMISS_EVENT, { detail: normalizeDismissReason(reason) }))
}

export interface PopoverDismissOptions {
  /** Where focus goes back after Escape (the button that opened the popover). */
  returnFocusRef?: React.RefObject<HTMLElement | null>
  /** Mark the Escape handled, so other Escape listeners (leave Settings, …) skip it. */
  preventEscapeDefault?: boolean
  /** `panel` for the History panel (drawn in the sidebar view): sidebar presses and toolbar blur don't close it. */
  kind?: DismissibleKind
}

/**
 * Light-dismiss for a popover: closes on a press outside `containerRef`, on Escape, when this
 * surface loses focus (the page, the sidebar, a tab switch, another app), and when main reports a
 * press on the page or sidebar view or the window losing focus (which this document never sees).
 */
export function usePopoverDismiss(open: boolean, containerRef: React.RefObject<HTMLElement | null>, close: () => void, options: PopoverDismissOptions = {}): void {
  // Latest callback/options without re-subscribing every render.
  const latest = useRef({ close, options })
  latest.current = { close, options }
  useEffect(() => {
    if (!open) return
    const kind = latest.current.options.kind ?? 'popover'
    const dismiss = (): void => latest.current.close()
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) dismiss()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (latest.current.options.preventEscapeDefault) event.preventDefault()
      dismiss()
      latest.current.options.returnFocusRef?.current?.focus()
    }
    const onBlur = (): void => {
      if (kind === 'popover' && blurDismissesPopover(document.activeElement?.tagName)) dismiss()
    }
    const onRequest = (event: Event): void => {
      if (dismissReasonCloses(kind, normalizeDismissReason((event as CustomEvent).detail))) dismiss()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    window.addEventListener(POPOVER_DISMISS_EVENT, onRequest)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener(POPOVER_DISMISS_EVENT, onRequest)
    }
  }, [open])
}
