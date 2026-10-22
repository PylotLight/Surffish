import { describe, expect, test } from "bun:test";
import {
  buildHar,
  harHttpVersion,
  harTimings,
  harTotalTime,
  parseCookieHeader,
  parseSetCookieHeaders,
} from "./har.ts";
import type { NetworkRequestDetails } from "./types.ts";

function request(
  overrides: Partial<NetworkRequestDetails> = {},
): NetworkRequestDetails {
  return {
    id: "t1:1",
    tabId: "t1",
    url: "https://api.example.com/v1/items?q=a%20b&x=1",
    method: "POST",
    resourceType: "Fetch",
    status: 201,
    statusText: "Created",
    mimeType: "application/json",
    startedAt: Date.UTC(2026, 9, 13, 1, 2, 3, 456),
    durationMs: 120,
    transferSize: 512,
    responseBodyAvailable: true,
    state: "complete",
    initiator: "",
    errorText: "",
    fromDiskCache: false,
    fromServiceWorker: false,
    requestHeaders: [
      { name: "Content-Type", value: "application/json" },
      { name: "Cookie", value: "sid=abc; theme=dark" },
    ],
    responseHeaders: [
      { name: "content-type", value: "application/json" },
      { name: "set-cookie", value: "a=1; Path=/\nb=2; HttpOnly" },
    ],
    requestBody: '{"name":"ü"}',
    requestBodyAvailable: true,
    requestBodyTruncated: false,
    remoteAddress: "93.184.216.34:443",
    protocol: "h2",
    securityState: "secure",
    timing: {
      requestTime: 1000,
      dnsStart: 1,
      dnsEnd: 5,
      connectStart: 5,
      connectEnd: 30,
      sslStart: 10,
      sslEnd: 30,
      sendStart: 31,
      sendEnd: 32,
      receiveHeadersEnd: 100,
    },
    ...overrides,
  };
}

describe("HAR helpers", () => {
  test("http versions", () => {
    expect(harHttpVersion("h2")).toBe("HTTP/2.0");
    expect(harHttpVersion("http/1.1")).toBe("HTTP/1.1");
    expect(harHttpVersion("h3")).toBe("HTTP/3");
    expect(harHttpVersion("")).toBe("HTTP/1.1");
  });
  test("timings from CDP ResourceTiming, time is their sum", () => {
    const timings = harTimings(request().timing, 120);
    expect(timings).toEqual({
      blocked: 1,
      dns: 4,
      connect: 25,
      ssl: 20,
      send: 1,
      wait: 68,
      receive: 20,
    });
    expect(harTotalTime(timings)).toBe(119);
    // Reused connection: dns/connect not applicable.
    const reused = harTimings(
      {
        requestTime: 1,
        dnsStart: -1,
        dnsEnd: -1,
        connectStart: -1,
        connectEnd: -1,
        sslStart: -1,
        sslEnd: -1,
        sendStart: 2,
        sendEnd: 2.5,
        receiveHeadersEnd: 40,
      },
      50,
    );
    expect(reused).toEqual({
      blocked: 2,
      dns: -1,
      connect: -1,
      ssl: -1,
      send: 0.5,
      wait: 37.5,
      receive: 10,
    });
    expect(harTotalTime(reused)).toBe(50);
  });
  test("no timing data: the duration counts as waiting", () => {
    expect(harTimings(null, 75)).toEqual({
      blocked: -1,
      dns: -1,
      connect: -1,
      send: 0,
      wait: 75,
      receive: 0,
      ssl: -1,
    });
    expect(harTimings(null, null).wait).toBe(0);
  });
  test("cookies", () => {
    expect(parseCookieHeader("sid=abc; theme=dark; flag")).toEqual([
      { name: "sid", value: "abc" },
      { name: "theme", value: "dark" },
      { name: "flag", value: "" },
    ]);
    expect(
      parseSetCookieHeaders([
        { name: "Set-Cookie", value: "a=1; Path=/\nb=x=y; Secure" },
      ]),
    ).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "x=y" },
    ]);
  });
});

