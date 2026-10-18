import { useEffect, useMemo, useRef, useState } from 'react'
import { moveToolbarItem, togglePinned, TOOLBAR_ITEMS, type ToolbarItemId, type ToolbarLayout } from '../../../../shared/toolbar-layout'
import { usePopoverDismiss } from '../../lib/popover-dismiss'
import { useMenuKeyboard } from './SurffishMenu'
import { ToolbarSlotContext, type ToolbarSlot } from './toolbar-slot'

/** Pointer travel before a press on a button becomes a drag. */
const DRAG_THRESHOLD_PX = 5

interface DragState {
  id: ToolbarItemId
  pointerId: number
  startX: number
  dragging: boolean
  /** Visible slots' boxes, read once when the drag starts (no layout reads while moving). */
  boxes: Array<{ id: ToolbarItemId; left: number; right: number }>
}

/** Where a drag would land, from the pointer's x and the slots' boxes. */
function dropTarget(boxes: DragState['boxes'], x: number): { id: ToolbarItemId; after: boolean } | null {
  if (boxes.length === 0) return null
  for (const box of boxes) {
    if (x < (box.left + box.right) / 2) return { id: box.id, after: false }
  }
  return { id: boxes[boxes.length - 1]!.id, after: true }
}

/** A press inside a button's open popover (its list, a slider) is not a press on the button. */
function inPopover(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="dialog"], [role="menu"], [role="listbox"], [id$="-popover"], [id$="-popup"], [id$="-menu"]') !== null
}

function firstVisibleButton(slot: Element | null | undefined): HTMLElement | null {
  return slot?.querySelector<HTMLElement>('button:not([hidden])') ?? null
}

/**
 * The toolbar's right-hand buttons in layout order (shared/toolbar-layout.ts). Every button stays
 * mounted; one that isn't on the toolbar is `folded` (hidden, its popover anchored at the Surffish
 * menu button). Right-click a button for Pin / Unpin / Customize toolbar…; drag one to reorder.
 */
