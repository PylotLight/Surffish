import { describe, expect, test } from "bun:test";
import { backgroundTabInsertIndex } from "./tab-insertion";

const tabs = (...ids: string[]) => ids.map((id) => ({ id }));

describe("backgroundTabInsertIndex", () => {
  test("a background tab lands right after the active tab", () => {
    expect(backgroundTabInsertIndex(tabs("a", "b", "c", "d"), "b")).toBe(2);
    expect(backgroundTabInsertIndex(tabs("a", "b", "c"), "a")).toBe(1);
  });

  test("the active tab last: one past the end (createTab appends — same slot)", () => {
    expect(backgroundTabInsertIndex(tabs("a", "b", "c"), "c")).toBe(3);
  });

  test("no active tab: append", () => {
    expect(backgroundTabInsertIndex(tabs("a", "b"), null)).toBeUndefined();
  });

  test("an active id that is not in this window: append", () => {
    expect(backgroundTabInsertIndex(tabs("a", "b"), "missing")).toBeUndefined();
  });

  test("an empty window: append", () => {
    expect(backgroundTabInsertIndex([], "a")).toBeUndefined();
  });
});
