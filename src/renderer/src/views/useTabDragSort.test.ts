import { describe, expect, test } from "bun:test";
import {
  dragTargetIndex,
  isOutsideSurface,
  reorderIds,
} from "./useTabDragSort";

const slots = [0, 44, 88, 132].map((top) => ({ top, height: 40 }));

describe("tab drag sort helpers", () => {
  test("stays put for small moves", () => {
    expect(dragTargetIndex(slots, 1, 10)).toBe(1);
    expect(dragTargetIndex(slots, 1, -10)).toBe(1);
  });
  test("passes a neighbour once its midpoint is crossed", () => {
    expect(dragTargetIndex(slots, 0, 30)).toBe(0);
    expect(dragTargetIndex(slots, 0, 44)).toBe(0);
    expect(dragTargetIndex(slots, 0, 44.01)).toBe(1);
    expect(dragTargetIndex(slots, 0, 50)).toBe(1);
    expect(dragTargetIndex(slots, 0, 200)).toBe(3);
    expect(dragTargetIndex(slots, 3, -200)).toBe(0);
  });
  test("reorders ids", () => {
    expect(reorderIds(["a", "b", "c", "d"], 0, 2)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
    expect(reorderIds(["a", "b", "c", "d"], 3, 0)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
  });
});

test("a drag leaves the surface only past its edges", () => {
  expect(isOutsideSurface(10, 10, 300, 800)).toBe(false);
  expect(isOutsideSurface(0, 0, 300, 800)).toBe(false);
  expect(isOutsideSurface(300, 10, 300, 800)).toBe(true);
  expect(isOutsideSurface(-1, 10, 300, 800)).toBe(true);
  expect(isOutsideSurface(10, 800, 300, 800)).toBe(true);
  expect(isOutsideSurface(10, -20, 300, 800)).toBe(true);
});