export function ToolbarItems({ layout, onLayoutChange, shown, items, itemsRef, menuButtonRef, onCustomize, onMenuOpenChange }: {
  layout: ToolbarLayout
  onLayoutChange: (next: ToolbarLayout) => void
  /** Ids on the toolbar right now (wanted and not folded by the window width). */
  shown: ReadonlySet<ToolbarItemId>
  /** The button per id; ids without one (not in this surface) are skipped. */
  items: Partial<Record<ToolbarItemId, React.ReactNode>>
  itemsRef: React.RefObject<HTMLDivElement | null>
  menuButtonRef: React.RefObject<HTMLButtonElement | null>
  onCustomize: () => void
  onMenuOpenChange?: (open: boolean) => void
}): React.JSX.Element {
  const slotValues = useMemo((): Record<'shown' | 'folded', ToolbarSlot> => ({
    shown: { folded: false, menuButtonRef },
    folded: { folded: true, menuButtonRef }
  }), [menuButtonRef])
  const [menu, setMenu] = useState<{ id: ToolbarItemId; right: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: ToolbarItemId; drop: { id: ToolbarItemId; after: boolean } | null } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const latest = useRef({ layout, onLayoutChange })
  latest.current = { layout, onLayoutChange }

  useEffect(() => { onMenuOpenChange?.(menu !== null) }, [menu !== null])
  const menuTarget = useRef<ToolbarItemId | null>(null)
  menuTarget.current = menu?.id ?? null
  const menuReturnFocus = useMemo(() => ({
    get current(): HTMLElement | null {
      const id = menuTarget.current
      return id ? firstVisibleButton(itemsRef.current?.querySelector(`[data-toolbar-item="${id}"]`)) ?? menuButtonRef.current : null
    }
  }) as React.RefObject<HTMLElement | null>, [])
  usePopoverDismiss(menu !== null, menuRef, () => setMenu(null), { returnFocusRef: menuReturnFocus, preventEscapeDefault: true })
  const onMenuKeyDown = useMenuKeyboard(menuRef, menu !== null)

  const openMenu = (id: ToolbarItemId, event: React.MouseEvent): void => {
    // Extension icons use right-click for their own options page.
    if (event.defaultPrevented || inPopover(event.target)) return
    event.preventDefault()
    const trailing = itemsRef.current?.parentElement?.getBoundingClientRect()
    const x = event.clientX || (event.currentTarget as HTMLElement).getBoundingClientRect().left + 12
    setMenu({ id, right: trailing ? Math.max(0, Math.round(trailing.right - x - 16)) : 0 })
  }

  const endDrag = (): void => {
    dragRef.current = null
    setDrag(null)
  }

  useEffect(() => {
    if (!drag) return
    const onMove = (event: PointerEvent): void => {
      const state = dragRef.current
      if (!state || event.pointerId !== state.pointerId) return
      const drop = dropTarget(state.boxes, event.clientX)
      setDrag((current) => current && (current.drop?.id !== drop?.id || current.drop?.after !== drop?.after) ? { ...current, drop } : current)
    }
    const onUp = (event: PointerEvent): void => {
      const state = dragRef.current
      if (!state || event.pointerId !== state.pointerId) return
      const drop = dropTarget(state.boxes, event.clientX)
      if (drop && drop.id !== state.id) latest.current.onLayoutChange(moveToolbarItem(latest.current.layout, state.id, drop.id, drop.after))
      // The release would also click the dragged button: swallow that one click.
      const swallow = (click: MouseEvent): void => { click.preventDefault(); click.stopPropagation() }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
      endDrag()
    }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') endDrag() }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', endDrag)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', endDrag)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', endDrag)
    }
  }, [drag !== null])

  const onPointerDown = (id: ToolbarItemId, event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !shown.has(id) || inPopover(event.target)) return
    const slot = event.currentTarget
    const start: DragState = { id, pointerId: event.pointerId, startX: event.clientX, dragging: false, boxes: [] }
    const onMove = (move: PointerEvent): void => {
      if (move.pointerId !== start.pointerId || Math.abs(move.clientX - start.startX) < DRAG_THRESHOLD_PX) return
      stop()
      // Only now: capturing on press would retarget the click away from the button.
      try { slot.setPointerCapture(start.pointerId) } catch { /* pointer already gone */ }
      start.dragging = true
      start.boxes = Array.from(itemsRef.current?.querySelectorAll<HTMLElement>('.toolbar-slot[data-toolbar-item]:not(.is-folded)') ?? [])
        .filter((element) => element.dataset.toolbarItem !== id)
        .map((element) => {
          const box = element.getBoundingClientRect()
          return { id: element.dataset.toolbarItem as ToolbarItemId, left: box.left, right: box.right }
        })
      dragRef.current = start
      setMenu(null)
      setDrag({ id, drop: dropTarget(start.boxes, move.clientX) })
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  const menuItem = menu ? TOOLBAR_ITEMS[menu.id] : null
  const menuPinned = menu ? layout.placement[menu.id] === 'pinned' : false
  return (
    <>
      <div className={`omnibox-actions toolbar-items${drag ? ' is-dragging' : ''}`} role="group" aria-label="Toolbar buttons" ref={itemsRef}>
        {layout.order.map((id) => {
          if (items[id] === undefined) return null
          const folded = !shown.has(id)
          const drop = drag?.drop?.id === id ? (drag.drop.after ? ' is-drop-after' : ' is-drop-before') : ''
          return (
            <div
              key={id}
              className={`toolbar-slot${folded ? ' is-folded' : ''}${drag?.id === id ? ' is-drag-source' : ''}${drop}`}
              data-toolbar-item={id}
              onContextMenu={folded ? undefined : (event) => openMenu(id, event)}
              onPointerDown={folded ? undefined : (event) => onPointerDown(id, event)}
            >
              <ToolbarSlotContext.Provider value={folded ? slotValues.folded : slotValues.shown}>
                {items[id]}
              </ToolbarSlotContext.Provider>
            </div>
          )
        })}
      </div>
      {menu && menuItem && (
        <div id="toolbar-item-menu" className="toolbar-item-menu" role="menu" aria-label={`${menuItem.label} toolbar options`} ref={menuRef} style={{ right: menu.right }} onKeyDown={onMenuKeyDown}>
          <button type="button" role="menuitem" className="toolbar-item-menu-item" data-action={menuPinned ? 'unpin' : 'pin'} onClick={() => { setMenu(null); onLayoutChange(togglePinned(layout, menu.id)) }}>
            {menuPinned ? 'Unpin' : 'Pin to toolbar'}
            {menuPinned && menuItem.contextual && <small>Shows when needed</small>}
          </button>
          <div className="toolbar-item-menu-separator" role="separator" />
          <button type="button" role="menuitem" className="toolbar-item-menu-item" data-action="customize" onClick={() => { setMenu(null); onCustomize() }}>
            Customize toolbar…
          </button>
        </div>
      )}
    </>
  )
}
