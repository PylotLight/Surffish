"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  dedupeCssRules,
  insertStyles,
  splitCssRules,
  splitSelectorList,
} = require("./adblock-frame.cjs");

test("splitCssRules parses grouped cosmetic rules into flat normalized blocks", () => {
  const css =
    ".foo,\n.bar { display: none !important; }\n#id1 { visibility: hidden !important; }";
  assert.deepEqual(splitCssRules(css), [
    { selector: ".foo, .bar", declarations: "display: none !important;" },
    { selector: "#id1", declarations: "visibility: hidden !important;" },
  ]);
});

test("splitCssRules keeps nested blocks whole and rejects unbalanced or braceless text", () => {
  assert.deepEqual(
    splitCssRules(
      "@media (min-width: 600px) { .ad { display: none !important; } }",
    ),
    [
      {
        selector: "@media (min-width: 600px)",
        declarations: ".ad { display: none !important; }",
      },
    ],
  );
  assert.equal(splitCssRules(".foo { display: none;"), null);
  assert.equal(splitCssRules(".foo display: none;"), null);
  assert.equal(splitCssRules(""), null);
});

test("splitSelectorList splits only on top-level commas", () => {
  assert.deepEqual(splitSelectorList("a, :is(#a, #b), [href^='x']"), [
    "a",
    " :is(#a, #b)",
    " [href^='x']",
  ]);
});

test("dedupeCssRules drops rules the document already got, across re-grouping", () => {
  const seen = new Set();
  const first = dedupeCssRules(
    splitCssRules(".foo, .bar, #id1 { display: none !important; }"),
    seen,
  );
  assert.deepEqual(first, [
    { selector: ".foo", declarations: "display: none !important;" },
    { selector: ".bar", declarations: "display: none !important;" },
    { selector: "#id1", declarations: "display: none !important;" },
  ]);
  // The reported bug: the engine re-emits still-matching rules on every flush, re-grouped.
  assert.deepEqual(
    dedupeCssRules(
      splitCssRules(".foo,\n.bar { display: none !important; }"),
      seen,
    ),
    [],
  );
});

test("dedupeCssRules keeps genuinely new rules and same-selector/different-declaration rules", () => {
  const seen = new Set();
  dedupeCssRules(splitCssRules(".foo { display: none !important; }"), seen);
  assert.deepEqual(
    dedupeCssRules(
      splitCssRules(
        ".foo { display: none !important; } .foo { visibility: hidden !important; } .banner { display: none !important; }",
      ),
      seen,
    ),
    [
      { selector: ".foo", declarations: "visibility: hidden !important;" },
      { selector: ".banner", declarations: "display: none !important;" },
    ],
  );
});

test("insertStyles inserts only new rules and nothing when everything is a repeat", () => {
  const inserted = [];
  const webFrame = {
    insertCSS: (css, options) => inserted.push({ css, options }),
  };
  insertStyles(webFrame, ".foo, .bar { display: none !important; }");
  insertStyles(webFrame, ".foo,\n.bar { display: none !important; }"); // all repeats
  insertStyles(
    webFrame,
    ".foo { display: none !important; } .baz { display: none !important; }",
  );
  assert.equal(inserted.length, 2);
  assert.equal(
    inserted[0].css,
    ".foo { display: none !important; }\n.bar { display: none !important; }",
  );
  assert.deepEqual(inserted[0].options, { cssOrigin: "user" });
  assert.equal(inserted[1].css, ".baz { display: none !important; }");
});

test("insertStyles falls back to the whole string for unbalanced CSS and skips empty input", () => {
  const inserted = [];
  const webFrame = { insertCSS: (css) => inserted.push(css) };
  insertStyles(webFrame, ".a { display: none;");
  insertStyles(webFrame, "   ");
  insertStyles(webFrame, null);
  assert.deepEqual(inserted, [".a { display: none;"]);
});
