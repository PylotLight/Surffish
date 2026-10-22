import { describe, expect, test } from "bun:test";
import {
  cdpFetchPatterns,
  formatHeaderLines,
  hasActiveOverrides,
  matchOverrideRule,
  overrideCommand,
  overridePatternMatches,
  parseHeaderLines,
  validateOverrideRule,
  validateOverrideRules,
  type NetworkOverrideRule,
} from "./network-overrides.ts";

function rule(
  overrides: Partial<NetworkOverrideRule> = {},
): NetworkOverrideRule {
  return {
    id: "r1",
    enabled: true,
    urlPattern: "api.example.com/v1/*",
    method: "*",
    action: "respond",
    status: 200,
    headers: [],
    body: "",
    ...overrides,
  };
}

describe("pattern matching", () => {
  test("substring with * wildcards, in order", () => {
    expect(
      overridePatternMatches(
        "api.example.com/v1/",
        "https://api.example.com/v1/items",
      ),
    ).toBe(true);
    expect(
      overridePatternMatches(
        "api.example.com/v1/*",
        "https://api.example.com/v1/items?x=1",
      ),
    ).toBe(true);
    expect(
      overridePatternMatches(
        "example.com/*/items",
        "https://example.com/v2/items",
      ),
    ).toBe(true);
    expect(
      overridePatternMatches(
        "example.com/*/items",
        "https://example.com/items",
      ),
    ).toBe(false);
    expect(
      overridePatternMatches("*.js", "https://cdn.example.com/app.js?v=3"),
    ).toBe(true);
    expect(overridePatternMatches("b*a", "https://x/a-b")).toBe(false);
    expect(overridePatternMatches("*", "https://anything/")).toBe(true);
    expect(overridePatternMatches("", "https://anything/")).toBe(false);
  });
  test("? and . are literal, matching is case-sensitive", () => {
    expect(
      overridePatternMatches("/search?q=", "https://e.com/search?q=1"),
    ).toBe(true);
    expect(
      overridePatternMatches("/search?q=", "https://e.com/searchXq=1"),
    ).toBe(false);
    expect(overridePatternMatches("a.b", "https://axb/")).toBe(false);
    expect(overridePatternMatches("/API/", "https://e.com/api/")).toBe(false);
  });
});

describe("rule matching", () => {
  const rules = [
    rule({ id: "off", enabled: false, urlPattern: "example.com" }),
    rule({
      id: "post",
      method: "POST",
      urlPattern: "api.example.com/v1/items",
    }),
    rule({ id: "any", urlPattern: "api.example.com/v1/*" }),
    rule({ id: "block", action: "block", urlPattern: "ads." }),
  ];
  test("first enabled match wins; method is case-insensitive; disabled rules ignored", () => {
    expect(
      matchOverrideRule(rules, {
        url: "https://api.example.com/v1/items",
        method: "post",
      })?.id,
    ).toBe("post");
    expect(
      matchOverrideRule(rules, {
        url: "https://api.example.com/v1/items",
        method: "GET",
      })?.id,
    ).toBe("any");
    expect(
      matchOverrideRule(rules, {
        url: "https://ads.tracker.net/p.gif",
        method: "GET",
      })?.id,
    ).toBe("block");
    expect(
      matchOverrideRule(rules, { url: "https://example.com/", method: "GET" }),
    ).toBeNull();
  });
  test("the fragment is not part of the match", () => {
    expect(
      matchOverrideRule([rule({ urlPattern: "#secret" })], {
        url: "https://e.com/#secret",
        method: "GET",
      }),
    ).toBeNull();
  });
  test("active only while some rule is on", () => {
    expect(hasActiveOverrides([])).toBe(false);
    expect(hasActiveOverrides([rule({ enabled: false })])).toBe(false);
    expect(hasActiveOverrides(rules)).toBe(true);
  });
});

describe("CDP patterns", () => {
  test("unanchored, deduplicated, CDP wildcards escaped, disabled rules left out", () => {
    expect(
      cdpFetchPatterns([
        rule({ urlPattern: "api.example.com/v1/*" }),
        rule({ id: "b", urlPattern: "api.example.com/v1/*" }),
        rule({ id: "c", urlPattern: "/search?q=\\x" }),
        rule({ id: "d", urlPattern: "*.js", enabled: false }),
      ]),
    ).toEqual([
      { urlPattern: "*api.example.com/v1/*", requestStage: "Request" },
      { urlPattern: "*/search\\?q=\\\\x*", requestStage: "Request" },
    ]);
  });
});

