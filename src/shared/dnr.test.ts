import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDnrHeaderRules,
  applyUrlTransform,
  compileUrlFilter,
  DnrMatcher,
  dnrRedirectUrl,
  dnrResourceType,
  manifestDnrRulesets,
  parseDnrRules,
  unsupportedDnrRuleCount,
  urlFilterToken,
  type DnrRequest,
} from "./dnr.ts";

function matcher(
  rules: unknown[],
  kind: "static" | "dynamic" | "session" = "static",
): DnrMatcher {
  const parsed = parseDnrRules(rules, "test", kind);
  assert.deepEqual(parsed.rejected, []);
  return new DnrMatcher(parsed.rules);
}

const script = (url: string, initiator?: string): DnrRequest => ({
  url,
  initiator,
  type: "script",
});

test("urlFilter syntax: wildcards, anchors, separators, case", () => {
  const re = (filter: string, url: string, caseSensitive = false) =>
    compileUrlFilter(filter, caseSensitive).test(url);
  assert.ok(re("abc*d", "http://abcd.com"));
  assert.ok(re("abc*d", "http://abcxyzd.com"));
  assert.ok(re("|http://abc", "http://abc.com"));
  assert.ok(!re("|http://abc", "https://x.com/?u=http://abc"));
  assert.ok(re(".js|", "http://x.com/a.js"));
  assert.ok(!re(".js|", "http://x.com/a.js?x"));
  assert.ok(re("||example.com", "https://example.com/"));
  assert.ok(re("||example.com", "https://cdn.example.com/x"));
  assert.ok(!re("||example.com", "https://notexample.com/x"));
  assert.ok(!re("||example.com", "https://x.com/?r=example.com"));
  assert.ok(re("||example.com^", "https://example.com/a"));
  assert.ok(re("||example.com^", "https://example.com"));
  assert.ok(!re("||example.com^", "https://example.com.evil.net/"));
  assert.ok(re("/ADS/", "https://x.com/ads/a"));
  assert.ok(!re("/ADS/", "https://x.com/ads/a", true));
});

test("index tokens are whole URL tokens only", () => {
  assert.equal(urlFilterToken("||example.com^"), "example");
  assert.equal(urlFilterToken("*/iubenda_cs*"), "iubenda");
  assert.equal(urlFilterToken("abc*"), null);
  assert.equal(urlFilterToken("*static.clickskeks.at*"), "clickskeks");
  assert.equal(urlFilterToken("|https://a.io/consent.js|"), "consent");
});

test("literal urlFilter rules (the cookie-extension shape) block matching subresources", () => {
  const m = matcher([
    {
      id: 1,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: "/iubenda_cs",
        resourceTypes: ["script", "stylesheet", "xmlhttprequest", "image"],
        excludedInitiatorDomains: ["skuola.net"],
      },
    },
    {
      id: 3,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: "static.clickskeks.at",
        resourceTypes: ["script"],
      },
    },
    {
      id: 4,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: "cookie-bar",
        resourceTypes: ["script"],
        initiatorDomains: ["news.example"],
      },
    },
  ]);
  assert.equal(
    m.match(script("https://cdn.iubenda.com/IUBENDA_CS.js", "https://site.it"))
      .rule?.id,
    1,
  );
  assert.equal(
    m.match(
      script("https://cdn.iubenda.com/iubenda_cs.js", "https://www.skuola.net"),
    ).rule,
    null,
  );
  assert.equal(
    m.match({
      url: "https://cdn.iubenda.com/iubenda_cs.js",
      initiator: "https://site.it",
      type: "font",
    }).rule,
    null,
  );
  assert.equal(
    m.match(script("https://static.clickskeks.at/x.js", "https://a.at")).rule
      ?.id,
    3,
  );
  assert.equal(
    m.match(
      script("https://cdn.example/cookie-bar.js", "https://www.news.example"),
    ).rule?.id,
    4,
  );
  assert.equal(
    m.match(
      script("https://cdn.example/cookie-bar.js", "https://other.example"),
    ).rule,
    null,
  );
  // No initiator (browser-initiated): initiatorDomains never matches.
  assert.equal(m.match(script("https://cdn.example/cookie-bar.js")).rule, null);
});

