import assert from "node:assert/strict";
import test from "node:test";
import { OmniboxDrafts, type OmniboxDraft } from "./omnibox-drafts.ts";

const PAGE = "https://example.com/docs";

const draft = (text: string, base = ""): OmniboxDraft => ({
  text,
  base,
  selectionStart: text.length,
  selectionEnd: text.length,
});

test("each tab keeps its own draft", () => {
  const drafts = new OmniboxDrafts();
  drafts.save("a", draft("copied query"));
  drafts.save("b", draft("other", PAGE));
  assert.equal(drafts.draftFor("a", "")?.text, "copied query");
  assert.equal(drafts.draftFor("b", PAGE)?.text, "other");
  assert.equal(drafts.draftFor("c", ""), null);
});

test("a draft only applies over the URL it was typed on", () => {
  const drafts = new OmniboxDrafts();
  drafts.save("a", draft("half", PAGE));
  // A tab switch can land before the new tab's URL does: no restore against the old URL, and the
  // draft is kept for when the right URL arrives.
  assert.equal(drafts.draftFor("a", ""), null);
  assert.equal(drafts.draftFor("a", PAGE)?.text, "half");
});

test("text edited back to the tab's own value is no draft", () => {
  const drafts = new OmniboxDrafts();
  drafts.save("a", draft("x", PAGE));
  drafts.save("a", draft(PAGE, PAGE));
  assert.equal(drafts.draftFor("a", PAGE), null);
  assert.equal(drafts.size, 0);
  drafts.save("", draft("ignored"));
  assert.equal(drafts.size, 0);
});

test("clear drops the draft (submitted, or Esc)", () => {
  const drafts = new OmniboxDrafts();
  drafts.save("a", draft("query"));
  drafts.clear("a");
  assert.equal(drafts.draftFor("a", ""), null);
});

test("saveSelection updates the caret of the same text only", () => {
  const drafts = new OmniboxDrafts();
  drafts.save("a", draft("hello world"));
  drafts.saveSelection("a", "hello world", 0, 5);
  assert.deepEqual(
    [
      drafts.draftFor("a", "")?.selectionStart,
      drafts.draftFor("a", "")?.selectionEnd,
    ],
    [0, 5],
  );
  drafts.saveSelection("a", "different", 1, 1);
  assert.equal(drafts.draftFor("a", "")?.selectionStart, 0);
  drafts.saveSelection("missing", "x", 0, 0);
  assert.equal(drafts.size, 1);
});

test("prune drops drafts of closed tabs and tabs that navigated", () => {
  const drafts = new OmniboxDrafts();
  drafts.save("kept", draft("one"));
  drafts.save("closed", draft("two"));
  drafts.save("navigated", draft("three", PAGE));
  drafts.prune([
    { id: "kept", display: "" },
    { id: "navigated", display: "https://example.com/elsewhere" },
  ]);
  assert.equal(drafts.draftFor("kept", "")?.text, "one");
  assert.equal(drafts.draftFor("closed", ""), null);
  assert.equal(drafts.draftFor("navigated", PAGE), null);
  assert.equal(drafts.size, 1);
});

test("saved drafts are copies", () => {
  const drafts = new OmniboxDrafts();
  const value = draft("query");
  drafts.save("a", value);
  value.text = "mutated";
  assert.equal(drafts.draftFor("a", "")?.text, "query");
});
