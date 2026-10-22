import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildExtractScript,
  buildReaderableScript,
  countWords,
  DEFAULT_READER_SETTINGS,
  estimateReadingMinutes,
  formatReadingTime,
  isArticleImageAllowed,
  isReaderCandidateUrl,
  isReaderUrl,
  MAX_READER_CONTENT_CHARS,
  normalizeReaderSettings,
  parseExtractedArticle,
  parseReaderableResult,
  parseReaderImageRequest,
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN,
  READER_URL,
  readerAssetPath,
  readerImageUrl,
} from "./reader.ts";

const readabilityDir = join(
  import.meta.dirname,
  "..",
  "..",
  "node_modules",
  "@mozilla",
  "readability",
);
const readerableSource = readFileSync(
  join(readabilityDir, "Readability-readerable.js"),
  "utf8",
);

interface FakeNode {
  textContent: string;
  className: string;
  id: string;
  style: { display: string };
  parentNode?: FakeNode;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
}

function node(
  text: string,
  options: { className?: string; hidden?: boolean; inListItem?: boolean } = {},
): FakeNode {
  return {
    textContent: text,
    className: options.className ?? "",
    id: "",
    style: { display: options.hidden ? "none" : "block" },
    hasAttribute: () => false,
    getAttribute: () => null,
    matches: (selector) => selector === "li p" && options.inListItem === true,
  };
}

/** Runs the generated detection script against a stand-in `document`, as the isolated world would. */
function runReaderable(
  nodes: FakeNode[],
  extra: Record<string, unknown> = {},
): unknown {
  const document = {
    body: {},
    contentType: "text/html",
    querySelectorAll: (selector: string) =>
      selector === "p, pre, article" ? nodes : [],
    ...extra,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    "document",
    `return ${buildReaderableScript(readerableSource)}`,
  )(document);
}

const paragraph =
  "Reader view should light up for pages with several long paragraphs of running text, which is what an article looks like to Readability. ".repeat(
    3,
  );

test("detection script: several long visible paragraphs are readerable", () => {
  assert.equal(
    parseReaderableResult(
      runReaderable([node(paragraph), node(paragraph), node(paragraph)]),
    ),
    true,
  );
});

test("detection script: short, hidden, list-item or comment text is not", () => {
  assert.equal(
    runReaderable([node("Short blurb."), node("Another one.")]),
    false,
  );
  assert.equal(
    runReaderable([
      node(paragraph, { hidden: true }),
      node(paragraph, { hidden: true }),
    ]),
    false,
  );
  assert.equal(
    runReaderable([
      node(paragraph, { inListItem: true }),
      node(paragraph, { inListItem: true }),
    ]),
    false,
  );
  assert.equal(
    runReaderable([
      node(paragraph, { className: "comment" }),
      node(paragraph, { className: "sidebar" }),
    ]),
    false,
  );
});

test("detection script: non-HTML documents and missing bodies are skipped without throwing", () => {
  assert.equal(
    runReaderable([node(paragraph), node(paragraph)], {
      contentType: "application/json",
    }),
    false,
  );
  assert.equal(
    runReaderable([node(paragraph), node(paragraph)], { body: null }),
    false,
  );
});

test("detection script: a page that breaks the DOM API reports an error object, which reads as false", () => {
  const result = runReaderable([], {
    querySelectorAll: () => {
      throw new Error("boom");
    },
  });
  assert.deepEqual(result, { error: "boom" });
  assert.equal(parseReaderableResult(result), false);
});

test("parseReaderableResult only accepts a literal true", () => {
  for (const value of [true]) assert.equal(parseReaderableResult(value), true);
  for (const value of [
    false,
    "true",
    1,
    null,
    undefined,
    {},
    { readerable: true },
  ])
    assert.equal(parseReaderableResult(value), false);
});