test("resource type defaults exclude main_frame; excludedResourceTypes", () => {
  const m = matcher([
    { id: 1, action: { type: "block" }, condition: { urlFilter: "tracker" } },
    {
      id: 2,
      action: { type: "block" },
      condition: { urlFilter: "pixel", excludedResourceTypes: ["image"] },
    },
  ]);
  assert.equal(
    m.match({ url: "https://tracker.io/", type: "main_frame" }).rule,
    null,
  );
  assert.equal(
    m.match({ url: "https://tracker.io/", type: "sub_frame" }).rule?.id,
    1,
  );
  assert.equal(
    m.match({ url: "https://x.io/pixel.gif", type: "image" }).rule,
    null,
  );
  assert.equal(
    m.match({ url: "https://x.io/pixel.gif", type: "main_frame" }).rule?.id,
    2,
  );
});

test("requestDomains, domainType, methods, regexFilter", () => {
  const m = matcher([
    {
      id: 1,
      action: { type: "block" },
      condition: {
        requestDomains: ["ads.com"],
        excludedRequestDomains: ["ok.ads.com"],
        resourceTypes: ["image"],
      },
    },
    {
      id: 2,
      action: { type: "block" },
      condition: {
        urlFilter: "beacon",
        domainType: "thirdParty",
        resourceTypes: ["ping", "xmlhttprequest"],
      },
    },
    {
      id: 3,
      action: { type: "block" },
      condition: {
        urlFilter: "submit",
        requestMethods: ["post"],
        resourceTypes: ["xmlhttprequest"],
      },
    },
    {
      id: 4,
      action: { type: "block" },
      condition: {
        regexFilter: "^https://[a-z]+\\.cmp\\.io/v[0-9]+/",
        resourceTypes: ["script"],
      },
    },
  ]);
  const img = (url: string): DnrRequest => ({
    url,
    type: "image",
    initiator: "https://site.com",
  });
  assert.equal(m.match(img("https://ads.com/a.png")).rule?.id, 1);
  assert.equal(m.match(img("https://x.ads.com/a.png")).rule?.id, 1);
  assert.equal(m.match(img("https://ok.ads.com/a.png")).rule, null);
  assert.equal(m.match(img("https://badads.com/a.png")).rule, null);
  const xhr = (url: string, initiator: string, method = "GET"): DnrRequest => ({
    url,
    initiator,
    method,
    type: "xmlhttprequest",
  });
  assert.equal(
    m.match(xhr("https://stats.other.net/beacon", "https://www.site.co.uk"))
      .rule?.id,
    2,
  );
  assert.equal(
    m.match(xhr("https://stats.site.co.uk/beacon", "https://www.site.co.uk"))
      .rule,
    null,
  );
  assert.equal(
    m.match(xhr("https://x.io/submit", "https://x.io", "POST")).rule?.id,
    3,
  );
  assert.equal(
    m.match(xhr("https://x.io/submit", "https://x.io", "GET")).rule,
    null,
  );
  assert.equal(m.match(script("https://eu.cmp.io/v2/cmp.js")).rule?.id, 4);
  assert.equal(m.match(script("https://eu.cmp.io/latest/cmp.js")).rule, null);
});

