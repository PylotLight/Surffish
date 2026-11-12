/**
 * The collapsed rail's pinned sites as one row: every pin's mark stacked a little over the next,
 * like a group of avatars, so pins take one rail row however many there are and the open tabs
 * start right below them (SidebarRail.tsx). The panel keeps its own full pins row.
 *
 * The cluster is the panel's pins row folded up, in the SAME order: slot i draws pin i, the first
 * pin is in front (on top of the stack, leftmost) and sits exactly where the panel draws its first
 * pin, so it never moves between the two shapes; the active pin is marked by its ring only, never
 * brought forward. Past `maxSlots` pins the last slot is a "+N" chip for the rest. On a shape
 * change each drawn pin glides between its cluster slot and its row slot (shared/sidebar-morph.ts
 * `glide`, horizontally only); pins behind the chip fade in or out at their row slot.
 *
 * Pure: the slot maths is unit-tested without a document.
 */

/** Most slots the cluster draws; past this the last slot is a "+N" chip for the rest. */
export const RAIL_PIN_CLUSTER_MAX_SLOTS = 4;
/** A mark's size in the cluster: the panel's pin mark size, so the two read as the same icons. */
export const RAIL_PIN_CLUSTER_MARK = 24;
/** Widest the cluster may get: inside the 84px rail with room on both sides. */
export const RAIL_PIN_CLUSTER_MAX_WIDTH = 60;
/** Furthest apart two marks sit (fewer pins spread no wider than this). */
export const RAIL_PIN_CLUSTER_MAX_STEP = 12;

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
 * Lays out `count` pins as one overlapping row in pin order: the first pin in front, each later
 * one tucked a step to the right behind it, and the "+N" chip (when there are more pins than
 * slots) last and drawn on top so its count is never covered.
 */
export function planRailPinCluster(
  count: number,
  {
    maxSlots = RAIL_PIN_CLUSTER_MAX_SLOTS,
    mark = RAIL_PIN_CLUSTER_MARK,
    maxWidth = RAIL_PIN_CLUSTER_MAX_WIDTH,
    maxStep = RAIL_PIN_CLUSTER_MAX_STEP,
  }: {
    maxSlots?: number;
    mark?: number;
    maxWidth?: number;
    maxStep?: number;
  } = {},
): RailPinCluster {
  const total = Math.max(0, Math.floor(count));
  if (total === 0) return { slots: [], overflow: 0, step: 0, width: 0 };
  const slotLimit = Math.max(1, Math.floor(maxSlots));
  const chip = total > slotLimit;
  const markSlots = chip ? slotLimit - 1 : total;
  const overflow = chip ? total - markSlots : 0;
  const slotCount = markSlots + (chip ? 1 : 0);
  const step =
    slotCount > 1
      ? Math.max(
          0,
          Math.min(maxStep, Math.floor((maxWidth - mark) / (slotCount - 1))),
        )
      : 0;
  const slots: RailPinClusterSlot[] = Array.from(
    { length: markSlots },
    (_, slot) => ({ pin: slot, x: slot * step, z: slotCount - slot }),
  );
  if (chip) slots.push({ pin: null, x: markSlots * step, z: slotCount + 1 });
  return { slots, overflow, step, width: mark + (slotCount - 1) * step };
}

/** A pin's motion key, the same in the rail's cluster and the panel's row (`pin:`/`site:`). */
export function isPinMotionKey(key: string): boolean {
  return key.startsWith("pin:") || key.startsWith("site:");
}
