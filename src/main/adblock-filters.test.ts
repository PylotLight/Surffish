import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFilterEngine,
  frameStartPayload,
  frameUpdateStyles,
} from "./adblock-filters.ts";
import {
  SCRIPTLET_RESOURCES_URL,
  type FilterListSource,
} from "./adblock-policy.ts";

// Minimal resources.json with a real-shaped scriptlet so +js rules compile.
const RESOURCES = JSON.stringify({
  redirects: [],
  scriptlets: [
    {
      name: "set-constant.js",
      aliases: ["set.js"],
      body: "function setConstant(a, b) { window.__surffishSet = [a, b] }",
      dependencies: [],
    },
    {
      name: "json-prune.js",
      aliases: [],
      body: "function jsonPrune(a) { window.__surffishPrune = a }",
      dependencies: [],
    },
  ],
});

const MAIN_LIST = [
  "! Title: fixture",
  "!#include part.txt",
  "||ads.example^$script",
  "example.com##.banner-ad",
  "##.generic-ad-slot",
  "www.youtube.com##+js(json-prune, playerResponse.adPlacements)",
  "!#if env_firefox",
  "example.com##.firefox-only",
  "!#endif",
  "!#if env_chromium",
  "example.com##.chromium-only",
  "!#endif",
  "!#if cap_html_filtering",
  "example.com##^script:has-text(ads)",
  "!#else",
  "example.com##+js(set, noHtmlFiltering, true)",
  "!#endif",
].join("\n");

const SOURCES: FilterListSource[] = [
  { id: "ublock-filters", url: "https://lists.example/filters/main.txt" },
  { id: "ublock-quick-fixes", url: "https://lists.example/filters/quick.txt" },
  { id: "easylist", url: "https://lists.example/easylist.txt" },
  { id: "optional-broken", url: "https://lists.example/missing.txt" },
];

function fixtureFetch(requested: string[]) {
  return async (url: string): Promise<Response> => {
    requested.push(url);
    if (url === SCRIPTLET_RESOURCES_URL) return new Response(RESOURCES);
    if (url.endsWith("/main.txt")) return new Response(MAIN_LIST);
    if (url.endsWith("/part.txt")) return new Response("||included.example^");
    if (url.endsWith("/quick.txt"))
      return new Response("www.youtube.com##+js(set, ytcfg.flag, false)");
    if (url.endsWith("/easylist.txt")) return new Response("##.easylist-ad");
    return new Response("missing", { status: 404 });
  };
}

test("builds a full engine from lists, expands includes and tolerates optional failures", async () => {
  const requested: string[] = [];
  const built = await buildFilterEngine(fixtureFetch(requested), SOURCES);
  assert.ok(
    requested.includes("https://lists.example/filters/part.txt"),
    "include fetched",
  );
  assert.deepEqual(built.loadedLists, [
    "ublock-filters",
    "ublock-quick-fixes",
    "easylist",
  ]);
  assert.deepEqual(built.failedLists, ["optional-broken"]);

  const decide = (url: string) => {
    let response: Electron.CallbackResponse | undefined;
    built.engine.onBeforeRequest(
      {
        id: 1,
        url,
        resourceType: "script",
        referrer: "https://news.example/",
        webContentsId: 1,
      } as Parameters<typeof built.engine.onBeforeRequest>[0],
      (result) => {
        response = result;
      },
    );
    return response;
  };
  assert.deepEqual(decide("https://ads.example/a.js"), { cancel: true });
  assert.deepEqual(decide("https://included.example/a.js"), { cancel: true });
  assert.deepEqual(decide("https://cdn.example/app.js"), {});
});

test("fails when a required list is missing so the previous engine stays active", async () => {
  const fetch = async (url: string): Promise<Response> => {
    if (url === SCRIPTLET_RESOURCES_URL) return new Response(RESOURCES);
    if (url.endsWith("/quick.txt"))
      return new Response("down", { status: 503 });
    return fixtureFetch([])(url);
  };
  await assert.rejects(buildFilterEngine(fetch, SOURCES), /ublock-quick-fixes/);
});

test("frame start payload carries YouTube scriptlets and site CSS, honoring !#if", async () => {
  const { engine } = await buildFilterEngine(fixtureFetch([]), SOURCES);

  const youtube = frameStartPayload(
    engine,
    "https://www.youtube.com/watch?v=abc",
  );
  assert.equal(youtube.active, true);
  assert.equal(youtube.observe, true);
  const youtubeScripts = youtube.scripts.join("\n");
  assert.match(youtubeScripts, /__surffishPrune/);
  assert.match(youtubeScripts, /playerResponse\\?\.adPlacements/);
  assert.match(youtubeScripts, /__surffishSet/);

  const example = frameStartPayload(engine, "https://example.com/");
  assert.match(example.styles, /\.banner-ad/);
  assert.match(example.styles, /\.chromium-only/);
  assert.doesNotMatch(example.styles, /\.firefox-only/);
  assert.match(example.scripts.join("\n"), /noHtmlFiltering/);

  assert.deepEqual(frameStartPayload(engine, "about:blank"), {
    active: false,
    styles: "",
    scripts: [],
    observe: false,
  });
});

test("generic cosmetic CSS is returned only for DOM features the page has", async () => {
  const { engine } = await buildFilterEngine(fixtureFetch([]), SOURCES);
  const styles = frameUpdateStyles(engine, "https://news.example/", {
    classes: ["generic-ad-slot", "content"],
    ids: [],
    hrefs: [],
  });
  assert.match(styles, /\.generic-ad-slot/);
  assert.equal(
    frameUpdateStyles(engine, "https://news.example/", {
      classes: ["content"],
    }),
    "",
  );
  assert.equal(
    frameUpdateStyles(engine, "https://news.example/", {
      classes: "not-an-array",
    }),
    "",
  );
});

