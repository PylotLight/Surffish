import { describe, expect, test } from "bun:test";
import {
  discardFloorMs,
  discardOrder,
  lowAvailableThresholdMB,
  MIN_BACKGROUND_MS,
  memoryPressure,
  NEVER_TIMER_FLOOR_MS,
  parseMemorySaverSettings,
  SOFT_FLOOR_MS,
  type DiscardCandidate,
} from "./memory-saver";

const now = 10_000_000;
const tab = (
  id: string,
  extra: Partial<DiscardCandidate> = {},
): DiscardCandidate => ({
  id,
  live: true,
  onScreen: false,
  audible: false,
  pinned: false,
  protected: false,
  inactiveSince: now - MIN_BACKGROUND_MS - 1,
  ...extra,
});

describe("memory saver", () => {
  test("on by default; a saved choice is kept", () => {
    expect(parseMemorySaverSettings(undefined)).toEqual({ enabled: true });
    expect(parseMemorySaverSettings({ enabled: false })).toEqual({
      enabled: false,
    });
    expect(parseMemorySaverSettings({ enabled: "no" })).toEqual({
      enabled: true,
    });
  });

  test("pressure: low available memory, macOS pressure level, or Surffish over half of RAM", () => {
    const base = {
      totalMB: 16_384,
      availableMB: 8_000,
      macPressureLevel: null,
      surffishMB: 1_000,
    };
    expect(memoryPressure(base)).toBeNull();
    expect(memoryPressure({ ...base, availableMB: 1_500 })).toBe("system");
    expect(lowAvailableThresholdMB(16_384)).toBe(1638.4);
    expect(lowAvailableThresholdMB(4_096)).toBe(512);
    expect(lowAvailableThresholdMB(65_536)).toBe(2048);
    expect(memoryPressure({ ...base, availableMB: 500 })).toBe("critical");
    expect(memoryPressure({ ...base, surffishMB: 9_000 })).toBe("surffish");
  });

  test("macOS: warning level alone is not pressure while the kernel still counts plenty as available", () => {
    const mac = {
      totalMB: 16_384,
      availableMB: null,
      macAvailablePercent: 40,
      surffishMB: 1_000,
    };
    expect(memoryPressure({ ...mac, macPressureLevel: 1 })).toBeNull();
    // A busy Mac sits at level 2 for hours with ~40 % reclaimable (cache, compressor): not tight.
    expect(memoryPressure({ ...mac, macPressureLevel: 2 })).toBeNull();
    expect(
      memoryPressure({ ...mac, macPressureLevel: 2, macAvailablePercent: 8 }),
    ).toBe("system");
    // Percentage unknown (older macOS): warning still counts, with the soft floor.
    expect(
      memoryPressure({
        ...mac,
        macPressureLevel: 2,
        macAvailablePercent: null,
      }),
    ).toBe("system");
    expect(memoryPressure({ ...mac, macPressureLevel: 4 })).toBe("critical");
    // Summed working sets double count shared pages on macOS: the share only counts under kernel pressure.
    expect(
      memoryPressure({ ...mac, macPressureLevel: 1, surffishMB: 9_000 }),
    ).toBeNull();
    expect(
      memoryPressure({ ...mac, macPressureLevel: 2, surffishMB: 9_000 }),
    ).toBe("surffish");
  });

  test("floor: never sooner than the user's sleep timer (and 15 min) short of critical pressure", () => {
    expect(discardFloorMs("critical", 60)).toBe(MIN_BACKGROUND_MS);
    expect(discardFloorMs("system", 60)).toBe(60 * 60_000);
    expect(discardFloorMs("surffish", 60)).toBe(60 * 60_000);
    expect(discardFloorMs("system", 5)).toBe(SOFT_FLOOR_MS);
    expect(discardFloorMs("system", 30)).toBe(30 * 60_000);
    expect(discardFloorMs("system", 0)).toBe(NEVER_TIMER_FLOOR_MS);
  });

  test("bug: timer set to 1 h, busy Mac at warning level, tabs 6-50 min in the background stay awake", () => {
    // Before: level 2 alone was "system" pressure and anything off screen 5 min went, two per 30 s check,
    // so a Mac that sat at warning for an hour drained every background tab long before the 1 h timer.
    const sample = {
      totalMB: 16_384,
      availableMB: null,
      macPressureLevel: 2,
      macAvailablePercent: 35,
      surffishMB: 3_000,
    };
    const tabs = [6, 20, 50].map((minutes) =>
      tab(`bg${minutes}`, { inactiveSince: now - minutes * 60_000 }),
    );
    const reason = memoryPressure(sample);
    expect(reason).toBeNull();
    // Even when the kernel does report it tight, short of critical the 1 h timer still wins.
    const tight = memoryPressure({ ...sample, macAvailablePercent: 5 });
    expect(tight).toBe("system");
    expect(discardOrder(tabs, now, discardFloorMs(tight!, 60))).toEqual([]);
    expect(
      discardOrder(
        [...tabs, tab("bg61", { inactiveSince: now - 61 * 60_000 })],
        now,
        discardFloorMs(tight!, 60),
      ).map((t) => t.id),
    ).toEqual(["bg61"]);
    // Critical: the 5 minute floor.
    expect(
      discardOrder(tabs, now, discardFloorMs("critical", 60)).map((t) => t.id),
    ).toEqual(["bg50", "bg20", "bg6"]);
  });

  test("discard order: least recently used live background tabs only", () => {
    const order = discardOrder(
      [
        tab("newer", { inactiveSince: now - MIN_BACKGROUND_MS - 10 }),
        tab("oldest", { inactiveSince: now - 3 * MIN_BACKGROUND_MS }),
        tab("active", { onScreen: true, inactiveSince: null }),
        tab("playing", { audible: true }),
        tab("pinned", { pinned: true }),
        tab("editor", { protected: true }),
        tab("asleep", { live: false }),
        tab("recent", { inactiveSince: now - 60_000 }),
      ],
      now,
    );
    expect(order.map((t) => t.id)).toEqual(["oldest", "newer"]);
  });
});
