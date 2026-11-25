/**
 * The collapsed rail's pinned sites as one row: the first pin's mark, then a "+N" chip for the
 * rest, side by side with a small gap (no overlap), so pins take one rail row however many there
 * are and the open tabs start right below them (SidebarRail.tsx). The panel keeps its own full
 * pins row.
 *
 * The first pin sits exactly where the panel draws its first pin, so it never moves between the
 * two shapes; the active pin is marked by its ring only. On a shape change the first pin holds
 * still and the pins behind the chip fade in or out at their row slot (shared/sidebar-morph.ts).
 *
 * Pure: the slot maths is unit-tested without a document.
 */

/** Pin marks the cluster draws before the "+N" chip takes over. */
export const RAIL_PIN_CLUSTER_MAX_SLOTS = 1;
/** A mark's size in the cluster: the panel's pin mark size, so the two read as the same icons. */
export const RAIL_PIN_CLUSTER_MARK = 24;
/** Widest the cluster may get: inside the 84px rail with room on both sides. */
export const RAIL_PIN_CLUSTER_MAX_WIDTH = 60;
/** Space between the mark and the "+N" chip. */
export const RAIL_PIN_CLUSTER_GAP = 4;

export interface RailPinClusterSlot {
  /** Index into the pins list this slot draws (always the slot's own index), or null for "+N". */
  pin: number | null;
  /** Left offset inside the cluster (px), from the first pin's left edge. */
  x: number;
  /** Stacking order: higher is drawn on top. */
  z: number;
}

export interface RailPinCluster {
  slots: RailPinClusterSlot[];
  /** How many pins the "+N" chip stands for (0: no chip). */
  overflow: number;
  /** px between one slot's left edge and the next. */
  step: number;
  /** The cluster's resting width (px). */
  width: number;
}

/**
 * Lays out `count` pins as one row in pin order: up to `maxSlots` marks, then a "+N" chip for the
 * rest, each a step to the right with a gap so nothing overlaps.
 */
export function planRailPinCluster(
  count: number,
  {
    maxSlots = RAIL_PIN_CLUSTER_MAX_SLOTS,
    mark = RAIL_PIN_CLUSTER_MARK,
    maxWidth = RAIL_PIN_CLUSTER_MAX_WIDTH,
    gap = RAIL_PIN_CLUSTER_GAP,
  }: {
    maxSlots?: number;
    mark?: number;
    maxWidth?: number;
    gap?: number;
  } = {},
): RailPinCluster {
  const total = Math.max(0, Math.floor(count));
  if (total === 0) return { slots: [], overflow: 0, step: 0, width: 0 };
  const markLimit = Math.max(1, Math.floor(maxSlots));
  const markSlots = Math.min(total, markLimit);
  const overflow = total - markSlots;
  const slotCount = markSlots + (overflow > 0 ? 1 : 0);
  const step =
    slotCount > 1
      ? Math.max(
          0,
          Math.min(mark + gap, Math.floor((maxWidth - mark) / (slotCount - 1))),
        )
      : 0;
  const slots: RailPinClusterSlot[] = Array.from(
    { length: markSlots },
    (_, slot) => ({ pin: slot, x: slot * step, z: slotCount - slot }),
  );
  if (overflow > 0)
    slots.push({ pin: null, x: markSlots * step, z: slotCount + 1 });
  return { slots, overflow, step, width: mark + (slotCount - 1) * step };
}

/** A pin's motion key, the same in the rail's cluster and the panel's row (`pin:`/`site:`). */
export function isPinMotionKey(key: string): boolean {
  return key.startsWith("pin:") || key.startsWith("site:");
}
