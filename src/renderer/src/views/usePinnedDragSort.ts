import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import {
  isPinReorderModifier,
  movePin,
  pinBeforeId,
  pinDropIndex,
} from "../../../shared/pinned-reorder";

const DRAG_THRESHOLD_PX = 4;
const SETTLE_MS = 180;

type Slot = { id: string; left: number; width: number; el: HTMLElement };
type DragState = {
  id: string;
  pointerId: number;
  startX: number;
  started: boolean;
  slots: Slot[];
  from: number;
  target: number;
  pitch: number;
  minDx: number;
  maxDx: number;
};

/**
 * Whether the pin reorder modifier (Cmd on macOS, Ctrl elsewhere) is held. The sidebar is its own
 * web contents and often not focused, so this reads the modifier off pointer events over the strip
 * as well as key events: `track` goes on the strip's pointer handlers.
 */
export function usePinReorderModifier(isMac: boolean): {
  armed: boolean;
  track: (event: { metaKey: boolean; ctrlKey: boolean }) => void;
  disarm: () => void;
} {
  const [armed, setArmed] = useState(false);
  const track = useCallback(
    (event: { metaKey: boolean; ctrlKey: boolean }) =>
      setArmed(isPinReorderModifier(event, isMac)),
    [isMac],
  );
  const disarm = useCallback(() => setArmed(false), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void =>
      setArmed(isPinReorderModifier(event, isMac));
    const off = (): void => setArmed(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", off);
    };
  }, [isMac]);
  return { armed, track, disarm };
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * Cmd+drag (Ctrl+drag on Windows / Linux) to reorder one kind of pin along the horizontal pinned
 * strip. A plain drag does nothing, so pins never move by accident. Neighbours slide aside while
 * dragging; the drop is shown at once (optimistic order) and confirmed when main's list arrives.
 *
 * Items are the elements in `listRef` matching `[data-pin-kind=<kind>]`, each with `data-pin-id`.
 */
export function usePinnedDragSort(
  listRef: RefObject<HTMLElement | null>,
  kind: string,
  ids: readonly string[],
  isMac: boolean,
  onMove: (id: string, beforeId: string | null, order: string[]) => void,
) {
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);

  const orderedIds = useMemo(
    () => (pending && sameSet(pending, ids) ? pending : ids.slice()),
    [ids, pending],
  );
  useLayoutEffect(() => {
    if (
      pending &&
      (!sameSet(pending, ids) ||
        pending.every((id, index) => ids[index] === id))
    )
      setPending(null);
  }, [ids, pending]);

  const items = useCallback((): HTMLElement[] => {
    const list = listRef.current;
    return list
      ? Array.from(
          list.querySelectorAll<HTMLElement>(`[data-pin-kind="${kind}"]`),
        )
      : [];
  }, [listRef, kind]);

  const reset = useCallback(
    (animate: boolean): void => {
      for (const el of items()) {
        el.style.transition = animate
          ? `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
          : "none";
        el.style.transform = "";
        el.style.zIndex = "";
        el.classList.remove("is-pin-dragging");
      }
      if (animate)
        window.setTimeout(() => {
          for (const el of items()) el.style.transition = "";
        }, SETTLE_MS + 20);
    },
    [items],
  );

  // The new order is in the DOM: clear the drag offsets without a jump.
  const orderKey = orderedIds.join("|");
  useLayoutEffect(() => {
    if (drag.current?.started) return;
    reset(false);
    void listRef.current?.offsetWidth;
    for (const el of items()) el.style.transition = "";
  }, [orderKey, items, reset, listRef]);

  const finish = useCallback(
    (commit: boolean): void => {
      const state = drag.current;
      drag.current = null;
      setDraggingId(null);
      if (!state?.started) return;
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      const order = state.slots.map((slot) => slot.id);
      if (!commit || state.target === state.from) {
        reset(true);
        return;
      }
      const next = movePin(order, state.from, state.target);
      setPending(next);
      onMove(state.id, pinBeforeId(order, state.from, state.target), next);
    },
    [onMove, reset],
  );

  useEffect(() => {
    if (!draggingId) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [draggingId, finish]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string): void => {
      // Plain presses (and other buttons) keep their normal click / context menu behaviour.
      if (
        event.button !== 0 ||
        !isPinReorderModifier(event, isMac) ||
        drag.current
      )
        return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = {
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        started: false,
        slots: [],
        from: -1,
        target: -1,
        pitch: 0,
        minDx: 0,
        maxDx: 0,
      };
    },
    [isMac],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const state = drag.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const dx = event.clientX - state.startX;
      if (!state.started) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        const slots = items().flatMap((el): Slot[] => {
          const id = el.dataset.pinId;
          if (!id) return [];
          const rect = el.getBoundingClientRect();
          return [{ id, left: rect.left, width: rect.width, el }];
        });
        const from = slots.findIndex((slot) => slot.id === state.id);
        if (from < 0 || slots.length < 2) {
          drag.current = null;
          return;
        }
        const first = slots[0]!;
        const last = slots[slots.length - 1]!;
        const dragged = slots[from]!;
        state.started = true;
        state.slots = slots;
        state.from = from;
        state.target = from;
        state.pitch = (last.left - first.left) / (slots.length - 1);
        state.minDx = first.left - dragged.left;
        state.maxDx = last.left - dragged.left;
        for (const slot of slots)
          slot.el.style.transition =
            slot.id === state.id
              ? "none"
              : `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
        dragged.el.classList.add("is-pin-dragging");
        dragged.el.style.zIndex = "2";
        setDraggingId(state.id);
      }
      const clamped = Math.max(state.minDx, Math.min(state.maxDx, dx));
      state.slots[state.from]!.el.style.transform = `translateX(${clamped}px)`;
      // The icon stops at the ends of the row, but the drop slot follows the pointer (dragging past the
      // last pin lands after it).
      const target = pinDropIndex(state.slots, state.from, dx);
      if (target === state.target) return;
      state.target = target;
      state.slots.forEach((slot, index) => {
        if (index === state.from) return;
        const shift =
          state.from < target && index > state.from && index <= target
            ? -state.pitch
            : state.from > target && index >= target && index < state.from
              ? state.pitch
              : 0;
        slot.el.style.transform = shift ? `translateX(${shift}px)` : "";
      });
    },
    [items],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (drag.current?.pointerId !== event.pointerId) return;
      finish(true);
    },
    [finish],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (drag.current?.pointerId !== event.pointerId) return;
      finish(false);
    },
    [finish],
  );

  /** The click that ends a drag must not open the pin. */
  const onClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>): void => {
      if (!suppressClick.current) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  return {
    orderedIds,
    draggingId,
    itemProps: {
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
      onClickCapture,
    },
    onPointerDown,
  };
}