// Shared helpers like uBO's safeSelf, so assembled scriptlets each carry a copy until bundled.
const SHARED_RESOURCES = JSON.stringify({
  redirects: [],
  scriptlets: [
    {
      name: "safe-self.fn",
      aliases: [],
      body: "function safeSelf() { if (safeSelf.safe) return safeSelf.safe; safeSelf.safe = { marks: [] }; return safeSelf.safe }",
      dependencies: [],
    },
    {
      name: "mark-helper.fn",
      aliases: [],
      body: "class MarkHelper { static mark(name) { safeSelf().marks.push(name); window[name] = true } }",
      dependencies: ["safe-self.fn"],
    },
    {
      name: "mark.js",
      aliases: [],
      body: "function mark(name) { MarkHelper.mark(name) }",
      dependencies: ["mark-helper.fn", "safe-self.fn"],
    },
    {
      name: "boom.js",
      aliases: [],
      body: 'function boom() { throw new Error("boom") }',
      dependencies: ["safe-self.fn"],
    },
  ],
});

async function sharedEngine(lines: string[]) {
  const fetch = async (url: string): Promise<Response> => {
    if (url === SCRIPTLET_RESOURCES_URL) return new Response(SHARED_RESOURCES);
    if (url.endsWith("/main.txt")) return new Response(lines.join("\n"));
    return new Response("! empty");
  };
  return (await buildFilterEngine(fetch, SOURCES.slice(0, 3))).engine;
}

test("frame start payload bundles scriptlets so shared helpers ship once", async () => {
  const engine = await sharedEngine([
    "video.example##+js(mark, markOne)",
    "video.example##+js(boom)",
    "video.example##+js(mark, markTwo)",
  ]);
  const payload = frameStartPayload(engine, "https://video.example/watch");
  assert.equal(payload.scripts.length, 1);
  assert.equal(payload.scriptletCount, 3);
  const bundle = payload.scripts[0]!;
  assert.equal(
    bundle.split("function safeSelf()").length - 1,
    1,
    "safeSelf declared once",
  );
  assert.equal(
    bundle.split("class MarkHelper").length - 1,
    1,
    "MarkHelper declared once",
  );
  // Same evaluation as the preload (one block in one global scope); a throwing scriptlet doesn't stop the rest.
  const window: Record<string, unknown> = {};
  new Function("window", `{\n${bundle}\n}`)(window);
  assert.equal(window.markOne, true);
  assert.equal(window.markTwo, true);
});

test("frame start payload is cached per hostname and per engine", async () => {
  const engine = await sharedEngine([
    "video.example##+js(mark, markOne)",
    "video.example##+js(mark, markTwo)",
    "video.example##.promo",
  ]);
  const first = frameStartPayload(engine, "https://video.example/watch?v=1");
  assert.equal(
    frameStartPayload(engine, "https://video.example/other#x"),
    first,
  );
  assert.notEqual(frameStartPayload(engine, "https://other.example/"), first);
  const refreshed = await sharedEngine(["video.example##.promo"]);
  const after = frameStartPayload(refreshed, "https://video.example/watch?v=1");
  assert.notEqual(after, first);
  assert.deepEqual(after.scripts, []);
});

test("path-specific hide exceptions are part of the cache key", async () => {
  const engine = await sharedEngine([
    "##.generic-promo",
    "shop.example##.site-promo",
    "@@||shop.example/checkout$elemhide",
  ]);
  const home = frameStartPayload(engine, "https://shop.example/");
  assert.match(home.styles, /\.site-promo/);
  assert.equal(home.observe, true);
  const checkout = frameStartPayload(
    engine,
    "https://shop.example/checkout/pay",
  );
  assert.doesNotMatch(checkout.styles, /\.site-promo/);
  assert.equal(checkout.observe, false);
  assert.equal(frameStartPayload(engine, "https://shop.example/cart"), home);
});

test("$generichide frames with nothing specific are inactive (no DOM observer)", async () => {
  const engine = await sharedEngine([
    "##.generic-promo",
    "@@||code.example^$generichide",
    "docs.example##.banner",
    "@@||docs.example^$generichide",
  ]);
  assert.deepEqual(frameStartPayload(engine, "https://code.example/repo"), {
    active: false,
    styles: "",
    scripts: [],
    observe: false,
  });
  const docs = frameStartPayload(engine, "https://docs.example/");
  assert.equal(docs.active, true);
  assert.match(docs.styles, /\.banner/);
  assert.equal(docs.observe, false);
  assert.equal(
    frameStartPayload(engine, "https://news.example/").observe,
    true,
  );
  assert.match(
    frameUpdateStyles(engine, "https://news.example/", {
      classes: ["generic-promo"],
    }),
    /\.generic-promo/,
  );
});

test("scriptlet resources come from a pinned release tag, not a moving branch", () => {
  const url = new URL(SCRIPTLET_RESOURCES_URL);
  assert.equal(url.hostname, "raw.githubusercontent.com");
  // …/ghostery/adblocker/<tag>/packages/adblocker/assets/ublock-origin/resources.json
  const segments = url.pathname.split("/");
  assert.equal(segments[1], "ghostery");
  assert.equal(segments[2], "adblocker");
  assert.equal(segments[3], "v2.20.3");
});
