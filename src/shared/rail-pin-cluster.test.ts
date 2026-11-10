import { describe, expect, test } from "bun:test";
import {
  RAIL_PIN_CLUSTER_MAX_WIDTH,
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

  test("a few pins spread no wider than the max step", () => {
    const plan = planRailPinCluster(2);
    expect(plan.step).toBe(12);
    expect(plan.width).toBe(36);
    expect(plan.slots.map((slot) => slot.x)).toEqual([0, 12]);
  });

  test("four pins fill the row without a chip and fit the rail", () => {
    const plan = planRailPinCluster(4);
    expect(plan.overflow).toBe(0);
    expect(plan.slots.map((slot) => slot.pin)).toEqual([0, 1, 2, 3]);
    expect(plan.width).toBeLessThanOrEqual(RAIL_PIN_CLUSTER_MAX_WIDTH);
  });

  test("more than four pins end in a +N chip drawn on top", () => {
    const plan = planRailPinCluster(7);
    expect(plan.slots).toHaveLength(4);
    expect(plan.slots.map((slot) => slot.pin)).toEqual([0, 1, 2, null]);
    expect(plan.overflow).toBe(4);
    const zs = plan.slots.map((slot) => slot.z);
    expect(zs[3]).toBeGreaterThan(Math.max(...zs.slice(0, 3)));
    expect(plan.width).toBeLessThanOrEqual(RAIL_PIN_CLUSTER_MAX_WIDTH);
  });

  test("the first pin is in front when nothing pinned is active", () => {
    const [front, ...rest] = planRailPinCluster(3).slots;
    expect(front?.pin).toBe(0);
    for (const slot of rest) expect(slot.z).toBeLessThan(front?.z ?? 0);
  });

  test("the active pin comes to the front, even from the overflow", () => {
    const plan = planRailPinCluster(6, { activeIndex: 5 });
    expect(plan.slots.map((slot) => slot.pin)).toEqual([5, 0, 1, null]);
    expect(plan.overflow).toBe(3);
    expect(plan.slots[0]?.z).toBe(4);
  });

  test("an out-of-range active index falls back to the first pin", () => {
    expect(planRailPinCluster(3, { activeIndex: 9 }).slots[0]?.pin).toBe(0);
    expect(planRailPinCluster(3, { activeIndex: -1 }).slots[0]?.pin).toBe(0);
  });

  test("a narrow budget tightens the step but never goes negative", () => {
    expect(planRailPinCluster(4, { maxWidth: 42 }).step).toBe(6);
    expect(planRailPinCluster(4, { maxWidth: 10 }).step).toBe(0);
  });
});
