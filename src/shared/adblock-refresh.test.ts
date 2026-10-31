import { describe, expect, test } from "bun:test";
import { firstRefreshDelayMs } from "./adblock-refresh";

const HOUR = 60 * 60 * 1000;

describe("firstRefreshDelayMs", () => {
  test("no cache: the first run already refreshes, so no early tick", () => {
    expect(firstRefreshDelayMs(null, 8 * HOUR)).toBeNull();
  });

  test("fresh cache: the first tick lands exactly at the 8h expiry", () => {
    expect(firstRefreshDelayMs(2 * HOUR, 8 * HOUR)).toBe(6 * HOUR);
  });

  test("cache about to expire: the tick is nearly immediate", () => {
    expect(firstRefreshDelayMs(8 * HOUR - 1, 8 * HOUR)).toBe(1);
  });

  test("stale cache: initialize() already refreshes, so no early tick", () => {
    expect(firstRefreshDelayMs(8 * HOUR, 8 * HOUR)).toBeNull();
    expect(firstRefreshDelayMs(9 * HOUR, 8 * HOUR)).toBeNull();
  });
});
