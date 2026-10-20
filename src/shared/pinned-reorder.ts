/**
 * Pinned strip reordering (the row of pinned tab and Favourites icons at the top of the sidebar).
 *
 * Pins only move with the reorder modifier held (Cmd on macOS, Ctrl elsewhere), so a stray drag on
 * an icon never shuffles them. Pinned tabs and Favourites each reorder among their own kind.
 */

/** True when the reorder modifier is down: Cmd on macOS, Ctrl on Windows / Linux. */
export function isPinReorderModifier(event: { metaKey: boolean; ctrlKey: boolean }, isMac: boolean): boolean {
  return isMac ? event.metaKey : event.ctrlKey
}

/**
 * The slot a dragged pin lands in, from how far it moved along the row. A neighbour is passed once
 * the dragged icon's centre crosses the neighbour's centre.
 */
export function pinDropIndex(slots: ReadonlyArray<{ left: number; width: number }>, from: number, dx: number): number {
  const dragged = slots[from]
  if (!dragged) return from
  const center = dragged.left + dragged.width / 2 + dx
  let target = 0
  slots.forEach((slot, index) => {
    if (index !== from && slot.left + slot.width / 2 < center) target += 1
  })
  return target
}

/** `ids` with the item at `from` moved to `to`. */
export function movePin(ids: readonly string[], from: number, to: number): string[] {
  const next = ids.slice()
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return ids.slice()
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
  return next
}

/** After moving `from` to `to`: the id the moved pin now sits before (null = it is last). */
export function pinBeforeId(ids: readonly string[], from: number, to: number): string | null {
  const next = movePin(ids, from, to)
  const at = next.indexOf(ids[from]!)
  return next[at + 1] ?? null
}

/**
 * Move Pin Left / Right (the tab menu fallback): the `beforeId` to hand to a tab move, or undefined
 * when the pin is already at that end. `null` means "after every other pin".
 */
export function pinStepBeforeId(ids: readonly string[], id: string, direction: -1 | 1): string | null | undefined {
  const from = ids.indexOf(id)
  if (from < 0) return undefined
  const to = from + direction
  if (to < 0 || to >= ids.length) return undefined
  return pinBeforeId(ids, from, to)
}