test("extraction script wraps Readability and returns the fields Reader view uses", () => {
  const script = buildExtractScript(
    "function Readability() {}\nmodule.exports = Readability;",
  );
  assert.match(script, /new exported\(document\.cloneNode\(true\)/);
  for (const field of [
    "title",
    "byline",
    "siteName",
    "content",
    "textContent",
    "lang",
    "dir",
    "publishedTime",
  ])
    assert.match(script, new RegExp(`${field}:`));
  // Runs as a plain script: the CommonJS shim is local, not a global.
  assert.doesNotThrow(
    () =>
      new Function(
        `return ${buildExtractScript(readFileSync(join(readabilityDir, "Readability.js"), "utf8"))}`,
      ),
  );
});

test("candidate URLs: http(s) article-ish pages only", () => {
  assert.equal(
    isReaderCandidateUrl("https://example.com/2026/10/some-story"),
    true,
  );
  assert.equal(isReaderCandidateUrl("http://example.com/post?id=4"), true);
  assert.equal(isReaderCandidateUrl("https://example.com/"), false);
  assert.equal(isReaderCandidateUrl("https://example.com/report.pdf"), false);
  assert.equal(isReaderCandidateUrl("https://example.com/photo.JPG"), false);
  assert.equal(isReaderCandidateUrl("file:///Users/me/a.html"), false);
  assert.equal(
    isReaderCandidateUrl("surffish-reader://reader/reader.html"),
    false,
  );
  assert.equal(
    isReaderCandidateUrl("chrome-extension://abc/options.html"),
    false,
  );
  assert.equal(isReaderCandidateUrl("not a url"), false);
});

test("settings: defaults, clamping and unknown values", () => {
  assert.deepEqual(normalizeReaderSettings(null), DEFAULT_READER_SETTINGS);
  assert.deepEqual(
    normalizeReaderSettings({
      font: "sans",
      fontSize: 22.4,
      width: "wide",
      theme: "sepia",
    }),
    { font: "sans", fontSize: 22, width: "wide", theme: "sepia" },
  );
  assert.equal(
    normalizeReaderSettings({ fontSize: 2 }).fontSize,
    READER_FONT_SIZE_MIN,
  );
  assert.equal(
    normalizeReaderSettings({ fontSize: 400 }).fontSize,
    READER_FONT_SIZE_MAX,
  );
  assert.equal(
    normalizeReaderSettings({ fontSize: Number.NaN }).fontSize,
    DEFAULT_READER_SETTINGS.fontSize,
  );
  assert.deepEqual(
    normalizeReaderSettings({ font: "comic", width: "huge", theme: "neon" }),
    DEFAULT_READER_SETTINGS,
  );
  // A partial patch keeps the current values.
  const current = {
    font: "sans",
    fontSize: 24,
    width: "narrow",
    theme: "dark",
  } as const;
  assert.deepEqual(normalizeReaderSettings({ theme: "light" }, current), {
    ...current,
    theme: "light",
  });
});

test("reading time: ~230 wpm, CJK counted by characters, never under a minute", () => {
  assert.equal(estimateReadingMinutes(""), 1);
  assert.equal(estimateReadingMinutes("word ".repeat(230)), 1);
  assert.equal(estimateReadingMinutes("word ".repeat(2300)), 10);
  assert.equal(estimateReadingMinutes("字".repeat(5000)), 10);
  assert.equal(countWords("It's a well-known fact — 42 times."), 6);
  assert.equal(formatReadingTime(1), "1 min read");
  assert.equal(formatReadingTime(7), "7 min read");
});

test("extracted article: validated, trimmed and timed", () => {
  const result = parseExtractedArticle(
    {
      title: "  A   headline ",
      byline: "By Someone",
      siteName: "",
      excerpt: "x",
      lang: "en-AU",
      dir: "ltr",
      publishedTime: "2026-10-12T09:00:00Z",
      content: "<div><p>Hello</p></div>",
      textContent: "word ".repeat(690),
    },
    "https://news.example.org/a/b",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.article.title, "A headline");
  assert.equal(result.article.siteName, "news.example.org");
  assert.equal(result.article.lang, "en-AU");
  assert.equal(result.article.dir, "ltr");
  assert.equal(result.article.readingMinutes, 3);
  assert.equal(result.article.wordCount, 690);
  assert.equal(result.article.url, "https://news.example.org/a/b");
});

test("extracted article: failures and hostile shapes", () => {
  assert.equal(parseExtractedArticle(null, "https://a.test/x").ok, false);
  assert.equal(
    parseExtractedArticle("<p>hi</p>", "https://a.test/x").ok,
    false,
  );
  assert.equal(
    parseExtractedArticle({ error: "TypeError" }, "https://a.test/x").ok,
    false,
  );
  assert.equal(
    parseExtractedArticle({ content: "   " }, "https://a.test/x").ok,
    false,
  );
  assert.equal(
    parseExtractedArticle(
      { content: "x".repeat(MAX_READER_CONTENT_CHARS + 1) },
      "https://a.test/x",
    ).ok,
    false,
  );
  const odd = parseExtractedArticle(
    { content: "<p>x</p>", title: 42, lang: 'en"><script>', dir: "sideways" },
    "https://a.test/x",
  );
  assert.equal(odd.ok, true);
  if (!odd.ok) return;
  assert.equal(odd.article.title, "a.test");
  assert.equal(odd.article.lang, "");
  assert.equal(odd.article.dir, "auto");
});

test("image proxy URLs round-trip and only proxy images the article uses", () => {
  const token = "0f8fa1d2-3a4b-4c5d-8e9f-001122334455";
  const image = "https://cdn.example.com/a b/pic.jpg?w=800&h=600";
  const proxied = readerImageUrl(token, image);
  assert.deepEqual(parseReaderImageRequest(proxied), { token, url: image });
  assert.equal(parseReaderImageRequest(readerImageUrl("short", image)), null);
  assert.equal(
    parseReaderImageRequest(readerImageUrl(token, "file:///etc/passwd")),
    null,
  );
  assert.equal(
    parseReaderImageRequest(
      readerImageUrl(token, "https://user:pw@cdn.example.com/x.png"),
    ),
    null,
  );
  assert.equal(
    parseReaderImageRequest(
      `surffish-pdf://editor/image?d=${token}&u=${encodeURIComponent(image)}`,
    ),
    null,
  );

  const content =
    '<p><img src="https://cdn.example.com/pic.jpg?w=800&amp;h=600"></p>';
  assert.equal(
    isArticleImageAllowed(
      "https://cdn.example.com/pic.jpg?w=800&h=600",
      content,
    ),
    true,
  );
  assert.equal(
    isArticleImageAllowed("https://cdn.example.com/other.jpg", content),
    false,
  );
  assert.equal(
    isArticleImageAllowed(
      "https://cdn.example.com/a%20b.png",
      '<img src="https://cdn.example.com/a b.png">',
    ),
    true,
  );
  assert.equal(
    isArticleImageAllowed("http://127.0.0.1:8080/admin", content),
    false,
  );
});

test("reader page assets: only the page and hashed assets on the reader origin", () => {
  assert.equal(readerAssetPath(READER_URL), "reader.html");
  assert.equal(
    readerAssetPath("surffish-reader://reader/assets/reader-abc123.js"),
    "assets/reader-abc123.js",
  );
  assert.equal(
    readerAssetPath("surffish-reader://reader/assets/../../main/index.js"),
    null,
  );
  assert.equal(readerAssetPath("surffish-reader://reader/%2e%2e/secret"), null);
  assert.equal(readerAssetPath("surffish-reader://other/reader.html"), null);
  assert.equal(readerAssetPath("surffish-pdf://reader/reader.html"), null);
  assert.equal(readerAssetPath("surffish-reader://reader/index.html"), null);
  assert.equal(isReaderUrl(`${READER_URL}?x=1#top`), true);
  assert.equal(isReaderUrl("surffish-reader://reader/assets/a.js"), false);
});
