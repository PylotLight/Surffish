import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { ToolbarItemId } from '../../../../shared/toolbar-layout'

/**
 * What a toolbar button needs to know about its slot (shared/toolbar-layout.ts): folded means it
 * isn't on the toolbar (unpinned, contextual and idle, or the window is too narrow) but stays
 * mounted, hidden, so the Surffish menu can still open its popover (anchored at the menu button).
 */
export interface ToolbarSlot {
  folded: boolean
  menuButtonRef: React.RefObject<HTMLButtonElement | null> | null
}

export const ToolbarSlotContext = createContext<ToolbarSlot>({ folded: false, menuButtonRef: null })

export function useToolbarSlot(): ToolbarSlot {
  return useContext(ToolbarSlotContext)
}

const OPEN_EVENT = 'surffish:toolbar-open'

/** The Surffish menu asks a folded button to open its popover. */
export function requestToolbarOpen(id: ToolbarItemId): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))
}

export function useToolbarOpenRequest(id: ToolbarItemId, open: () => void): void {
  const latest = useRef(open)
  latest.current = open
  useEffect(() => {
    const onOpen = (event: Event): void => { if ((event as CustomEvent).detail === id) latest.current() }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [id])
}

/** Where Escape sends focus back: the button, or the Surffish menu button while it's folded. */
export function useReturnFocusRef(buttonRef: React.RefObject<HTMLElement | null>): React.RefObject<HTMLElement | null> {
  const slot = useToolbarSlot()
  const slotRef = useRef(slot)
  slotRef.current = slot
  return useMemo(() => ({
    get current(): HTMLElement | null {
      const { folded, menuButtonRef } = slotRef.current
      return folded ? menuButtonRef?.current ?? null : buttonRef.current
    }
  }) as React.RefObject<HTMLElement | null>, [buttonRef])
}

/**
 * Badges of folded buttons (the ad-blocker count, Reading List unread) for the Surffish menu's rows.
 * A tiny store outside React state, so a count change re-renders the menu (when open), never the
 * whole toolbar.
 */
const badges = new Map<ToolbarItemId, string>()
const badgeListeners = new Set<() => void>()
let badgeVersion = 0

export function setToolbarBadge(id: ToolbarItemId, badge: string): void {
  if ((badges.get(id) ?? '') === badge) return
  if (badge) badges.set(id, badge)
  else badges.delete(id)
  badgeVersion += 1
  for (const listener of badgeListeners) listener()
}

export function useToolbarBadges(): ReadonlyMap<ToolbarItemId, string> {
  useSyncExternalStore((listener) => {
    badgeListeners.add(listener)
    return () => badgeListeners.delete(listener)
  }, () => badgeVersion)
  return badges
}
