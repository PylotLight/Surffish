import { describe, expect, test } from "bun:test";
import {
  isPinReorderModifier,
  movePin,
  pinBeforeId,
  pinDropIndex,
  pinStepBeforeId,
} from "./pinned-reorder";

describe("isPinReorderModifier", () => {
  test("Cmd on macOS, Ctrl elsewhere", () => {
    expect(isPinReorderModifier({ metaKey: true, ctrlKey: false }, true)).toBe(
      true,
    );
    expect(isPinReorderModifier({ metaKey: false, ctrlKey: true }, true)).toBe(
      false,
    );
    expect(isPinReorderModifier({ metaKey: false, ctrlKey: true }, false)).toBe(
      true,
    );
    expect(isPinReorderModifier({ metaKey: true, ctrlKey: false }, false)).toBe(
      false,
    );
  });
  test("a plain drag never reorders", () => {
    expect(isPinReorderModifier({ metaKey: false, ctrlKey: false }, true)).toBe(
      false,
    );
    expect(
      isPinReorderModifier({ metaKey: false, ctrlKey: false }, false),
    ).toBe(false);
  });
});

describe("pinDropIndex", () => {
  // Four 34px icons with a 6px gap.
  const slots = [0, 40, 80, 120].map((left) => ({ left, width: 34 }));
  test("stays put until the centre crosses a neighbour", () => {
    expect(pinDropIndex(slots, 0, 0)).toBe(0);
    expect(pinDropIndex(slots, 0, 39)).toBe(0);
    expect(pinDropIndex(slots, 0, 41)).toBe(1);
    expect(pinDropIndex(slots, 0, 200)).toBe(3);
  });
  test("moves left", () => {
    expect(pinDropIndex(slots, 3, -41)).toBe(2);
    expect(pinDropIndex(slots, 3, -500)).toBe(0);
  });
  test("unknown slot", () => {
    expect(pinDropIndex(slots, 9, 50)).toBe(9);
  });
});

describe("movePin / pinBeforeId", () => {
  const ids = ["c", "a", "b"];
  test("moves without sorting", () => {
    expect(movePin(ids, 0, 2)).toEqual(["a", "b", "c"]);
    expect(movePin(ids, 2, 0)).toEqual(["b", "c", "a"]);
    expect(movePin(ids, 1, 1)).toEqual(ids);
  });
  test("before id for the main-process move", () => {
    expect(pinBeforeId(ids, 0, 2)).toBeNull();
    expect(pinBeforeId(ids, 2, 0)).toBe("c");
    expect(pinBeforeId(ids, 0, 1)).toBe("b");
  });
  test("menu steps", () => {
    expect(pinStepBeforeId(ids, "a", -1)).toBe("c");
    expect(pinStepBeforeId(ids, "a", 1)).toBeNull();
    expect(pinStepBeforeId(ids, "c", 1)).toBe("b");
    expect(pinStepBeforeId(ids, "c", -1)).toBeUndefined();
    expect(pinStepBeforeId(ids, "b", 1)).toBeUndefined();
    expect(pinStepBeforeId(ids, "x", 1)).toBeUndefined();
  });
});
