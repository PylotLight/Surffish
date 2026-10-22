import { describe, expect, test } from "bun:test";
import {
  foldText,
  locateFolded,
  pageScriptSource,
  sentenceIndexForProbe,
} from "./read-aloud-page";

describe("read aloud page matching", () => {
  test("folds to letters and digits, lower-cased", () => {
    expect(foldText("It cost $4.50 — “fine”, said Dr. Smith.")).toBe(
      "itcost450finesaiddrsmith",
    );
  });

  test("finds a sentence despite whitespace, quotes and entities differing", () => {
    const page = foldText(
      "Intro.\n  It\u00a0cost   $4.50, which was “fine”.  Next one.",
    );
    const found = locateFolded(page, 'It cost $4.50, which was "fine".');
    expect(found).not.toBeNull();
    expect(page.slice(found![0], found![1])).toBe("itcost450whichwasfine");
  });

  test("falls back to the first 32 letters when the end differs (footnote markers)", () => {
    const sentence =
      "The committee published its final report on the matter in the spring.";
    const page = foldText(
      "The committee published its final report on the matter[1] in the spring.",
    );
    const found = locateFolded(page, sentence);
    expect(found?.[0]).toBe(0);
  });

  test("searches from an offset, and gives up on nothing to match", () => {
    const page = foldText("Hello there. Hello there.");
    expect(locateFolded(page, "Hello there", 1)?.[0]).toBe(10);
    expect(locateFolded(page, "…")).toBeNull();
    expect(locateFolded(page, "absent words here")).toBeNull();
  });

  test("probe → the sentence it starts in, or null", () => {
    const sentences = [
      "A title",
      "First sentence here.",
      "Second sentence is longer than the first one.",
      "Third.",
    ];
    expect(
      sentenceIndexForProbe(
        sentences,
        "Second sentence is longer than the first one. Third.",
      ),
    ).toBe(2);
    expect(
      sentenceIndexForProbe(sentences, "sentence here. Second sentence"),
    ).toBe(1);
    expect(
      sentenceIndexForProbe(sentences, "Something else entirely"),
    ).toBeNull();
    expect(sentenceIndexForProbe(sentences, "..")).toBeNull();
  });

  test("the page script is valid JavaScript and installs once", () => {
    const source = pageScriptSource();
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain("__surffishReadAloud");
  });
});
