import { describe, expect, test } from "bun:test";
import {
  isNavHistoryDisposition,
  isNavHistoryTarget,
  navHistoryDisposition,
  navHistoryMenu,
  navHistoryTitle,
} from "./nav-history-menu";

const pages = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    url: `https://example.com/${index}`,
    title: `Page ${index}`,
  }));

describe("navHistoryMenu", () => {
  test("back lists older entries newest first", () => {
    const menu = navHistoryMenu(pages(4), 3, "back");
    expect(menu.total).toBe(3);
    expect(menu.entries.map((entry) => entry.index)).toEqual([2, 1, 0]);
    expect(menu.entries.map((entry) => entry.offset)).toEqual([-1, -2, -3]);
    expect(menu.entries[0]).toEqual({
      index: 2,
      offset: -1,
      url: "https://example.com/2",
      title: "Page 2",
    });
  });
  test("forward lists newer entries nearest first", () => {
    const menu = navHistoryMenu(pages(4), 0, "forward");
    expect(menu.entries.map((entry) => entry.index)).toEqual([1, 2, 3]);
    expect(menu.entries.map((entry) => entry.offset)).toEqual([1, 2, 3]);
  });
  test("nothing in a direction with no entries", () => {
    expect(navHistoryMenu(pages(3), 0, "back")).toEqual({
      direction: "back",
      entries: [],
      total: 0,
    });
    expect(navHistoryMenu(pages(3), 2, "forward").entries).toEqual([]);
  });
  test("caps the rows but reports the total", () => {
    const menu = navHistoryMenu(pages(40), 39, "back");
    expect(menu.entries).toHaveLength(15);
    expect(menu.total).toBe(39);
    expect(menu.entries.at(-1)?.index).toBe(24);
    expect(navHistoryMenu(pages(40), 39, "back", 5).entries).toHaveLength(5);
  });
  test("a bad active index gives an empty menu", () => {
    expect(navHistoryMenu(pages(3), -1, "back").entries).toEqual([]);
    expect(navHistoryMenu(pages(3), 3, "back").entries).toEqual([]);
    expect(navHistoryMenu(pages(3), 1.5, "back").entries).toEqual([]);
    expect(navHistoryMenu([], 0, "forward").entries).toEqual([]);
  });
});

describe("navHistoryTitle", () => {
  test("uses the title, falling back to the URL", () => {
    expect(
      navHistoryTitle({ url: "https://a.test/x", title: "  Hello " }),
    ).toBe("Hello");
    expect(navHistoryTitle({ url: "https://a.test/x", title: "" })).toBe(
      "a.test/x",
    );
    expect(
      navHistoryTitle({ url: "https://a.test/", title: "https://a.test/" }),
    ).toBe("a.test");
    expect(navHistoryTitle({ url: "file:///tmp/a.html", title: "" })).toBe(
      "file:///tmp/a.html",
    );
  });
});

describe("isNavHistoryTarget", () => {
  test("only real, non-current indexes", () => {
    expect(isNavHistoryTarget(0, 3, 2)).toBe(true);
    expect(isNavHistoryTarget(2, 3, 2)).toBe(false);
    expect(isNavHistoryTarget(3, 3, 2)).toBe(false);
    expect(isNavHistoryTarget(-1, 3, 2)).toBe(false);
    expect(isNavHistoryTarget("0", 3, 2)).toBe(false);
    expect(isNavHistoryTarget(0.5, 3, 2)).toBe(false);
  });
});

describe("navHistoryDisposition", () => {
  const click = (
    overrides: Partial<{
      button: number;
      metaKey: boolean;
      ctrlKey: boolean;
      shiftKey: boolean;
    }>,
  ) => ({
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...overrides,
  });
  test("plain click navigates the tab", () => {
    expect(navHistoryDisposition(click({}), true)).toBe("current");
    expect(navHistoryDisposition(click({ shiftKey: true }), true)).toBe(
      "current",
    );
  });
  test("Cmd on Mac, Ctrl elsewhere, or middle-click opens a background tab", () => {
    expect(navHistoryDisposition(click({ metaKey: true }), true)).toBe(
      "background-tab",
    );
    expect(navHistoryDisposition(click({ ctrlKey: true }), true)).toBe(
      "current",
    );
    expect(navHistoryDisposition(click({ ctrlKey: true }), false)).toBe(
      "background-tab",
    );
    expect(navHistoryDisposition(click({ button: 1 }), false)).toBe(
      "background-tab",
    );
  });
  test("Shift brings the new tab to the front", () => {
    expect(
      navHistoryDisposition(click({ metaKey: true, shiftKey: true }), true),
    ).toBe("foreground-tab");
    expect(
      navHistoryDisposition(click({ button: 1, shiftKey: true }), true),
    ).toBe("foreground-tab");
  });
  test("validates dispositions from IPC", () => {
    expect(isNavHistoryDisposition("current")).toBe(true);
    expect(isNavHistoryDisposition("new-window")).toBe(false);
  });
});
