import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

const DRAG_THRESHOLD_PX = 4;
const SETTLE_MS = 200;
const ITEM_SELECTOR = "[data-browser-tab-id]";

type Slot = { id: string; top: number; height: number; el: HTMLElement };
type DragState = {
  id: string;
  pointerId: number;
  startY: number;
  started: boolean;
  slots: Slot[];
  from: number;
  target: number;
  pitch: number;
  minDy: number;
  maxDy: number;
  /** The pointer is outside this surface (past the window edge, or over the page or another window). */
  outside: boolean;
};

/** True when a pointer at (x, y) has left a surface of the given size. Pure so it can be tested. */
export function isOutsideSurface(
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return x < 0 || y < 0 || x >= width || y >= height;
}

/** Work out where the dragged tab lands from how far it moved. Pure so it can be tested. */
export function dragTargetIndex(
  slots: ReadonlyArray<{ top: number; height: number }>,
  from: number,
  dy: number,
): number {
  const dragged = slots[from];
  if (!dragged) return from;
  const center = dragged.top + dragged.height / 2 + dy;
  let target = 0;
  slots.forEach((slot, index) => {
    if (index !== from && slot.top + slot.height / 2 < center) target += 1;
  });
  return target;
}

/** Move one id within a list. */
export function reorderIds(
  ids: readonly string[],
  from: number,
  to: number,
): string[] {
  const next = ids.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(to, 0, moved);
  return next;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * Pointer-driven drag-to-sort for the vertical tab list with FLIP animations.
 * Neighbours slide out of the way while dragging, the dropped tab glides into its slot,
 * and new / closed / reordered tabs animate too.
 */
export function useTabDragSort(
  ids: readonly string[],
  onMove: (id: string, beforeId: string | null) => void,
  onDropOutside?: (id: string) => void,
  onOutsideChange?: (id: string | null) => void,
) {
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const lastTops = useRef(new Map<string, number>());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);

  const orderedIds = useMemo(() => {
    if (pending && sameSet(pending, ids)) return pending;
    return ids.slice();
  }, [ids, pending]);

  // Drop the optimistic order once main confirms it (or the tab set changes under us).
  useLayoutEffect(() => {
    if (!pending) return;
    if (
      !sameSet(pending, ids) ||
      pending.every((id, index) => ids[index] === id)
    )
      setPending(null);
  }, [ids, pending]);

  const items = useCallback((): HTMLElement[] => {
    const list = listRef.current;
    return list
      ? Array.from(list.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
      : [];
  }, []);

  /**
   * Snapshot each tab's position in list-content coordinates, so list scrolling or things above
   * the list changing height can't masquerade as movement. By default this is the layout slot
   * (offsetTop ignores transforms) — measuring mid-FLIP with getBoundingClientRect would record the
   * inverted start positions, and the next open/close would replay that stale offset as a jump.
   * `visual` captures where tabs are drawn right now, for gliding out of a drag.
   */
  const rememberTops = useCallback(
    (visual = false): void => {
      const list = listRef.current;
      const next = new Map<string, number>();
      const listTop = list
        ? list.getBoundingClientRect().top + list.clientTop - list.scrollTop
        : 0;
      for (const el of items()) {
        const id = el.dataset.browserTabId;
        if (!id) continue;
        next.set(
          id,
          visual ? el.getBoundingClientRect().top - listTop : el.offsetTop,
        );
      }
      lastTops.current = next;
    },
    [items],
  );

  // FLIP: animate every tab from where it was drawn last to where it is now.
  const orderKey = orderedIds.join("|");
  useLayoutEffect(() => {
    if (drag.current?.started) return;
    const els = items();
    // A collapsed sidebar view is zero-width; its layout isn't what the user will see, so don't animate from it.
    const listHidden = (listRef.current?.clientWidth ?? 0) === 0;
    const reduceMotion =
      listHidden ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const moved: HTMLElement[] = [];
    for (const el of els) {
      el.style.transition = "none";
      el.style.transform = "";
      el.style.zIndex = "";
    }
    for (const el of els) {
      const id = el.dataset.browserTabId;
      const before = id ? lastTops.current.get(id) : undefined;
      if (before === undefined || reduceMotion) continue;
      const delta = before - el.offsetTop;
      if (Math.abs(delta) < 0.5) continue;
      el.style.transform = `translateY(${delta}px)`;
      moved.push(el);
    }
    if (moved.length > 0) {
      void listRef.current?.offsetHeight; // commit the inverted positions
      for (const el of moved) {
        el.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
        el.style.transform = "";
      }
      window.setTimeout(() => {
        for (const el of moved) el.style.transition = "";
      }, SETTLE_MS + 20);
    }
    for (const el of els) if (!moved.includes(el)) el.style.transition = "";
    rememberTops();
  }, [orderKey, items, rememberTops]);

  const finish = useCallback(
    (commit: boolean): void => {
      const state = drag.current;
      drag.current = null;
      setDraggingId(null);
      if (!state?.started) return;
      // After the drop (same IPC pipe, so main sees the drop first): clears any mini window drop hint.
      const wasOutside = state.outside;
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      const dragged = state.slots[state.from];
      if (dragged) dragged.el.style.opacity = "";
      // Dropped outside the list: main moves it to the window under the pointer or tears it into a new one.
      const droppedOutside =
        commit && state.outside && onDropOutside !== undefined;
      if (droppedOutside) onDropOutside(state.id);
      if (wasOutside) onOutsideChange?.(null);
      if (commit && !droppedOutside && state.target !== state.from) {
        // Capture where everything is drawn right now (mid-drag) so the FLIP pass glides from there.
        rememberTops(true);
        const order = state.slots.map((slot) => slot.id);
        const next = reorderIds(order, state.from, state.target);
        setPending(next);
        onMove(state.id, next[state.target + 1] ?? null);
      } else {
        // Order didn't change, so no FLIP pass will refresh the snapshot: keep the layout slots.
        rememberTops();
        // Snap back with the same easing.
        for (const slot of state.slots) {
          slot.el.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
          slot.el.style.transform = "";
          window.setTimeout(() => {
            slot.el.style.transition = "";
            slot.el.style.zIndex = "";
          }, SETTLE_MS + 20);
        }
      }
    },
    [onMove, onDropOutside, onOutsideChange, rememberTops],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string): void => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button"))
        return;
      drag.current = {
        id,
        pointerId: event.pointerId,
        startY: event.clientY,
        started: false,
        slots: [],
        from: -1,
        target: -1,
        pitch: 0,
        minDy: 0,
        maxDy: 0,
        outside: false,
      };
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const state = drag.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const dy = event.clientY - state.startY;
      if (!state.started) {
        if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        const slots: Slot[] = items().flatMap((el) => {
          const id = el.dataset.browserTabId;
          if (!id) return [];
          const rect = el.getBoundingClientRect();
          return [{ id, top: rect.top, height: rect.height, el }];
        });
        const from = slots.findIndex((slot) => slot.id === state.id);
        if (from < 0) {
          drag.current = null;
          return;
        }
        const dragged = slots[from]!;
        const style = getComputedStyle(dragged.el);
        state.pitch =
          dragged.height +
          parseFloat(style.marginTop || "0") +
          parseFloat(style.marginBottom || "0");
        state.slots = slots;
        state.from = from;
        state.target = from;
        state.minDy = (slots[0]?.top ?? dragged.top) - dragged.top;
        state.maxDy = (slots.at(-1)?.top ?? dragged.top) - dragged.top;
        state.started = true;
        try {
          (event.currentTarget as HTMLElement).setPointerCapture(
            event.pointerId,
          );
        } catch {
          /* pointer gone */
        }
        dragged.el.style.zIndex = "3";
        setDraggingId(state.id);
      }
      const clamped = Math.max(state.minDy - 8, Math.min(state.maxDy + 8, dy));
      const dragged = state.slots[state.from]!;
      if (onDropOutside) {
        const outside = isOutsideSurface(
          event.clientX,
          event.clientY,
          window.innerWidth,
          window.innerHeight,
        );
        if (outside !== state.outside)
          onOutsideChange?.(outside ? state.id : null);
        state.outside = outside;
        // Faded while it would leave the window on release.
        dragged.el.style.opacity = state.outside ? "0.55" : "";
      }
      dragged.el.style.transition = "none";
      dragged.el.style.transform = `translateY(${clamped}px) scale(1.02)`;
      const target = dragTargetIndex(state.slots, state.from, clamped);
      if (target !== state.target) {
        state.target = target;
        state.slots.forEach((slot, index) => {
          if (index === state.from) return;
          let shift = 0;
          if (index > state.from && index <= target) shift = -state.pitch;
          else if (index < state.from && index >= target) shift = state.pitch;
          slot.el.style.transform = shift ? `translateY(${shift}px)` : "";
        });
      }
      event.preventDefault();
    },
    [items, onDropOutside, onOutsideChange],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (drag.current?.pointerId === event.pointerId) finish(true);
    },
    [finish],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (drag.current?.pointerId === event.pointerId) finish(false);
    },
    [finish],
  );

  const onClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>): void => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.stopPropagation();
      event.preventDefault();
    },
    [],
  );

  /** Keyboard reorder (⌥⇧↑ / ⌥⇧↓). */
  const moveBy = useCallback(
    (id: string, offset: number): void => {
      const from = orderedIds.indexOf(id);
      const to = Math.max(0, Math.min(orderedIds.length - 1, from + offset));
      if (from < 0 || to === from) return;
      rememberTops();
      const next = reorderIds(orderedIds, from, to);
      setPending(next);
      onMove(id, next[to + 1] ?? null);
    },
    [orderedIds, onMove, rememberTops],
  );

  const itemHandlers = useCallback(
    (id: string) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) =>
        onPointerDown(event, id),
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
    }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel],
  );

  return {
    listRef,
    orderedIds,
    draggingId,
    itemHandlers,
    onClickCapture,
    moveBy,
  };
}
