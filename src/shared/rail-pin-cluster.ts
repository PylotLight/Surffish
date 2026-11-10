/**
 * The collapsed rail's pinned sites as one row: every pin's mark stacked a little over the next,
 * like a group of avatars, so pins take one rail row however many there are and the open tabs
 * start right below them (SidebarRail.tsx). The panel keeps its own full pins row.
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
  /** Index into the pins list this slot draws, or null for the "+N" chip. */
  pin: number | null;
  /** Left offset inside the cluster (px). */
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
 * Lays out `count` pins as one overlapping row. The front mark (on top of the stack, leftmost) is
 * the active pin when one is active, else the first pin; the rest follow in pin order. Past
 * `maxSlots` pins the last slot is a "+N" chip, drawn on top so its count is never covered.
 */
export function planRailPinCluster(
  count: number,
  {
    activeIndex = -1,
    maxSlots = RAIL_PIN_CLUSTER_MAX_SLOTS,
    mark = RAIL_PIN_CLUSTER_MARK,
    maxWidth = RAIL_PIN_CLUSTER_MAX_WIDTH,
    maxStep = RAIL_PIN_CLUSTER_MAX_STEP,
  }: {
    activeIndex?: number;
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
  const front =
    Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < total
      ? activeIndex
      : 0;
  const order = [front];
  for (let index = 0; index < total && order.length < markSlots; index += 1)
    if (index !== front) order.push(index);
  const slots: RailPinClusterSlot[] = order
    .slice(0, markSlots)
    .map((pin, slot) => ({ pin, x: slot * step, z: slotCount - slot }));
  if (chip) slots.push({ pin: null, x: markSlots * step, z: slotCount + 1 });
  return { slots, overflow, step, width: mark + (slotCount - 1) * step };
}
