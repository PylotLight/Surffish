import { describe, expect, test } from "bun:test";
import { describeTabSleep, isRestoredSleep } from "./tab-sleep";

describe("tab sleep reason", () => {
  test("the moon says why the tab sleeps", () => {
    expect(describeTabSleep({ reason: "idle", minutes: 60 })).toBe(
      "Slept after 1 h in the background",
    );
    expect(describeTabSleep({ reason: "idle", minutes: 15 })).toBe(
      "Slept after 15 min in the background",
    );
    expect(describeTabSleep({ reason: "memory" })).toBe(
      "Put to sleep early by memory saver (memory was low)",
    );
    expect(describeTabSleep({ reason: "manual" })).toBe("Hibernated by you");
    expect(describeTabSleep({ reason: "crashed" })).toBe(
      "Page process ended in the background",
    );
    expect(describeTabSleep(undefined)).toBe(
      "Not loaded since Surffish started",
    );
  });

  test("restored (never loaded this run) shows fainter", () => {
    expect(isRestoredSleep(undefined)).toBe(true);
    expect(isRestoredSleep({ reason: "restored" })).toBe(true);
    expect(isRestoredSleep({ reason: "memory" })).toBe(false);
  });
});
