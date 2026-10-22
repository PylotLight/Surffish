import { describe, expect, test } from "bun:test";
import {
  arrowSuggestion,
  escapeOmnibox,
  highlightMatches,
  nextSuggestionIndex,
  omniboxQuery,
  suggestionUrlParts,
} from "./omnibox-fill";

const rows = [
  { url: "https://www.youtube.com/@veritasium" },
  { url: "https://www.youtube.com/@3blue1brown" },
  { url: "https://youtu.be/x" },
];

describe("nextSuggestionIndex", () => {
  test("down walks the rows then returns to the typed text", () => {
    expect(nextSuggestionIndex(-1, 3, "down")).toBe(0);
    expect(nextSuggestionIndex(1, 3, "down")).toBe(2);
    expect(nextSuggestionIndex(2, 3, "down")).toBe(-1);
  });
  test("up from the typed text goes to the last row, from the first back to typed", () => {
    expect(nextSuggestionIndex(-1, 3, "up")).toBe(2);
    expect(nextSuggestionIndex(0, 3, "up")).toBe(-1);
  });
  test("no rows, or a stale index past the list", () => {
    expect(nextSuggestionIndex(0, 0, "down")).toBe(-1);
    expect(nextSuggestionIndex(9, 3, "down")).toBe(0);
  });
});

describe("arrowSuggestion", () => {
  test("fills the full URL and remembers what was typed", () => {
    const first = arrowSuggestion("youtube.com/@", null, rows, "down");
    expect(first).toEqual({
      preview: { typed: "youtube.com/@", index: 0 },
      text: "https://www.youtube.com/@veritasium",
    });
    const second = arrowSuggestion(first.text, first.preview, rows, "down");
    expect(second).toEqual({
      preview: { typed: "youtube.com/@", index: 1 },
      text: "https://www.youtube.com/@3blue1brown",
    });
  });
  test("arrowing back past the first row restores the typed text", () => {
    const first = arrowSuggestion("you", null, rows, "down");
    expect(arrowSuggestion(first.text, first.preview, rows, "up")).toEqual({
      preview: null,
      text: "you",
    });
  });
  test("up from typed fills the last row", () => {
    expect(arrowSuggestion("you", null, rows, "up").text).toBe(
      "https://youtu.be/x",
    );
  });
  test("nothing to arrow to", () => {
    expect(arrowSuggestion("zzz", null, [], "down")).toEqual({
      preview: null,
      text: "zzz",
    });
  });
});

describe("omniboxQuery / escapeOmnibox", () => {
  test("the dropdown keeps matching the typed text while a row is filled in", () => {
    expect(
      omniboxQuery("https://www.youtube.com/@veritasium", {
        typed: "yout",
        index: 0,
      }),
    ).toBe("yout");
    expect(omniboxQuery("edited", null)).toBe("edited");
  });
  test("first Esc restores typed text, then reverts", () => {
    expect(escapeOmnibox({ typed: "yout", index: 1 })).toEqual({
      kind: "restore",
      text: "yout",
    });
    expect(escapeOmnibox(null)).toEqual({ kind: "revert" });
  });
});

describe("highlightMatches", () => {
  test("case-insensitive, every occurrence", () => {
    expect(highlightMatches("YouTube you", "you")).toEqual([
      { text: "You", match: true },
      { text: "Tube ", match: false },
      { text: "you", match: true },
    ]);
  });
  test("empty query or no match", () => {
    expect(highlightMatches("abc", " ")).toEqual([
      { text: "abc", match: false },
    ]);
    expect(highlightMatches("abc", "z")).toEqual([
      { text: "abc", match: false },
    ]);
    expect(highlightMatches("", "a")).toEqual([]);
  });
});

describe("suggestionUrlParts", () => {
  test("dims scheme and www, keeps host and path apart", () => {
    expect(
      suggestionUrlParts("https://www.youtube.com/@veritasium", ""),
    ).toEqual([
      { text: "https://", role: "scheme", match: false },
      { text: "www.", role: "www", match: false },
      { text: "youtube.com", role: "host", match: false },
      { text: "/@veritasium", role: "path", match: false },
    ]);
  });
  test("a match that spans host and path is split at the boundary", () => {
    expect(suggestionUrlParts("https://youtube.com/@x", "com/@")).toEqual([
      { text: "https://", role: "scheme", match: false },
      { text: "youtube.", role: "host", match: false },
      { text: "com", role: "host", match: true },
      { text: "/@", role: "path", match: true },
      { text: "x", role: "path", match: false },
    ]);
  });
  test("host only, with a query or hash and no path", () => {
    expect(
      suggestionUrlParts("http://192.168.1.10?x=1", "").map(
        (part) => part.role,
      ),
    ).toEqual(["scheme", "host", "path"]);
    expect(
      suggestionUrlParts("https://a.dev", "").map((part) => part.role),
    ).toEqual(["scheme", "host"]);
  });
  test("non-hierarchical URLs are plain text", () => {
    expect(suggestionUrlParts("about:blank", "")).toEqual([
      { text: "about:blank", role: "path", match: false },
    ]);
  });
  test("parts always join back to the URL", () => {
    const url = "https://www.example.co.uk/a/b?c=d#e";
    expect(
      suggestionUrlParts(url, "e")
        .map((part) => part.text)
        .join(""),
    ).toBe(url);
  });
});