describe("CDP commands", () => {
  test("respond fulfils with status, headers and a UTF-8 base64 body", () => {
    const command = overrideCommand(
      rule({
        status: 418,
        headers: [{ name: "Content-Type", value: "application/json" }],
        body: '{"ü":1}',
      }),
      "interception-1",
    );
    expect(command.method).toBe("Fetch.fulfillRequest");
    if (command.method !== "Fetch.fulfillRequest") return;
    expect(command.params.requestId).toBe("interception-1");
    expect(command.params.responseCode).toBe(418);
    expect(command.params.responseHeaders).toEqual([
      { name: "Content-Type", value: "application/json" },
      { name: "X-Surffish-Override", value: "r1" },
    ]);
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(command.params.body), (c) => c.charCodeAt(0)),
      ),
    ).toBe('{"ü":1}');
  });
  test("a body without a content type gets text/plain", () => {
    const command = overrideCommand(rule({ body: "hi" }), "x");
    if (command.method !== "Fetch.fulfillRequest")
      throw new Error("expected fulfil");
    expect(command.params.responseHeaders[0]).toEqual({
      name: "Content-Type",
      value: "text/plain; charset=utf-8",
    });
  });
  test("block fails the request as blocked by client", () => {
    expect(overrideCommand(rule({ action: "block" }), "x")).toEqual({
      method: "Fetch.failRequest",
      params: { requestId: "x", errorReason: "BlockedByClient" },
    });
  });
});

describe("validation", () => {
  test("normalises a good rule", () => {
    expect(
      validateOverrideRule({
        id: "a1",
        urlPattern: "  /api/  ",
        method: "get",
        action: "respond",
        status: "503",
        headers: [
          { name: "Retry-After", value: " 5 " },
          { name: "", value: "" },
        ],
        body: "down",
      }),
    ).toEqual({
      id: "a1",
      enabled: true,
      urlPattern: "/api/",
      method: "GET",
      action: "respond",
      status: 503,
      headers: [{ name: "Retry-After", value: "5" }],
      body: "down",
    });
    expect(
      validateOverrideRule({
        id: "b",
        urlPattern: "x",
        method: "",
        action: "block",
        status: 999,
        headers: [{ name: "A", value: "b" }],
        body: "ignored",
        enabled: false,
      }),
    ).toEqual({
      id: "b",
      enabled: false,
      urlPattern: "x",
      method: "*",
      action: "block",
      status: 0,
      headers: [],
      body: "",
    });
  });
  test("rejects bad rules", () => {
    expect(() =>
      validateOverrideRule({
        id: "a",
        urlPattern: "",
        action: "respond",
        status: 200,
      }),
    ).toThrow(/pattern/);
    expect(() =>
      validateOverrideRule({
        id: "a",
        urlPattern: "x\ny",
        action: "respond",
        status: 200,
      }),
    ).toThrow(/single line/);
    expect(() =>
      validateOverrideRule({
        id: "a",
        urlPattern: "x",
        action: "respond",
        status: 99,
      }),
    ).toThrow(/100 to 599/);
    expect(() =>
      validateOverrideRule({
        id: "a",
        urlPattern: "x",
        action: "teleport",
        status: 200,
      }),
    ).toThrow(/Respond or Block/);
    expect(() =>
      validateOverrideRule({
        id: "a",
        urlPattern: "x",
        method: "G E T",
        action: "respond",
        status: 200,
      }),
    ).toThrow(/method/);
    expect(() =>
      validateOverrideRule({
        id: "a",
        urlPattern: "x",
        action: "respond",
        status: 200,
        headers: [{ name: "Bad Name", value: "1" }],
      }),
    ).toThrow(/header name/);
    expect(() =>
      validateOverrideRule({
        id: "a",
        urlPattern: "x",
        action: "respond",
        status: 200,
        headers: [{ name: "X", value: "a\r\nInjected: 1" }],
      }),
    ).toThrow(/line breaks/);
    expect(() =>
      validateOverrideRule({
        id: "a",
        urlPattern: "x",
        action: "respond",
        status: 200,
        body: "x".repeat(1_000_001),
      }),
    ).toThrow(/1 MB/);
    expect(() =>
      validateOverrideRule({ id: "../x", urlPattern: "x", action: "block" }),
    ).toThrow(/id/);
    expect(() =>
      validateOverrideRules([
        { id: "a", urlPattern: "x", action: "block" },
        { id: "a", urlPattern: "y", action: "block" },
      ]),
    ).toThrow(/share an id/);
    expect(() => validateOverrideRules("nope")).toThrow();
  });
  test("header lines round-trip", () => {
    const headers = parseHeaderLines(
      "Content-Type: application/json\n\nX-Time: 12:30:00\r\nFlag",
    );
    expect(headers).toEqual([
      { name: "Content-Type", value: "application/json" },
      { name: "X-Time", value: "12:30:00" },
      { name: "Flag", value: "" },
    ]);
    expect(formatHeaderLines(headers.slice(0, 2))).toBe(
      "Content-Type: application/json\nX-Time: 12:30:00",
    );
  });
});
