import { describe, expect, test } from "bun:test";
import {
  canOfferWatchPage,
  isCommandHiddenByWatchers,
  isWatchersDisabledResult,
  parsePageWatchersFeature,
  sidebarModeForWatchers,
  visibleWatcherSections,
  watchersDisabledResult,
  watchersTransition,
  WATCHERS_DISABLED_ERROR,
} from "./page-watchers-feature";

describe("page watchers feature setting", () => {
  test("defaults on, so existing profiles keep their watchers running", () => {
    expect(parsePageWatchersFeature(null)).toEqual({ enabled: true });
    expect(parsePageWatchersFeature(undefined)).toEqual({ enabled: true });
    expect(parsePageWatchersFeature("nope")).toEqual({ enabled: true });
    expect(parsePageWatchersFeature({})).toEqual({ enabled: true });
    expect(parsePageWatchersFeature({ enabled: "false" })).toEqual({
      enabled: true,
    });
  });

  test("only an explicit false turns watchers off", () => {
    expect(parsePageWatchersFeature({ enabled: false })).toEqual({
      enabled: false,
    });
    expect(parsePageWatchersFeature(false)).toEqual({ enabled: false });
    expect(parsePageWatchersFeature({ enabled: true })).toEqual({
      enabled: true,
    });
    expect(parsePageWatchersFeature(true)).toEqual({ enabled: true });
  });

  test("disabled IPC result is a plain value, recognisable on both sides", () => {
    const result = watchersDisabledResult();
    expect(result).toEqual({ ok: false, error: "watchers disabled" });
    expect(result.error).toBe(WATCHERS_DISABLED_ERROR);
    expect(isWatchersDisabledResult(result)).toBe(true);
    expect(
      isWatchersDisabledResult({
        ok: false,
        error: "That watcher no longer exists.",
      }),
    ).toBe(false);
    expect(isWatchersDisabledResult({ watchers: [], running: [] })).toBe(false);
    expect(isWatchersDisabledResult(null)).toBe(false);
  });

  test("toggling starts or stops the module only on a real change", () => {
    expect(watchersTransition(true, false)).toBe("stop");
    expect(watchersTransition(false, true)).toBe("start");
    expect(watchersTransition(true, true)).toBe("none");
    expect(watchersTransition(false, false)).toBe("none");
  });

  test("entry points hide while off", () => {
    expect(isCommandHiddenByWatchers("settings.watchers", false)).toBe(true);
    expect(isCommandHiddenByWatchers("settings.watchers", true)).toBe(false);
    expect(isCommandHiddenByWatchers("settings.general", false)).toBe(false);

    const sections = [
      { mode: "settings" },
      { mode: "privacy" },
      { mode: "watchers" },
      { mode: "site" },
    ];
    expect(
      visibleWatcherSections(sections, true).map((section) => section.mode),
    ).toEqual(["settings", "privacy", "watchers", "site"]);
    expect(
      visibleWatcherSections(sections, false).map((section) => section.mode),
    ).toEqual(["settings", "privacy", "site"]);

    expect(
      canOfferWatchPage({
        watchersEnabled: true,
        isPrivate: false,
        watchableUrl: true,
      }),
    ).toBe(true);
    expect(
      canOfferWatchPage({
        watchersEnabled: false,
        isPrivate: false,
        watchableUrl: true,
      }),
    ).toBe(false);
    expect(
      canOfferWatchPage({
        watchersEnabled: true,
        isPrivate: true,
        watchableUrl: true,
      }),
    ).toBe(false);
    expect(
      canOfferWatchPage({
        watchersEnabled: true,
        isPrivate: false,
        watchableUrl: false,
      }),
    ).toBe(false);
  });

  test("an open Watchers section falls back to General when turned off", () => {
    expect(sidebarModeForWatchers("watchers", false)).toBe("settings");
    expect(sidebarModeForWatchers("watchers", true)).toBe("watchers");
    expect(sidebarModeForWatchers("tabs", false)).toBe("tabs");
  });
});
