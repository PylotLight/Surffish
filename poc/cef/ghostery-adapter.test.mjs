import { describe, expect, test } from "bun:test";
import { FiltersEngine } from "@ghostery/adblocker";
import { evaluateCefRequest, ghosteryRequestFromCef } from "./ghostery-adapter.mjs";

const engine = FiltersEngine.parse(
  [
    "||tracker.test^$script",
    "@@||tracker.test^$script,domain=site.test",
  ].join("\n"),
);

describe("CEF → Ghostery request adapter", () => {
  test("maps a CEF script request and its source frame into the shared core", () => {
    const request = ghosteryRequestFromCef({
      url: "http://tracker.test:8123/track.js",
      frameUrl: "http://site.test:8123/",
      resourceType: "script",
      requestId: 12,
    });

    expect(request.type).toBe("script");
    expect(request.hostname).toBe("tracker.test");
    expect(request.domain).toBe("tracker.test");
    expect(request.id).toBe("12");
  });

  test("blocks a matching script using Ghostery's network filter core", () => {
    expect(
      evaluateCefRequest(engine, {
        url: "http://tracker.test:8123/track.js",
        frameUrl: "http://other-site.test:8123/",
        resourceType: "script",
      }),
    ).toMatchObject({ action: "block", filter: "||tracker.test^$script" });
  });

  test("honors a site-specific uBO-style allow exception", () => {
    expect(
      evaluateCefRequest(engine, {
        url: "http://tracker.test:8123/allowed.js",
        frameUrl: "http://site.test:8123/",
        resourceType: "script",
      }).action,
    ).toBe("allow");
  });

  test("keeps unrelated resource types allowed", () => {
    expect(
      evaluateCefRequest(engine, {
        url: "http://tracker.test:8123/pixel.png",
        frameUrl: "http://other-site.test:8123/",
        resourceType: "image",
      }).action,
    ).toBe("allow");
  });

  test("does not guess the source frame for extension/service-worker requests", () => {
    const request = ghosteryRequestFromCef({
      url: "https://tracker.test/api",
      resourceType: "xhr",
    });
    expect(request.type).toBe("xmlhttprequest");
    expect(request.isSupported).toBe(true);
  });
});
