import { describe, expect, test } from "bun:test";
import { groupCollapseSnapshot, newlyExpandedGroups } from "./tab-group-reveal";

const tab = (id: string, collapsed: boolean) => ({ group: { id, collapsed } });

describe("tab group reveal", () => {
  test("snapshot takes one entry per group", () => {
    expect([
      ...groupCollapseSnapshot([
        tab("a", true),
        tab("a", true),
        {},
        tab("b", false),
      ]),
    ]).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  test("only collapsed -> expanded counts", () => {
    const before = groupCollapseSnapshot([
      tab("a", true),
      tab("b", false),
      tab("c", true),
    ]);
    const after = groupCollapseSnapshot([
      tab("a", false),
      tab("b", false),
      tab("c", true),
      tab("d", false),
    ]);
    expect(newlyExpandedGroups(before, after)).toEqual(["a"]);
    expect(newlyExpandedGroups(after, before)).toEqual([]);
    expect(newlyExpandedGroups(new Map(), after)).toEqual([]);
  });
});
