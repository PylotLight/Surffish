import { describe, expect, test } from "bun:test";
import {
  assignPositions,
  isFractionalKey,
  keyBetween,
  keysBetween,
} from "./fractional-index";

function sorted(keys: readonly string[]): boolean {
  return keys.every((key, index) => index === 0 || keys[index - 1]! < key);
}

describe("fractional index keys", () => {
  test("keyBetween orders correctly and never ends in 0", () => {
    const first = keyBetween(null, null);
    const later = keyBetween(first, null);
    const earlier = keyBetween(null, first);
    const middle = keyBetween(earlier, first);
    expect(sorted([earlier, middle, first, later])).toBe(true);
    for (const key of [first, later, earlier, middle])
      expect(isFractionalKey(key)).toBe(true);
    expect(() => keyBetween(later, first)).toThrow();
    expect(() => keyBetween("a0", null)).toThrow();
  });

  test("repeated appends, prepends and squeezes stay valid and short", () => {
    let last: string | null = null;
    const appended: string[] = [];
    for (let i = 0; i < 1000; i += 1)
      appended.push((last = keyBetween(last, null)));
    expect(sorted(appended)).toBe(true);
    expect(appended.at(-1)!.length).toBeLessThanOrEqual(40);

    let first: string | null = null;
    const prepended: string[] = [];
    for (let i = 0; i < 200; i += 1)
      prepended.unshift((first = keyBetween(null, first)));
    expect(sorted(prepended)).toBe(true);

    let low = "V";
    const high = "W";
    for (let i = 0; i < 200; i += 1) {
      const key = keyBetween(low, high);
      expect(low < key && key < high).toBe(true);
      low = key;
    }
  });

  test("keysBetween spreads bulk keys evenly", () => {
    const keys = keysBetween(null, null, 10_000);
    expect(keys.length).toBe(10_000);
    expect(new Set(keys).size).toBe(10_000);
    expect(sorted(keys)).toBe(true);
    expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(16);
    const inside = keysBetween("A", "B", 50);
    expect(sorted(["A", ...inside, "B"])).toBe(true);
  });
});

describe("assignPositions", () => {
  const initial = assignPositions(["a", "b", "c", "d", "e"], new Map());
  const changed = (next: Map<string, string>) =>
    [...next].filter(([id, key]) => initial.get(id) !== key).map(([id]) => id);

  test("first assignment is in order", () => {
    expect(
      sorted(["a", "b", "c", "d", "e"].map((id) => initial.get(id)!)),
    ).toBe(true);
  });

  test("moving one item rewrites only that item", () => {
    const order = ["a", "d", "b", "c", "e"];
    const next = assignPositions(order, initial);
    expect(sorted(order.map((id) => next.get(id)!))).toBe(true);
    expect(changed(next)).toEqual(["d"]);
  });

  test("inserting rewrites only the new item; removing rewrites none", () => {
    const inserted = assignPositions(["a", "b", "x", "c", "d", "e"], initial);
    expect(changed(inserted)).toEqual(["x"]);
    expect(
      sorted(["a", "b", "x", "c", "d", "e"].map((id) => inserted.get(id)!)),
    ).toBe(true);
    const removed = assignPositions(["a", "c", "e"], initial);
    expect(changed(removed)).toEqual([]);
  });

  test("reversal keeps one key and regenerates the rest in order", () => {
    const order = ["e", "d", "c", "b", "a"];
    const next = assignPositions(order, initial);
    expect(sorted(order.map((id) => next.get(id)!))).toBe(true);
    expect(changed(next).length).toBe(4);
  });

  test("over-long keys trigger one respacing of the list", () => {
    const previous = new Map([
      ["a", "V"],
      ["b", "z".repeat(256)],
    ]);
    const next = assignPositions(["a", "b", "c"], previous);
    expect(next.get("a")).not.toBe("V");
    expect([...next.values()].every((key) => key.length < 10)).toBe(true);
    expect(sorted(["a", "b", "c"].map((id) => next.get(id)!))).toBe(true);
  });

  test("invalid or duplicate previous keys are replaced", () => {
    const previous = new Map([
      ["a", "V"],
      ["b", "V"],
      ["c", "bad key"],
      ["d", "x0"],
    ]);
    const order = ["a", "b", "c", "d"];
    const next = assignPositions(order, previous);
    const keys = order.map((id) => next.get(id)!);
    expect(sorted(keys)).toBe(true);
    expect(keys.every(isFractionalKey)).toBe(true);
    expect(
      [next.get("a"), next.get("b")].filter((key) => key === "V").length,
    ).toBe(1);
  });
});
