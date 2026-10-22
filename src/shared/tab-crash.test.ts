import { describe, expect, test } from "bun:test";
import {
  canAutoReload,
  crashReasonLabel,
  CRASH_LOOP_WINDOW_MS,
  emptyCrashRecord,
  MAX_AUTO_RELOADS,
  recordAutoReload,
  recordCrash,
} from "./tab-crash.ts";

describe("crash-on-load loop cap", () => {
  test("allows a couple of auto-reloads, then stops", () => {
    let record = emptyCrashRecord();
    let now = 1_000_000;
    for (let attempt = 0; attempt < MAX_AUTO_RELOADS; attempt += 1) {
      record = recordCrash(record, now);
      expect(canAutoReload(record, now)).toBe(true);
      record = recordAutoReload(record, now);
      now += 2_000;
    }
    record = recordCrash(record, now);
    expect(canAutoReload(record, now)).toBe(false);
  });
  test("the window expires, so a tab that crashes rarely keeps recovering", () => {
    let record = emptyCrashRecord();
    record = recordAutoReload(recordAutoReload(record, 0), 1);
    expect(canAutoReload(record, 2)).toBe(false);
    expect(canAutoReload(record, CRASH_LOOP_WINDOW_MS + 5)).toBe(true);
    expect(recordCrash(record, CRASH_LOOP_WINDOW_MS + 5).autoReloads).toEqual(
      [],
    );
  });
  test("reason labels", () => {
    expect(crashReasonLabel("oom")).toBe("it ran out of memory");
    expect(crashReasonLabel("weird")).toBe("the page process stopped");
  });
});