describe("buildHar", () => {
  test("a valid HAR 1.2 log with request, response and timings", () => {
    const har = buildHar(
      [
        {
          request: request(),
          responseBody: {
            text: '{"ok":true}',
            base64Encoded: false,
            truncated: false,
          },
        },
      ],
      { creatorVersion: "0.1.1", includeBodies: true },
    );
    expect(har.log.version).toBe("1.2");
    expect(har.log.creator).toEqual({ name: "Surffish", version: "0.1.1" });
    expect(har.log.entries).toHaveLength(1);
    const entry = har.log.entries[0]!;
    expect(entry.startedDateTime).toBe("2026-10-13T01:02:03.456Z");
    expect(entry.time).toBe(harTotalTime(entry.timings));
    expect(entry.request).toMatchObject({
      method: "POST",
      httpVersion: "HTTP/2.0",
      headersSize: -1,
      bodySize: 13,
    });
    expect(entry.request.queryString).toEqual([
      { name: "q", value: "a b" },
      { name: "x", value: "1" },
    ]);
    expect(entry.request.cookies).toEqual([
      { name: "sid", value: "abc" },
      { name: "theme", value: "dark" },
    ]);
    expect(entry.request.postData).toEqual({
      mimeType: "application/json",
      text: '{"name":"ü"}',
      params: [],
    });
    expect(entry.response).toMatchObject({
      status: 201,
      statusText: "Created",
      redirectURL: "",
      bodySize: 512,
    });
    expect(entry.response.cookies.map((cookie) => cookie.name)).toEqual([
      "a",
      "b",
    ]);
    expect(entry.response.content).toEqual({
      size: 11,
      mimeType: "application/json",
      text: '{"ok":true}',
    });
    expect(entry.serverIPAddress).toBe("93.184.216.34");
    expect(entry.cache).toEqual({});
    // Round-trips as JSON.
    expect(JSON.parse(JSON.stringify(har))).toEqual(har);
  });
  test("bodies are left out unless asked for", () => {
    const entry = buildHar(
      [
        {
          request: request(),
          responseBody: {
            text: "secret",
            base64Encoded: false,
            truncated: false,
          },
        },
      ],
      { creatorVersion: "x", includeBodies: false },
    ).log.entries[0]!;
    expect(entry.response.content.text).toBeUndefined();
    expect(entry.request.postData?.text).toBe("");
    expect(entry.request.postData?.comment).toContain("not included");
  });
  test("per-body and total size caps", () => {
    const big = "x".repeat(50);
    const har = buildHar(
      [
        {
          request: request({
            id: "a",
            startedAt: 1,
            requestBodyAvailable: false,
            requestBody: null,
          }),
          responseBody: { text: big, base64Encoded: false, truncated: false },
        },
        {
          request: request({
            id: "b",
            startedAt: 2,
            requestBodyAvailable: false,
            requestBody: null,
          }),
          responseBody: { text: big, base64Encoded: false, truncated: false },
        },
        {
          request: request({
            id: "c",
            startedAt: 3,
            requestBodyAvailable: false,
            requestBody: null,
          }),
          responseBody: { text: big, base64Encoded: false, truncated: false },
        },
      ],
      {
        creatorVersion: "x",
        includeBodies: true,
        maxBodyCharacters: 30,
        maxTotalBodyCharacters: 45,
      },
    );
    const [a, b, c] = har.log.entries;
    expect(a!.response.content.text).toHaveLength(30);
    expect(a!.response.content.comment).toContain("Truncated to 30 of 50");
    expect(b!.response.content.text).toHaveLength(15);
    expect(c!.response.content.text).toBeUndefined();
    expect(c!.response.content.comment).toContain("size limit");
    expect(har.log.comment).toContain("1 bodies were left out");
    expect(a!.request.postData).toBeUndefined();
    expect(a!.request.bodySize).toBe(0);
  });
  test("base64 bodies keep their encoding; failed and pending requests", () => {
    const har = buildHar(
      [
        {
          request: request({
            startedAt: 5,
            status: null,
            statusText: "",
            state: "failed",
            errorText: "net::ERR_BLOCKED_BY_CLIENT",
            timing: null,
            durationMs: 3,
            protocol: "",
            remoteAddress: "",
          }),
        },
        {
          request: request({ startedAt: 4, state: "pending" }),
          responseBody: { text: "AAEC", base64Encoded: true, truncated: true },
        },
      ],
      { creatorVersion: "x", includeBodies: true },
    );
    // Sorted by start time.
    const [pending, failed] = har.log.entries;
    expect(pending!.response.content).toMatchObject({
      text: "AAEC",
      encoding: "base64",
      size: 512,
    });
    expect(pending!.response.content.comment).toContain("cut short");
    expect(pending!.comment).toContain("pending");
    expect(failed!.response.status).toBe(0);
    expect(failed!.response._error).toBe("net::ERR_BLOCKED_BY_CLIENT");
    expect(failed!.serverIPAddress).toBeUndefined();
    expect(failed!.time).toBe(3);
  });
  test("redirects carry their Location", () => {
    const entry = buildHar(
      [
        {
          request: request({
            status: 302,
            responseHeaders: [
              { name: "Location", value: "https://example.com/next" },
            ],
          }),
        },
      ],
      { creatorVersion: "x", includeBodies: false },
    ).log.entries[0]!;
    expect(entry.response.redirectURL).toBe("https://example.com/next");
    expect(entry.response.content.mimeType).toBe("application/json");
  });
});
