import { describe, expect, test } from "bun:test";
import {
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

  test("the cluster keeps the panel's order: slot i draws pin i, never reordered", () => {
    for (const count of [1, 2, 3, 4, 5, 9]) {
      const plan = planRailPinCluster(count);
      const pins = plan.slots.flatMap((slot) =>
        slot.pin === null ? [] : [slot.pin],
      );
      expect(pins).toEqual(pins.map((_, index) => index));
    }
  });

  test("the first pin is in front, at the cluster's origin (the panel row's first pin)", () => {
    const [front, ...rest] = planRailPinCluster(3).slots;
    expect(front).toEqual({ pin: 0, x: 0, z: 3 });
    for (const slot of rest) expect(slot.z).toBeLessThan(front?.z ?? 0);
  });

  test("the +N chip stays last and on top, standing for every pin it hides", () => {
    const plan = planRailPinCluster(6);
    expect(plan.slots.at(-1)?.pin).toBeNull();
    expect(plan.overflow).toBe(3);
    const slots = plan.slots.map((slot) => slot.x);
    expect([...slots].sort((a, b) => a - b)).toEqual(slots);
  });

  test("slots step evenly to the right, so a glide to the row is a pure spread", () => {
    const plan = planRailPinCluster(4);
    expect(plan.slots.map((slot) => slot.x)).toEqual([
      0,
      plan.step,
      plan.step * 2,
      plan.step * 3,
    ]);
  });

  test("pin keys are the shared motion keys", () => {
    expect(isPinMotionKey("pin:tab-1")).toBe(true);
    expect(isPinMotionKey("site:https://github.com/")).toBe(true);
    expect(isPinMotionKey("tab:tab-1")).toBe(false);
    expect(isPinMotionKey("new-tab")).toBe(false);
  });

  test("a narrow budget tightens the step but never goes negative", () => {
    expect(planRailPinCluster(4, { maxWidth: 42 }).step).toBe(6);
    expect(planRailPinCluster(4, { maxWidth: 10 }).step).toBe(0);
  });
});