test("priority and action precedence; allow rules from the whitelist shape", () => {
  const staticRules = parseDnrRules(
    [
      {
        id: 1,
        priority: 1,
        action: { type: "block" },
        condition: { urlFilter: "/consent.js", resourceTypes: ["script"] },
      },
    ],
    "ruleset_1",
    "static",
  ).rules;
  // The extension's whitelist: allow everything from a site the user switched it off for.
  const dynamicRules = parseDnrRules(
    [
      {
        id: 1,
        priority: 1,
        action: { type: "allow" },
        condition: {
          urlFilter: "*",
          resourceTypes: ["script", "stylesheet", "xmlhttprequest", "image"],
          initiatorDomains: ["trusted.com"],
        },
      },
    ],
    "_dynamic",
    "dynamic",
  ).rules;
  const m = new DnrMatcher([...staticRules, ...dynamicRules]);
  assert.equal(
    m.match(script("https://cdn.io/consent.js", "https://news.com")).rule
      ?.action.type,
    "block",
  );
  assert.equal(
    m.match(script("https://cdn.io/consent.js", "https://www.trusted.com")).rule
      ?.action.type,
    "allow",
  );

  const ranked = matcher([
    {
      id: 1,
      priority: 1,
      action: { type: "allow" },
      condition: { urlFilter: "x.js" },
    },
    {
      id: 2,
      priority: 2,
      action: { type: "block" },
      condition: { urlFilter: "x.js" },
    },
    {
      id: 3,
      priority: 2,
      action: { type: "redirect", redirect: { url: "https://r.io/" } },
      condition: { urlFilter: "x.js" },
    },
    {
      id: 4,
      priority: 2,
      action: { type: "upgradeScheme" },
      condition: { urlFilter: "x.js" },
    },
  ]);
  assert.equal(ranked.match(script("http://a.io/x.js")).rule?.id, 2);
});

test("allowAllRequests covers the frame and outranks lower-priority blocks", () => {
  const m = matcher([
    {
      id: 1,
      priority: 5,
      action: { type: "allowAllRequests" },
      condition: {
        requestDomains: ["shop.com"],
        resourceTypes: ["main_frame"],
      },
    },
    {
      id: 2,
      priority: 1,
      action: { type: "block" },
      condition: { urlFilter: "ads.js" },
    },
    {
      id: 3,
      priority: 9,
      action: { type: "block" },
      condition: { urlFilter: "evil.js" },
    },
  ]);
  const frame = m.match({ url: "https://shop.com/", type: "main_frame" });
  assert.equal(frame.rule?.action.type, "allowAllRequests");
  assert.equal(
    m.match({
      ...script("https://cdn.io/ads.js", "https://shop.com"),
      allowAllRequestsPriority: 5,
    }).rule,
    null,
  );
  assert.equal(
    m.match({
      ...script("https://cdn.io/evil.js", "https://shop.com"),
      allowAllRequestsPriority: 5,
    }).rule?.id,
    3,
  );
  assert.equal(
    parseDnrRules(
      [
        {
          id: 1,
          action: { type: "allowAllRequests" },
          condition: { resourceTypes: ["script"] },
        },
      ],
      "t",
      "static",
    ).rejected.length,
    1,
  );
});

test("redirects: url, extensionPath, transform, regexSubstitution, upgradeScheme", () => {
  const [byUrl, byPath, byTransform, byRegex, upgrade] = parseDnrRules(
    [
      {
        id: 1,
        action: {
          type: "redirect",
          redirect: { url: "https://example.org/empty.js" },
        },
        condition: { urlFilter: "a" },
      },
      {
        id: 2,
        action: { type: "redirect", redirect: { extensionPath: "/stub.js" } },
        condition: { urlFilter: "a" },
      },
      {
        id: 3,
        action: {
          type: "redirect",
          redirect: {
            transform: {
              scheme: "https",
              host: "new.io",
              queryTransform: {
                removeParams: ["utm_source"],
                addOrReplaceParams: [
                  { key: "a", value: "1" },
                  { key: "z", value: "9", replaceOnly: true },
                ],
              },
            },
          },
        },
        condition: { urlFilter: "a" },
      },
      {
        id: 4,
        action: {
          type: "redirect",
          redirect: { regexSubstitution: "https://\\1.mirror.io/\\2" },
        },
        condition: { regexFilter: "^https?://([a-z]+)\\.cdn\\.io/(.*)$" },
      },
      {
        id: 5,
        action: { type: "upgradeScheme" },
        condition: { urlFilter: "a" },
      },
    ],
    "t",
    "static",
  ).rules;
  assert.equal(
    dnrRedirectUrl(byUrl!, "https://a.io/x.js", "ext"),
    "https://example.org/empty.js",
  );
  assert.equal(
    dnrRedirectUrl(
      byPath!,
      "https://a.io/x.js",
      "abcdefghijklmnopabcdefghijklmnop",
    ),
    "chrome-extension://abcdefghijklmnopabcdefghijklmnop/stub.js",
  );
  assert.equal(
    dnrRedirectUrl(byTransform!, "http://old.io/p?utm_source=x&b=2", "ext"),
    "https://new.io/p?b=2&a=1",
  );
  assert.equal(
    dnrRedirectUrl(byRegex!, "http://eu.cdn.io/lib/a.js", "ext"),
    "https://eu.mirror.io/lib/a.js",
  );
  assert.equal(
    dnrRedirectUrl(upgrade!, "http://a.io/", "ext"),
    "https://a.io/",
  );
  assert.equal(dnrRedirectUrl(upgrade!, "https://a.io/", "ext"), null);
  assert.equal(
    applyUrlTransform("https://a.io/x#frag", {
      fragment: "",
      port: "8443",
      path: "",
    }),
    "https://a.io:8443/",
  );
});

