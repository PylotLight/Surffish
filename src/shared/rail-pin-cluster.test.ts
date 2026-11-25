import { describe, expect, test } from "bun:test";
import {
  RAIL_PIN_CLUSTER_MARK,
  RAIL_PIN_CLUSTER_MAX_WIDTH,
  isPinMotionKey,
  planRailPinCluster,
} from "./rail-pin-cluster";

describe("planRailPinCluster", () => {
  test("no pins, no cluster", () => {
    expect(planRailPinCluster(0)).toEqual({
      slots: [],
      overflow: 0,
      step: 0,
      width: 0,
    });
  });

  test("one pin is a single mark", () => {
    const plan = planRailPinCluster(1);
    expect(plan.slots).toEqual([{ pin: 0, x: 0, z: 1 }]);
    expect(plan.width).toBe(24);
    expect(plan.overflow).toBe(0);
  });

  test("more pins fold into the first mark plus a +N chip", () => {
    for (const count of [2, 3, 7, 20]) {
      const plan = planRailPinCluster(count);
      expect(plan.slots.map((slot) => slot.pin)).toEqual([0, null]);
      expect(plan.overflow).toBe(count - 1);
      expect(plan.width).toBeLessThanOrEqual(RAIL_PIN_CLUSTER_MAX_WIDTH);
    }
  });

  test("the chip sits beside the mark, never over it", () => {
    const plan = planRailPinCluster(5);
    expect(plan.slots[1]?.x).toBeGreaterThanOrEqual(RAIL_PIN_CLUSTER_MARK);
    expect(plan.step).toBe(28);
    expect(plan.width).toBe(52);
  });

  test("the first pin is at the cluster's origin (the panel row's first pin)", () => {
    expect(planRailPinCluster(3).slots[0]).toMatchObject({ pin: 0, x: 0 });
  });

  test("a wider maxSlots still keeps the panel's order and ends in the chip", () => {
    const plan = planRailPinCluster(6, { maxSlots: 3, gap: 0, maxWidth: 200 });
    expect(plan.slots.map((slot) => slot.pin)).toEqual([0, 1, 2, null]);
    expect(plan.slots.map((slot) => slot.x)).toEqual([0, 24, 48, 72]);
    expect(plan.overflow).toBe(3);
  });

  test("pin keys are the shared motion keys", () => {
    expect(isPinMotionKey("pin:tab-1")).toBe(true);
    expect(isPinMotionKey("site:https://github.com/")).toBe(true);
    expect(isPinMotionKey("tab:tab-1")).toBe(false);
    expect(isPinMotionKey("new-tab")).toBe(false);
  });

  test("a narrow budget tightens the step but never goes negative", () => {
    expect(planRailPinCluster(4, { maxWidth: 42 }).step).toBe(18);
    expect(planRailPinCluster(4, { maxWidth: 10 }).step).toBe(0);
  });
});
