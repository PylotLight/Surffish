import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CUSTOM_SEARCH_ENGINES,
  buildKeywordSearchUrl,
  makeSearchEngineId,
  parseCustomSearchEngines,
  parseKeywordSearch,
  validateCustomSearchEngine,
  validateCustomSearchEngineList,
  validateSearchKeyword,
  validateSearchTemplate,
} from "./search-keywords.ts";

const engines = DEFAULT_CUSTOM_SEARCH_ENGINES;

test("seeds the expected default keywords", () => {
  assert.deepEqual(
    engines.map((engine) => engine.keyword),
    ["g", "d", "b", "yt", "w", "gh", "npm"],
  );
  for (const engine of engines)
    assert.equal(
      validateCustomSearchEngine(
        engine,
        engines.filter((other) => other.id !== engine.id),
      ),
      null,
      engine.name,
    );
});

test("keyword then space routes to that engine", () => {
  const match = parseKeywordSearch("yt lofi beats", engines);
  assert.equal(match?.engine.id, "youtube");
  assert.equal(match?.query, "lofi beats");
  assert.equal(match?.via, "keyword");
  assert.equal(
    match?.url,
    "https://www.youtube.com/results?search_query=lofi%20beats",
  );
  assert.equal(
    parseKeywordSearch("  GH  surffish  ", engines)?.url,
    "https://github.com/search?q=surffish",
  );
});

test("a bare keyword or an unknown first word is not a keyword search", () => {
  assert.equal(parseKeywordSearch("yt", engines), null);
  assert.equal(parseKeywordSearch("yt   ", engines), null);
  assert.equal(parseKeywordSearch("youtube cats", engines), null);
  assert.equal(parseKeywordSearch("example.com", engines), null);
  assert.equal(parseKeywordSearch("", engines), null);
  assert.equal(parseKeywordSearch("yt cats", []), null);
});

test("bangs work anywhere in the query, DuckDuckGo-style", () => {
  assert.equal(
    parseKeywordSearch("!w Melbourne", engines)?.url,
    "https://en.wikipedia.org/wiki/Special:Search?search=Melbourne",
  );
  const trailing = parseKeywordSearch("electron webcontents !gh", engines);
  assert.equal(trailing?.engine.id, "github");
  assert.equal(trailing?.query, "electron webcontents");
  assert.equal(trailing?.via, "bang");
  assert.equal(
    parseKeywordSearch("react !NPM hooks", engines)?.url,
    "https://www.npmjs.com/search?q=react%20hooks",
  );
  // A bang beats a leading keyword.
  assert.equal(parseKeywordSearch("g cats !yt", engines)?.engine.id, "youtube");
});

test("a bang on its own opens the engine home page; unknown bangs fall through", () => {
  assert.equal(
    parseKeywordSearch("!yt", engines)?.url,
    "https://www.youtube.com/",
  );
  assert.equal(parseKeywordSearch("hello !nope", engines), null);
  assert.equal(parseKeywordSearch("wow!yt", engines), null);
});

test("explicit URLs are never rewritten", () => {
  assert.equal(parseKeywordSearch("https://example.com/#!g", engines), null);
  assert.equal(parseKeywordSearch("localhost:3000", engines), null);
});

test("queries are URL-encoded into every %s", () => {
  assert.equal(
    buildKeywordSearchUrl("https://x.test/?q=%s&again=%s", "a&b c/é"),
    "https://x.test/?q=a%26b%20c%2F%C3%A9&again=a%26b%20c%2F%C3%A9",
  );
});

test("templates must be https and contain %s", () => {
  assert.equal(validateSearchTemplate("https://example.com/search?q=%s"), null);
  assert.equal(validateSearchTemplate("https://example.com/wiki/%s"), null);
  assert.match(
    validateSearchTemplate("http://example.com/?q=%s") ?? "",
    /https/,
  );
  assert.match(validateSearchTemplate("https://example.com/?q=") ?? "", /%s/);
  assert.match(validateSearchTemplate("javascript:alert(%s)") ?? "", /https/);
  assert.match(validateSearchTemplate("not a url %s") ?? "", /valid/);
  assert.match(
    validateSearchTemplate("https://user:pw@example.com/?q=%s") ?? "",
    /password/,
  );
  assert.match(validateSearchTemplate("https://intranet/?q=%s") ?? "", /host/);
  assert.ok(validateSearchTemplate(""));
});

test("keywords are short, simple and unique", () => {
  assert.equal(validateSearchKeyword("so"), null);
  assert.equal(validateSearchKeyword("!so"), null);
  assert.ok(validateSearchKeyword("two words"));
  assert.ok(validateSearchKeyword("a.b"));
  assert.ok(validateSearchKeyword(""));
  assert.match(validateSearchKeyword("yt", engines) ?? "", /already/);
  assert.equal(validateSearchKeyword("yt", engines, "youtube"), null);
});

test("stored lists are sanitised; a missing list falls back to the defaults", () => {
  assert.deepEqual(parseCustomSearchEngines(null), engines);
  assert.deepEqual(parseCustomSearchEngines([]), []);
  const parsed = parseCustomSearchEngines([
    {
      id: "so",
      name: "Stack Overflow",
      keyword: "SO",
      urlTemplate: "https://stackoverflow.com/search?q=%s",
    },
    {
      id: "so",
      name: "Duplicate id",
      keyword: "so2",
      urlTemplate: "https://stackoverflow.com/search?q=%s",
    },
    {
      id: "dupe",
      name: "Duplicate keyword",
      keyword: "so",
      urlTemplate: "https://example.com/?q=%s",
    },
    {
      id: "bad",
      name: "Insecure",
      keyword: "bad",
      urlTemplate: "http://example.com/?q=%s",
    },
    "junk",
  ]);
  assert.deepEqual(parsed, [
    {
      id: "so",
      name: "Stack Overflow",
      keyword: "so",
      urlTemplate: "https://stackoverflow.com/search?q=%s",
    },
  ]);
});

test("new ids are slugs that never collide", () => {
  assert.equal(makeSearchEngineId("Stack Overflow", []), "stack-overflow");
  assert.equal(makeSearchEngineId("YouTube", engines), "youtube-2");
  assert.equal(makeSearchEngineId("!!!", []), "engine");
});

test("saving the whole list: a bad entry is a validation result naming it, never a throw", () => {
  const good = {
    id: "so",
    name: "Stack Overflow",
    keyword: "so",
    urlTemplate: "https://stackoverflow.com/search?q=%s",
  };
  assert.deepEqual(validateCustomSearchEngineList([good]), {
    ok: true,
    engines: [good],
  });
  assert.deepEqual(validateCustomSearchEngineList([]), {
    ok: true,
    engines: [],
  });
  const bad = validateCustomSearchEngineList([
    good,
    {
      id: "x",
      name: "Bad",
      keyword: "x",
      urlTemplate: "http://example.com/?q=%s",
    },
  ]);
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? "" : bad.error, /^Bad: .*https/);
  const duplicate = validateCustomSearchEngineList([
    good,
    { ...good, id: "so-2", name: "Again" },
  ]);
  assert.match(duplicate.ok ? "" : duplicate.error, /^Again: /);
  assert.deepEqual(validateCustomSearchEngineList("nope"), {
    ok: false,
    error: "Expected a list of search engines.",
  });
  assert.equal(
    validateCustomSearchEngineList(
      Array.from({ length: 51 }, (_, index) => ({
        ...good,
        id: `e${index}`,
        keyword: `k${index}`,
      })),
    ).ok,
    false,
  );
  assert.equal(validateCustomSearchEngineList([null]).ok, false);
});