test("modifyHeaders: priority order and Chrome merge rules", () => {
  const m = matcher([
    {
      id: 1,
      priority: 3,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "X-Test", operation: "set", value: "high" },
          { header: "Cookie", operation: "remove" },
        ],
      },
      condition: { urlFilter: "api" },
    },
    {
      id: 2,
      priority: 2,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "x-test", operation: "set", value: "low" },
          { header: "X-List", operation: "append", value: "b" },
        ],
      },
      condition: { urlFilter: "api" },
    },
    {
      id: 3,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "Set-Cookie", operation: "append", value: "b=2" },
          { header: "content-security-policy", operation: "remove" },
        ],
      },
      condition: { urlFilter: "api" },
    },
  ]);
  const match = m.match({ url: "https://x.io/api", type: "xmlhttprequest" });
  assert.deepEqual(
    match.headerRules.map((rule) => rule.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    applyDnrHeaderRules(
      { Cookie: "a=1", "X-List": "a" },
      match.headerRules,
      "requestHeaders",
    ),
    { "X-Test": "high", "X-List": "a, b" },
  );
  assert.deepEqual(
    applyDnrHeaderRules(
      {
        "set-cookie": ["a=1"],
        "Content-Security-Policy": ["default-src 'self'"],
      },
      match.headerRules,
      "responseHeaders",
    ),
    { "set-cookie": ["a=1", "b=2"] },
  );
  assert.equal(
    applyDnrHeaderRules({ Accept: "*/*" }, [], "requestHeaders"),
    null,
  );

  // An allow rule at equal or higher priority switches header rules off.
  const allowed = matcher([
    {
      id: 1,
      priority: 2,
      action: { type: "allow" },
      condition: { urlFilter: "api" },
    },
    {
      id: 2,
      priority: 2,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "a", operation: "remove" }],
      },
      condition: { urlFilter: "api" },
    },
    {
      id: 3,
      priority: 3,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "b", operation: "remove" }],
      },
      condition: { urlFilter: "api" },
    },
  ]);
  assert.deepEqual(
    allowed
      .match({ url: "https://x.io/api", type: "xmlhttprequest" })
      .headerRules.map((rule) => rule.id),
    [3],
  );
});

test("validation rejects malformed or unsupported rules but keeps the rest", () => {
  const parsed = parseDnrRules(
    [
      { id: 1, action: { type: "block" }, condition: { urlFilter: "ok" } },
      { id: 1, action: { type: "block" }, condition: { urlFilter: "dupe" } },
      { id: 2, action: { type: "explode" }, condition: {} },
      {
        id: 3,
        action: { type: "block" },
        condition: { urlFilter: "a", regexFilter: "b" },
      },
      {
        id: 4,
        action: { type: "block" },
        condition: { responseHeaders: [{ header: "x" }] },
      },
      { id: 5, action: { type: "block" }, condition: { tabIds: [1] } },
      { id: 6, action: { type: "block" }, condition: { regexFilter: "(" } },
      { id: 7, action: { type: "redirect" }, condition: { urlFilter: "x" } },
      { id: 8, action: { type: "block" }, condition: { urlFilter: "x" } },
    ],
    "r",
    "static",
    new Set([8]),
  );
  assert.deepEqual(
    parsed.rules.map((rule) => rule.id),
    [1],
  );
  assert.equal(parsed.rejected.length, 7);
  assert.ok(
    parsed.rejected.some((entry) =>
      entry.reason.includes("responseHeaders is not supported"),
    ),
  );
  // tabIds are fine in session rules.
  assert.equal(
    parseDnrRules(
      [{ id: 5, action: { type: "block" }, condition: { tabIds: [1] } }],
      "s",
      "session",
    ).rules.length,
    1,
  );
  assert.deepEqual(parseDnrRules({}, "r", "static").rules, []);
  const summary = unsupportedDnrRuleCount([
    {
      rules: [
        {
          id: 1,
          action: { type: "block" },
          condition: { responseHeaders: [] },
        },
        { id: 2, action: { type: "block" }, condition: {} },
      ],
    },
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.unsupported, 1);
});

test("session tabIds restrict matching", () => {
  const m = matcher(
    [
      {
        id: 1,
        action: { type: "block" },
        condition: { urlFilter: "x", tabIds: [7] },
      },
    ],
    "session",
  );
  assert.equal(
    m.match({ url: "https://a.io/x", type: "script", tabId: 7 }).rule?.id,
    1,
  );
  assert.equal(
    m.match({ url: "https://a.io/x", type: "script", tabId: 8 }).rule,
    null,
  );
});

test("the index never misses: indexed and brute-force results agree", () => {
  const filters = [
    "ads",
    "/ad/",
    "||tracker.net^",
    "cdn*banner",
    "|https://x.io/a.js|",
    "consent_",
    "-cmp.",
    "a",
    "*cookie*",
    "^gdpr^",
  ];
  const rules = filters.map((urlFilter, index) => ({
    id: index + 1,
    action: { type: "block" },
    condition: { urlFilter, resourceTypes: ["script"] },
  }));
  const m = matcher(rules);
  const urls = [
    "https://x.io/a.js",
    "https://cdn.io/big-banner.js",
    "https://sub.tracker.net/t.js",
    "https://site.com/ad/x.js",
    "https://site.com/ads.js",
    "https://site.com/consent_v2.js",
    "https://site.com/my-cmp.js",
    "https://q.io/?gdpr=1",
    "https://q.io/Cookie.js",
    "https://q.io/zzz.js",
  ];
  for (const url of urls) {
    const indexed = m
      .matchAll(script(url))
      .map((rule) => rule.id)
      .sort((a, b) => a - b);
    const brute = filters
      .map((filter, index) =>
        compileUrlFilter(filter, false).test(url) ? index + 1 : 0,
      )
      .filter(Boolean);
    assert.deepEqual(indexed, brute, url);
  }
});

test("helpers: resource types and manifest rulesets", () => {
  assert.equal(dnrResourceType("xhr"), "xmlhttprequest");
  assert.equal(dnrResourceType("mainFrame"), "main_frame");
  assert.equal(dnrResourceType("cspReport"), "csp_report");
  assert.equal(dnrResourceType(undefined), "other");
  assert.deepEqual(
    manifestDnrRulesets({
      declarative_net_request: {
        rule_resources: [
          { id: "ruleset_1", enabled: true, path: "rules.json" },
          { id: "_reserved", path: "x.json" },
          { id: "off", path: "off.json" },
        ],
      },
    }),
    [
      { id: "ruleset_1", path: "rules.json", enabled: true },
      { id: "off", path: "off.json", enabled: false },
    ],
  );
});
